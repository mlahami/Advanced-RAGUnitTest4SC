# docvesting--mikemushunje

- domain: vesting-timelock (vesting)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Mikemushunje/doc-vesting @ da5e3bb4d3d8ddaf9d2ed6bed991cda30a31df0d
- license: MIT
- targets: DOCVesting.sol, MockDOC.sol
- validation: 80 passing tests, 0 failing; statement coverage DOCVesting.sol 98.15 %, MockDOC.sol 50.0 %

## Contract: DOCVesting.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// OpenZeppelin imports:
// - SafeERC20: wraps ERC-20 calls so they revert cleanly on failure
// - IERC20: standard interface for interacting with any ERC-20 token (like DOC)
// - ReentrancyGuard: prevents reentrancy attacks on withdrawal functions
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  DOCVesting
 * @author Michael Mushunje
 * @notice A time-locked vesting vault for DOC tokens on Rootstock (RSK).
 *
 *         HOW IT WORKS:
 *         1. Admin deploys the contract and funds it with DOC tokens.
 *         2. Admin sets a beneficiary with a total allocation and vesting schedule.
 *         3. Tokens unlock linearly over time, with an optional cliff period
 *            during which no withdrawals are allowed at all.
 *         4. The beneficiary can withdraw at any time after the cliff:
 *            - Within the vested amount  → no penalty, full amount received.
 *            - Beyond the vested amount  → 20% penalty on the unvested excess.
 *              The penalty stays in the contract.
 *
 *         STATE MACHINE:
 *         The vault moves through three logical states:
 *
 *           NOT_CONFIGURED  → contract deployed, no beneficiary yet
 *           LOCKED          → before cliff ends, no withdrawals allowed
 *           VESTING         → cliff passed, tokens unlocking linearly
 *           COMPLETE        → vesting period over, all tokens available penalty-free
 */
contract DOCVesting is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// @notice Penalty rate applied to unvested excess withdrawals (20%)
    uint256 public constant PENALTY_RATE = 20;

    /// @notice Divisor used with PENALTY_RATE: penalty = unvestedExcess * 20 / 100
    uint256 public constant PERCENT_BASE = 100;

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice The wallet that deployed and manages this contract
    /// @dev    Immutable — set once in constructor, saves gas on every read
    address public immutable admin;

    /// @notice The DOC ERC-20 token contract on Rootstock
    /// @dev    Immutable for the same reason as admin
    IERC20 public immutable docToken;

    /// @notice The wallet that will receive the vested tokens
    address public beneficiary;

    /// @notice Total DOC tokens allocated to the beneficiary
    uint256 public totalAllocation;

    /// @notice How long the full vesting lasts in seconds (e.g. 180 days = 15552000)
    uint256 public vestingPeriod;

    /**
     * @notice Optional delay before ANY withdrawal is allowed (LOCKED state).
     *         Set to 0 if no cliff is needed.
     * @dev    Must always be shorter than vestingPeriod.
     */
    uint256 public cliffPeriod;

    /// @notice Block timestamp when the beneficiary was set up — vesting clock starts here
    uint256 public startTime;

    /**
     * @notice Running total of DOC already withdrawn by the beneficiary.
     * @dev    Tracks the FULL requested amount, including any penalised portion.
     *         This prevents a beneficiary from re-withdrawing tokens that were
     *         already consumed as a penalty in a previous early withdrawal.
     */
    uint256 public withdrawn;

    /// @notice Accumulated penalties from early withdrawals — stays in contract
    uint256 public penaltyPool;

    /// @notice Prevents setup() from being called more than once
    bool public isConfigured;

    // =========================================================================
    // EVENTS
    // =========================================================================

    // Events are the contract's on-chain log. They cost minimal gas and allow
    // frontends, block explorers, and auditors to track everything that happens.

    /// @notice Fired when admin deposits DOC into the contract
    event ContractFunded(address indexed funder, uint256 amount);

    /// @notice Fired when the beneficiary and schedule are configured
    event BeneficiarySet(
        address indexed wallet,
        uint256 allocation,
        uint256 vestingPeriod,
        uint256 cliffPeriod,
        uint256 startTime
    );

    /**
     * @notice Fired on every successful withdrawal
     * @param amountReceived  What the beneficiary actually got after any penalty
     * @param penaltyPaid     How much was deducted (0 if no penalty applied)
     * @param state           Vault state at the time of withdrawal
     */
    event Withdrawal(
        address indexed beneficiary,
        uint256 amountReceived,
        uint256 penaltyPaid,
        string state
    );

    // =========================================================================
    // MODIFIERS
    // =========================================================================

    /// @dev Blocks anyone except the admin from calling the function
    modifier onlyAdmin() {
        require(msg.sender == admin, "Caller is not admin");
        _;
    }

    /// @dev Blocks anyone except the beneficiary from calling the function
    modifier onlyBeneficiary() {
        require(msg.sender == beneficiary, "Caller is not beneficiary");
        _;
    }

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    /**
     * @notice Deploys the vault. Sets the admin and the DOC token address.
     *         No beneficiary is configured here — that happens via setup().
     *
     * @param _docToken  DOC token address on Rootstock testnet:
     *                   0xCB46c0ddc60D18eFEB0E586C17Af6ea36452Dae0
     */
    constructor(address _docToken) {
        require(_docToken != address(0), "Invalid token address");
        admin    = msg.sender;
        docToken = IERC20(_docToken);
    }

    // =========================================================================
    // ADMIN FUNCTIONS
    // =========================================================================

    /**
     * @notice Step 1 — Admin deposits DOC into the vault before setting up
     *         a beneficiary. Funding first ensures every allocation is backed
     *         by real tokens from the moment the beneficiary is added.
     *
     * @dev    Admin must call DOC.approve(address(this), amount) on the DOC
     *         token contract before calling this — otherwise transferFrom fails.
     *
     * @param amount  How many DOC tokens to deposit (in wei, 18 decimals)
     */
    function fundContract(uint256 amount) external onlyAdmin {
        require(amount > 0, "Amount must be greater than zero");

        // Pulls DOC from admin's wallet into this contract.
        // safeTransferFrom reverts automatically if the transfer fails for any reason.
        docToken.safeTransferFrom(msg.sender, address(this), amount);

        emit ContractFunded(msg.sender, amount);
    }

    /**
     * @notice Step 2 — Admin sets the beneficiary, their total allocation,
     *         and the vesting schedule. Can only ever be called once.
     *
     *         The contract checks that the vault already holds enough DOC to
     *         cover the allocation before accepting the configuration.
     *
     * @param _beneficiary   Wallet that will receive tokens over time
     * @param _allocation    Total DOC tokens reserved for them (in wei)
     * @param _vestingPeriod How long full vesting takes (in seconds)
     * @param _cliffPeriod   Seconds before first withdrawal allowed (0 = no cliff)
     */
    function setup(
        address _beneficiary,
        uint256 _allocation,
        uint256 _vestingPeriod,
        uint256 _cliffPeriod
    ) external onlyAdmin {

        // --- Checks ---

        require(!isConfigured,                "Beneficiary already configured");
        require(_beneficiary != address(0),   "Zero address not allowed");
        require(_beneficiary != address(this),"Cannot vest to contract itself");
        require(_beneficiary != admin,         "Admin cannot be beneficiary");
        require(_allocation > 0,              "Allocation must be greater than zero");
        require(_vestingPeriod > 0,           "Vesting period must be greater than zero");
        require(_cliffPeriod < _vestingPeriod, "Cliff must be shorter than vesting period");

        // Ensure vault is funded enough to cover this allocation.
        // This is the key guard that ties promises to real balances.
        uint256 contractBalance = docToken.balanceOf(address(this));
        require(contractBalance >= _allocation, "Fund the contract before setup");

        // --- Effects ---

        beneficiary     = _beneficiary;
        totalAllocation = _allocation;
        vestingPeriod   = _vestingPeriod;
        cliffPeriod     = _cliffPeriod;
        startTime       = block.timestamp;  // Vesting clock starts now
        isConfigured    = true;

        emit BeneficiarySet(
            _beneficiary,
            _allocation,
            _vestingPeriod,
            _cliffPeriod,
            block.timestamp
        );
    }

    // =========================================================================
    // BENEFICIARY FUNCTIONS
    // =========================================================================

    /**
     * @notice Withdraw DOC from the vault.
     *
     *         FOUR POSSIBLE OUTCOMES:
     *
     *         1. LOCKED (before cliff ends)
     *            → Reverts. No tokens transferred.
     *
     *         2. VESTING, amount ≤ vested portion
     *            → Normal withdrawal. Full amount received, zero penalty.
     *
     *         3. VESTING, amount > vested portion (early exit)
     *            → Penalty = 20% of the unvested excess being pulled early.
     *            → Beneficiary receives (amount - penalty).
     *            → Penalty accumulates in penaltyPool inside the contract.
     *
     *         4. COMPLETE (after vesting period ends)
     *            → All remaining tokens available. No penalty ever applies.
     *
     * @dev    Follows checks-effects-interactions (CEI) pattern:
     *            1. All require() checks run first
     *            2. State variables updated
     *            3. Token transfer called last
     *         This ordering prevents reentrancy even alongside ReentrancyGuard.
     *
     * @param amount  How many DOC tokens to withdraw (in wei)
     */
    function withdraw(uint256 amount) external onlyBeneficiary nonReentrant {

        // --- Checks ---

        require(isConfigured, "Vault not configured yet");
        require(amount > 0,   "Amount must be greater than zero");

        // LOCKED state — cliff has not passed, no withdrawals permitted at all
        require(
            block.timestamp >= startTime + cliffPeriod,
            "Cliff period has not passed yet"
        );

        // Cannot withdraw more than what remains of the total allocation
        uint256 remaining = totalAllocation - withdrawn;
        require(amount <= remaining, "Exceeds remaining allocation");

        // How much has vested so far based on time elapsed
        uint256 vested          = vestedAmount();

        // How much is available right now without any penalty
        // (vested so far, minus what has already been withdrawn)
        uint256 withdrawableNow = vested - withdrawn;

        // --- Determine which path this withdrawal takes ---

        uint256 penalty        = 0;
        uint256 actualReceived = amount;
        string memory state;

        if (block.timestamp >= startTime + vestingPeriod) {
            // COMPLETE — fully vested, penalty never applies
            state = "COMPLETE";

        } else if (amount <= withdrawableNow) {
            // VESTING — within vested portion, no penalty
            state = "VESTING";

        } else {
            // EARLY EXIT — requesting beyond what has vested, penalty applies
            // Only the unvested excess is penalised, not the whole amount
            state = "EARLY_EXIT";

            uint256 unvestedExcess = amount - withdrawableNow;
            penalty        = (unvestedExcess * PENALTY_RATE) / PERCENT_BASE;
            actualReceived = amount - penalty;
        }

        // --- Effects (state updates BEFORE transfer — CEI pattern) ---

        // Record the full requested amount as withdrawn, not just what was received.
        // This prevents re-claiming the penalised portion in a future withdrawal.
        withdrawn   += amount;
        penaltyPool += penalty;

        // --- Interaction (token transfer is always last) ---

        docToken.safeTransfer(msg.sender, actualReceived);

        emit Withdrawal(msg.sender, actualReceived, penalty, state);
    }

    // =========================================================================
    // VIEW FUNCTIONS  (read-only, zero gas when called externally)
    // =========================================================================

    /**
     * @notice How much DOC has vested for the beneficiary at this moment.
     *
     *         LINEAR VESTING formula:
     *         vestedAmount = totalAllocation × (elapsed / vestingPeriod)
     *
     *         Important: the cliff does NOT pause vesting — the clock always
     *         runs from startTime. The cliff only blocks the withdraw() call.
     *         When the cliff ends the beneficiary can claim everything vested
     *         since day one in a single transaction.
     *
     * @return Amount of DOC vested so far (in wei)
     */
    function vestedAmount() public view returns (uint256) {
        if (!isConfigured) return 0;

        uint256 elapsed = block.timestamp - startTime;

        // Past or at the end of vesting — everything is vested
        if (elapsed >= vestingPeriod) {
            return totalAllocation;
        }

        // Linear proportion: tokens unlock smoothly second by second
        return (totalAllocation * elapsed) / vestingPeriod;
    }

    /**
     * @notice Returns the current logical state of the vault as a string.
     *         Useful for frontends and for demonstrating state machine behaviour.
     *
     * @return One of: "NOT_CONFIGURED", "LOCKED", "VESTING", "COMPLETE"
     */
    function vaultState() public view returns (string memory) {
        if (!isConfigured)                                return "NOT_CONFIGURED";
        if (block.timestamp < startTime + cliffPeriod)   return "LOCKED";
        if (block.timestamp < startTime + vestingPeriod) return "VESTING";
        return "COMPLETE";
    }

    /**
     * @notice Preview the outcome of a withdrawal without sending a transaction.
     *         Call this from a frontend to show the beneficiary their numbers
     *         before they confirm — costs zero gas.
     *
     * @param  amount          The amount the beneficiary intends to withdraw
     * @return penalty         How much would be deducted as penalty
     * @return actualReceived  How much they would actually receive
     */
    function previewWithdrawal(uint256 amount)
        external
        view
        returns (uint256 penalty, uint256 actualReceived)
    {
        if (!isConfigured) return (0, 0);

        uint256 vested          = vestedAmount();
        uint256 withdrawableNow = vested > withdrawn ? vested - withdrawn : 0;

        if (amount <= withdrawableNow) {
            return (0, amount);
        }

        uint256 unvestedExcess = amount - withdrawableNow;
        penalty        = (unvestedExcess * PENALTY_RATE) / PERCENT_BASE;
        actualReceived = amount - penalty;
    }

    /**
     * @notice Full snapshot of the vault — one call for everything.
     *         Useful for dashboards and capstone demos.
     *
     * @return state             Current vault state string
     * @return _totalAllocation  Total DOC allocated to beneficiary
     * @return _withdrawn        Total already withdrawn (including penalised amounts)
     * @return vested            How much has vested so far
     * @return withdrawableNow   Available right now without any penalty
     * @return _penaltyPool      Total penalties accumulated in the contract
     * @return cliffPassedAt     Timestamp when cliff ends (or ended)
     * @return fullyVestedAt     Timestamp when vesting completes
     */
    function getVaultStatus()
        external
        view
        returns (
            string memory state,
            uint256 _totalAllocation,
            uint256 _withdrawn,
            uint256 vested,
            uint256 withdrawableNow,
            uint256 _penaltyPool,
            uint256 cliffPassedAt,
            uint256 fullyVestedAt
        )
    {
        uint256 v         = vestedAmount();
        uint256 available = v > withdrawn ? v - withdrawn : 0;

        return (
            vaultState(),
            totalAllocation,
            withdrawn,
            v,
            available,
            penaltyPool,
            startTime + cliffPeriod,
            startTime + vestingPeriod
        );
    }
}
```

## Contract: MockDOC.sol (dependency)

```solidity
// contracts/mocks/MockDOC.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice Fake DOC token for local testing only.
 *         Lets us mint tokens freely without needing the real RSK testnet.
 */
contract MockDOC is ERC20 {
    constructor() ERC20("Mock DOC", "mDOC") {
        // Mint 1 million tokens to deployer on creation
        _mint(msg.sender, 1_000_000 * 10 ** 18);
    }

    // Anyone can mint in tests — makes setup simple
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: DOCVesting.security.test.js

```javascript
// test/DOCVesting.security.test.js
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DOCVesting — Security Audit", function () {

  // ─── Shared variables ───────────────────────────────────────────────────────
  let vesting, doc;
  let admin, beneficiary, stranger;

  const ONE_DAY    = 86400;
  const CLIFF      = ONE_DAY * 30;
  const VESTING    = ONE_DAY * 180;
  const ALLOCATION = ethers.parseEther("1000");

  // Fresh contracts before every test
  beforeEach(async function () {
    [admin, beneficiary, stranger] = await ethers.getSigners();

    const MockDOC = await ethers.getContractFactory("MockDOC");
    doc = await MockDOC.deploy();

    const DOCVesting = await ethers.getContractFactory("DOCVesting");
    vesting = await DOCVesting.deploy(await doc.getAddress());

    await doc.approve(await vesting.getAddress(), ethers.parseEther("100000"));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 1 — Reentrancy Protection
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 1: Reentrancy Protection", function () {

    it("withdraw() completes cleanly with no reentrant calls", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await expect(
        vesting.connect(beneficiary).withdraw(ALLOCATION)
      ).to.not.be.reverted;
    });

    it("state is updated before transfer (checks-effects-interactions)", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await vesting.connect(beneficiary).withdraw(ALLOCATION);

      // withdrawn equals totalAllocation proving state updated before transfer
      expect(await vesting.withdrawn()).to.equal(ALLOCATION);
      expect(await vesting.totalAllocation()).to.equal(ALLOCATION);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 2 — Access Control
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 2: Access Control", function () {

    it("stranger cannot call fundContract", async function () {
      await expect(
        vesting.connect(stranger).fundContract(ALLOCATION)
      ).to.be.revertedWith("Caller is not admin");
    });

    it("stranger cannot call setup", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.connect(stranger).setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Caller is not admin");
    });

    it("beneficiary cannot call setup", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.connect(beneficiary).setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Caller is not admin");
    });

    it("admin cannot withdraw", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);
      await expect(
        vesting.connect(admin).withdraw(ALLOCATION)
      ).to.be.revertedWith("Caller is not beneficiary");
    });

    it("stranger cannot withdraw", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);
      await expect(
        vesting.connect(stranger).withdraw(ALLOCATION)
      ).to.be.revertedWith("Caller is not beneficiary");
    });

    it("admin cannot be set as beneficiary", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(admin.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Admin cannot be beneficiary");
    });

    it("zero address cannot be set as beneficiary", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(ethers.ZeroAddress, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Zero address not allowed");
    });

    it("contract address cannot be set as beneficiary", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(await vesting.getAddress(), ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Cannot vest to contract itself");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 3 — Integer Accounting
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 3: Integer Accounting", function () {

    it("withdrawn never exceeds totalAllocation after full withdrawal", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await vesting.connect(beneficiary).withdraw(ALLOCATION);

      const withdrawn = await vesting.withdrawn();
      const total     = await vesting.totalAllocation();
      expect(withdrawn).to.equal(total);
    });

    it("cannot withdraw more than remaining allocation", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("9999"))
      ).to.be.revertedWith("Exceeds remaining allocation");
    });

    it("partial withdrawals correctly reduce remaining balance", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      const firstWithdraw  = ethers.parseEther("400");
      const secondWithdraw = ethers.parseEther("600");

      await vesting.connect(beneficiary).withdraw(firstWithdraw);
      expect(await vesting.withdrawn()).to.equal(firstWithdraw);

      await vesting.connect(beneficiary).withdraw(secondWithdraw);
      expect(await vesting.withdrawn()).to.equal(ALLOCATION);
    });

    it("cannot withdraw zero amount", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await expect(
        vesting.connect(beneficiary).withdraw(0)
      ).to.be.revertedWith("Amount must be greater than zero");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 4 — Penalty Calculation Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 4: Penalty Calculation Edge Cases", function () {

    it("no penalty when withdrawing exactly vested amount", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 2);

      const vested = await vesting.vestedAmount();

      const balanceBefore = await doc.balanceOf(beneficiary.address);
      await vesting.connect(beneficiary).withdraw(vested);
      const balanceAfter  = await doc.balanceOf(beneficiary.address);

      expect(balanceAfter - balanceBefore).to.equal(vested);
      expect(await vesting.penaltyPool()).to.equal(0);
    });

    it("penalty only applies to unvested excess not full amount", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 2);

      // 500 DOC vested, requesting 600 — only 100 DOC excess is penalised
      const [penalty] = await vesting.previewWithdrawal(ethers.parseEther("600"));

      // Should be ~20 DOC (20% of 100), NOT 120 DOC (20% of 600)
      expect(penalty).to.be.closeTo(
        ethers.parseEther("20"),
        ethers.parseEther("1")
      );
    });

    it("penaltyPool accumulates across multiple early withdrawals", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 4); // 25% vested

      await vesting.connect(beneficiary).withdraw(ethers.parseEther("300"));
      const penaltyAfterFirst = await vesting.penaltyPool();
      expect(penaltyAfterFirst).to.be.gt(0);

      await time.increase(VESTING / 4); // now 50% vested
      await vesting.connect(beneficiary).withdraw(ethers.parseEther("100"));
      const penaltyAfterSecond = await vesting.penaltyPool();

      expect(penaltyAfterSecond).to.be.gte(penaltyAfterFirst);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 5 — Configuration Lock
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 5: Configuration Lock", function () {

    it("setup cannot be called twice", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await expect(
        vesting.setup(stranger.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Beneficiary already configured");
    });

    it("setup cannot be called before funding", async function () {
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Fund the contract before setup");
    });

    it("allocation cannot exceed contract balance", async function () {
      await vesting.fundContract(ethers.parseEther("500"));
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Fund the contract before setup");
    });

    it("cliff must be shorter than vesting period", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, CLIFF, VESTING)
      ).to.be.revertedWith("Cliff must be shorter than vesting period");
    });

    it("vesting period cannot be zero", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, 0, 0)
      ).to.be.revertedWith("Vesting period must be greater than zero");
    });

    it("allocation cannot be zero", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(beneficiary.address, 0, VESTING, CLIFF)
      ).to.be.revertedWith("Allocation must be greater than zero");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 6 — Vesting Math Integrity
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 6: Vesting Math Integrity", function () {

    it("vestedAmount returns 0 before configured", async function () {
      expect(await vesting.vestedAmount()).to.equal(0);
    });

    it("vestedAmount increases linearly over time", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, 0); // no cliff

      await time.increase(VESTING / 4);
      const vestedAt25 = await vesting.vestedAmount();

      await time.increase(VESTING / 4);
      const vestedAt50 = await vesting.vestedAmount();

      // Second reading should be roughly double the first
      expect(vestedAt50).to.be.closeTo(vestedAt25 * 2n, ethers.parseEther("5"));
    });

    it("vestedAmount is capped at totalAllocation after vesting ends", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING * 3); // way past vesting end

      expect(await vesting.vestedAmount()).to.equal(ALLOCATION);
    });

    it("cliff does not pause vesting clock", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(CLIFF);

      const vestedAtCliffEnd = await vesting.vestedAmount();

      // 30/180 days elapsed = ~16.6% = ~166 DOC
      expect(vestedAtCliffEnd).to.be.closeTo(
        ethers.parseEther("166"),
        ethers.parseEther("5")
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 7 — ERC-20 Safety
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 7: ERC-20 Safety", function () {

    it("fundContract fails if admin has not approved the contract", async function () {
      const DOCVesting = await ethers.getContractFactory("DOCVesting");
      const freshVesting = await DOCVesting.deploy(await doc.getAddress());

      // No approve() call — transferFrom should fail
      await expect(
        freshVesting.fundContract(ALLOCATION)
      ).to.be.reverted;
    });

    it("fundContract fails if admin has insufficient DOC balance", async function () {
      const DOCVesting = await ethers.getContractFactory("DOCVesting");
      const freshVesting = await DOCVesting.deploy(await doc.getAddress());

      const [, , poorAdmin] = await ethers.getSigners();
      await doc.connect(poorAdmin).approve(
        await freshVesting.getAddress(),
        ethers.parseEther("100000")
      );

      // poorAdmin has no DOC — transfer should fail
      await expect(
        freshVesting.connect(poorAdmin).fundContract(ethers.parseEther("1000"))
      ).to.be.reverted;
    });

    it("contract balance reflects funded amount correctly", async function () {
      await vesting.fundContract(ALLOCATION);

      const contractBalance = await doc.balanceOf(await vesting.getAddress());
      expect(contractBalance).to.equal(ALLOCATION);
    });

    it("beneficiary receives correct DOC balance after withdrawal", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      const beneficiaryBefore = await doc.balanceOf(beneficiary.address);
      await vesting.connect(beneficiary).withdraw(ALLOCATION);
      const beneficiaryAfter  = await doc.balanceOf(beneficiary.address);

      expect(beneficiaryAfter - beneficiaryBefore).to.equal(ALLOCATION);
    });

    it("contract balance decreases by withdrawn amount", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      const contractBefore = await doc.balanceOf(await vesting.getAddress());
      await vesting.connect(beneficiary).withdraw(ALLOCATION);
      const contractAfter  = await doc.balanceOf(await vesting.getAddress());

      expect(contractBefore - contractAfter).to.equal(ALLOCATION);
    });

    it("penalty amount stays in contract after early withdrawal", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 2); // 50% vested

      const contractBefore = await doc.balanceOf(await vesting.getAddress());
      await vesting.connect(beneficiary).withdraw(ethers.parseEther("600"));
      const contractAfter  = await doc.balanceOf(await vesting.getAddress());

      // Contract reduced by ~580 (actualReceived), not 600
      // Meaning ~20 DOC penalty stayed inside the contract
      const reduced = contractBefore - contractAfter;
      expect(reduced).to.be.closeTo(
        ethers.parseEther("580"),
        ethers.parseEther("1")
      );

      // penaltyPool state variable reflects the retained penalty
      expect(await vesting.penaltyPool()).to.be.closeTo(
        ethers.parseEther("20"),
        ethers.parseEther("1")
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 8 — Event Emission
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 8: Event Emission", function () {

    it("fundContract emits ContractFunded with correct args", async function () {
      await expect(vesting.fundContract(ALLOCATION))
        .to.emit(vesting, "ContractFunded")
        .withArgs(admin.address, ALLOCATION);
    });

    it("setup emits BeneficiarySet with correct args", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.emit(vesting, "BeneficiarySet");
    });

    it("normal withdrawal emits Withdrawal with zero penalty", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(CLIFF + 1);

      const withdrawAmount = ethers.parseEther("100");
      await expect(vesting.connect(beneficiary).withdraw(withdrawAmount))
        .to.emit(vesting, "Withdrawal")
        .withArgs(beneficiary.address, withdrawAmount, 0, "VESTING");
    });

    it("early withdrawal emits Withdrawal with EARLY_EXIT state", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 2);

      const tx      = await vesting.connect(beneficiary).withdraw(ethers.parseEther("600"));
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => {
        try { return vesting.interface.parseLog(log).name === "Withdrawal"; }
        catch { return false; }
      });

      const parsed = vesting.interface.parseLog(event);
      expect(parsed.args[3]).to.equal("EARLY_EXIT");
    });

    it("complete withdrawal emits Withdrawal with COMPLETE state", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await expect(vesting.connect(beneficiary).withdraw(ALLOCATION))
        .to.emit(vesting, "Withdrawal")
        .withArgs(beneficiary.address, ALLOCATION, 0, "COMPLETE");
    });

    it("every withdrawal emits an event — no silent transfers", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      const tx      = await vesting.connect(beneficiary).withdraw(ALLOCATION);
      const receipt = await tx.wait();

      const withdrawalEvent = receipt.logs.find(log => {
        try { return vesting.interface.parseLog(log).name === "Withdrawal"; }
        catch { return false; }
      });

      expect(withdrawalEvent).to.not.be.undefined;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 9 — Boundary Timing Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 9: Boundary Timing Edge Cases", function () {

    it("withdrawal reverts before cliff ends", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      // Stay well inside the cliff window — 1 day in, cliff is 30 days
      await time.increase(ONE_DAY);

      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("10"))
      ).to.be.revertedWith("Cliff period has not passed yet");
    });

    it("withdrawal succeeds at exactly the cliff boundary", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await time.increase(CLIFF);

      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("10"))
      ).to.not.be.reverted;
    });

    it("vault is VESTING at exactly cliff boundary", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await time.increase(CLIFF);
      expect(await vesting.vaultState()).to.equal("VESTING");
    });

    it("vault is COMPLETE at exactly vesting period boundary", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await time.increase(VESTING);
      expect(await vesting.vaultState()).to.equal("COMPLETE");
    });

    it("no penalty applies at exactly the vesting period boundary", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await time.increase(VESTING);

      const [penalty] = await vesting.previewWithdrawal(ALLOCATION);
      expect(penalty).to.equal(0);
    });

    it("vestedAmount equals totalAllocation at exactly vesting boundary", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await time.increase(VESTING);
      expect(await vesting.vestedAmount()).to.equal(ALLOCATION);
    });

    it("withdrawal with no cliff works immediately after setup", async function () {
      await vesting.fundContract(ALLOCATION);
      // Set cliff to 0 — no waiting period at all
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, 0);

      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("1"))
      ).to.not.be.reverted;
    });
  });
});
```

## Tests: DOCVesting.test.js

```javascript
// test/DOCVesting.test.js
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DOCVesting", function () {

  // ─── Shared variables ───────────────────────────────────────────────────────
  let vesting, doc;
  let admin, beneficiary, stranger;

  // Common time values (in seconds)
  const ONE_DAY    = 86400;
  const CLIFF      = ONE_DAY * 30;   // 30 days
  const VESTING    = ONE_DAY * 180;  // 180 days
  const ALLOCATION = ethers.parseEther("1000"); // 1000 DOC

  // ─── beforeEach — fresh contracts before every test ─────────────────────────
  // This means every test starts from a clean slate.
  // No test can accidentally affect another.
  beforeEach(async function () {
    [admin, beneficiary, stranger] = await ethers.getSigners();

    // Deploy mock DOC token
    const MockDOC = await ethers.getContractFactory("MockDOC");
    doc = await MockDOC.deploy();

    // Deploy the vesting contract
    const DOCVesting = await ethers.getContractFactory("DOCVesting");
    vesting = await DOCVesting.deploy(await doc.getAddress());

    // Approve the vesting contract to pull DOC from admin's wallet
    await doc.approve(await vesting.getAddress(), ethers.parseEther("100000"));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 1 — Deploy & configure
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 1: Deployment", function () {

    it("sets admin to deployer", async function () {
      expect(await vesting.admin()).to.equal(admin.address);
    });

    it("sets the DOC token address correctly", async function () {
      expect(await vesting.docToken()).to.equal(await doc.getAddress());
    });

    it("starts in NOT_CONFIGURED state", async function () {
      expect(await vesting.vaultState()).to.equal("NOT_CONFIGURED");
    });

    it("isConfigured is false before setup", async function () {
      expect(await vesting.isConfigured()).to.equal(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 2 — Fund the contract
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 2: Funding the contract", function () {

    it("allows admin to fund the contract", async function () {
      await vesting.fundContract(ALLOCATION);
      const balance = await doc.balanceOf(await vesting.getAddress());
      expect(balance).to.equal(ALLOCATION);
    });

    it("emits ContractFunded event", async function () {
      await expect(vesting.fundContract(ALLOCATION))
        .to.emit(vesting, "ContractFunded")
        .withArgs(admin.address, ALLOCATION);
    });

    it("reverts if amount is zero", async function () {
      await expect(vesting.fundContract(0))
        .to.be.revertedWith("Amount must be greater than zero");
    });

    it("reverts if a non-admin tries to fund", async function () {
      await expect(vesting.connect(stranger).fundContract(ALLOCATION))
        .to.be.revertedWith("Caller is not admin");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 3 — Set up beneficiary
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 3: Setting up beneficiary", function () {

    beforeEach(async function () {
      // Fund first, then setup — correct order
      await vesting.fundContract(ALLOCATION);
    });

    it("allows admin to set up a beneficiary", async function () {
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      expect(await vesting.beneficiary()).to.equal(beneficiary.address);
      expect(await vesting.totalAllocation()).to.equal(ALLOCATION);
      expect(await vesting.isConfigured()).to.equal(true);
    });

    it("emits BeneficiarySet event", async function () {
      await expect(vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF))
        .to.emit(vesting, "BeneficiarySet");
    });

    it("vault moves to LOCKED state after setup", async function () {
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      expect(await vesting.vaultState()).to.equal("LOCKED");
    });

    it("reverts if setup called twice", async function () {
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await expect(vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF))
        .to.be.revertedWith("Beneficiary already configured");
    });

    it("reverts if contract is not funded first", async function () {
      // Deploy a fresh unfunded vesting contract
      const DOCVesting = await ethers.getContractFactory("DOCVesting");
      const freshVesting = await DOCVesting.deploy(await doc.getAddress());
      await expect(
        freshVesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Fund the contract before setup");
    });

    it("reverts if admin tries to set themselves as beneficiary", async function () {
      await expect(
        vesting.setup(admin.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Admin cannot be beneficiary");
    });

    it("reverts if zero address is used", async function () {
      await expect(
        vesting.setup(ethers.ZeroAddress, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Zero address not allowed");
    });

    it("reverts if cliff is longer than vesting period", async function () {
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, CLIFF, VESTING)
        //                                              ^ swapped deliberately
      ).to.be.revertedWith("Cliff must be shorter than vesting period");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 4 — Locked withdrawal attempt
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 4: Withdrawal blocked during cliff (LOCKED state)", function () {

    beforeEach(async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
    });

    it("reverts when beneficiary tries to withdraw during cliff", async function () {
      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("100"))
      ).to.be.revertedWith("Cliff period has not passed yet");
    });

    it("vault state is LOCKED during cliff period", async function () {
      expect(await vesting.vaultState()).to.equal("LOCKED");
    });

    it("vestedAmount still calculates during cliff (clock runs from startTime)", async function () {
      // Advance time to halfway through cliff
      await time.increase(CLIFF / 2);
      const vested = await vesting.vestedAmount();
      // Vested should be > 0 even though withdrawal is blocked
      expect(vested).to.be.gt(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 5 — Normal withdrawal (within vested amount)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 5: Normal withdrawal after cliff (VESTING state)", function () {

    beforeEach(async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      // Jump past the cliff
      await time.increase(CLIFF + 1);
    });

    it("vault is in VESTING state after cliff", async function () {
      expect(await vesting.vaultState()).to.equal("VESTING");
    });

    it("allows withdrawal within vested amount with no penalty", async function () {
      // At cliff end (~30/180 days) roughly 16.6% is vested = ~166 DOC
      const withdrawAmount = ethers.parseEther("100"); // safely within vested

      const balanceBefore = await doc.balanceOf(beneficiary.address);
      await vesting.connect(beneficiary).withdraw(withdrawAmount);
      const balanceAfter = await doc.balanceOf(beneficiary.address);

      // Beneficiary received exact amount — no penalty deducted
      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
    });

    it("emits Withdrawal event with zero penalty and VESTING state", async function () {
      const withdrawAmount = ethers.parseEther("100");
      await expect(vesting.connect(beneficiary).withdraw(withdrawAmount))
        .to.emit(vesting, "Withdrawal")
        .withArgs(beneficiary.address, withdrawAmount, 0, "VESTING");
    });

    it("updates withdrawn correctly after normal withdrawal", async function () {
      const withdrawAmount = ethers.parseEther("100");
      await vesting.connect(beneficiary).withdraw(withdrawAmount);
      expect(await vesting.withdrawn()).to.equal(withdrawAmount);
    });

    it("reverts if a stranger tries to withdraw", async function () {
      await expect(
        vesting.connect(stranger).withdraw(ethers.parseEther("100"))
      ).to.be.revertedWith("Caller is not beneficiary");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 6 — Early exit (penalty applied)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 6: Early withdrawal with penalty (EARLY_EXIT)", function () {

    beforeEach(async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      // Jump to exactly 50% through vesting (90 days)
      await time.increase(VESTING / 2);
    });

    it("applies 20% penalty on unvested excess", async function () {
      // At 50% vesting: 500 DOC vested
      // Requesting 600 DOC → 100 DOC is unvested excess
      // Penalty = 20% of 100 = 20 DOC
      // Actual received = 580 DOC
      const withdrawAmount = ethers.parseEther("600");

      const balanceBefore = await doc.balanceOf(beneficiary.address);
      await vesting.connect(beneficiary).withdraw(withdrawAmount);
      const balanceAfter = await doc.balanceOf(beneficiary.address);

      // closeTo allows 1 DOC tolerance for block timing variance
      expect(balanceAfter - balanceBefore).to.be.closeTo(
        ethers.parseEther("580"),
        ethers.parseEther("1")
      );
      expect(await vesting.penaltyPool()).to.be.closeTo(
        ethers.parseEther("20"),
        ethers.parseEther("1")
      );
    });

    it("emits Withdrawal event with correct penalty and EARLY_EXIT state", async function () {
      const withdrawAmount = ethers.parseEther("600");

      // Execute withdrawal and check event state label
      // Exact amounts checked in the test above — event check focuses on state
      const tx = await vesting.connect(beneficiary).withdraw(withdrawAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try { return vesting.interface.parseLog(log).name === "Withdrawal"; }
        catch { return false; }
      });
      const parsed = vesting.interface.parseLog(event);

      expect(parsed.args[0]).to.equal(beneficiary.address);
      expect(parsed.args[3]).to.equal("EARLY_EXIT");
      expect(parsed.args[1]).to.be.closeTo(
        ethers.parseEther("580"),
        ethers.parseEther("1")
      );
    });

    it("previewWithdrawal returns correct penalty before transaction", async function () {
      const withdrawAmount = ethers.parseEther("600");
      const [penalty, actualReceived] = await vesting.previewWithdrawal(withdrawAmount);

      expect(penalty).to.be.closeTo(
        ethers.parseEther("20"),
        ethers.parseEther("1")
      );
      expect(actualReceived).to.be.closeTo(
        ethers.parseEther("580"),
        ethers.parseEther("1")
      );
    });

    it("penaltyPool increases after early exit", async function () {
      await vesting.connect(beneficiary).withdraw(ethers.parseEther("600"));
      expect(await vesting.penaltyPool()).to.be.gt(0);
    });

    it("reverts if withdrawal exceeds total remaining allocation", async function () {
      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("9999"))
      ).to.be.revertedWith("Exceeds remaining allocation");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 7 — Complete withdrawal (fully vested, no penalty)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 7: Full withdrawal after vesting complete (COMPLETE state)", function () {

    beforeEach(async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      // Jump past the entire vesting period
      await time.increase(VESTING + 1);
    });

    it("vault is in COMPLETE state", async function () {
      expect(await vesting.vaultState()).to.equal("COMPLETE");
    });

    it("allows full withdrawal with zero penalty", async function () {
      const balanceBefore = await doc.balanceOf(beneficiary.address);
      await vesting.connect(beneficiary).withdraw(ALLOCATION);
      const balanceAfter = await doc.balanceOf(beneficiary.address);

      expect(balanceAfter - balanceBefore).to.equal(ALLOCATION);
      expect(await vesting.penaltyPool()).to.equal(0);
    });

    it("emits Withdrawal with zero penalty and COMPLETE state", async function () {
      await expect(vesting.connect(beneficiary).withdraw(ALLOCATION))
        .to.emit(vesting, "Withdrawal")
        .withArgs(beneficiary.address, ALLOCATION, 0, "COMPLETE");
    });

    it("vestedAmount equals totalAllocation after vesting ends", async function () {
      expect(await vesting.vestedAmount()).to.equal(ALLOCATION);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BONUS — getVaultStatus returns correct snapshot
  // ═══════════════════════════════════════════════════════════════════════════
  describe("getVaultStatus snapshot", function () {

    it("returns correct data at 50% vesting", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 2);

      const status = await vesting.getVaultStatus();

      expect(status.state).to.equal("VESTING");
      expect(status._totalAllocation).to.equal(ALLOCATION);
      expect(status._withdrawn).to.equal(0);
      expect(status.vested).to.be.closeTo(
        ethers.parseEther("500"),
        ethers.parseEther("1") // allow 1 DOC tolerance for block timing
      );
    });
  });
});
```
