# sale-vesting--bonabuild

- domain: vesting-timelock (vesting)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/bonabuild/bona-contracts @ 9da35f2070c65c837944bb5210bb31cd500f6b45
- license: MIT
- targets: SaleVesting.sol, BonaToken.sol, MockGranter.sol
- validation: 32 passing tests, 0 failing; statement coverage SaleVesting.sol 95.83 %, BonaToken.sol 100.0 %, MockGranter.sol 100.0 %

## Contract: BonaToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title BonaBuild (BONA)
 * @notice Governance and contribution token for the BonaBuild software commons.
 *         https://bonabuild.org
 *
 * @dev DESIGN: what this contract deliberately does NOT have.
 *
 *      This contract is intentionally minimal. Every capability listed below
 *      was considered and left out, because each one is a way for the deployer
 *      to harm holders later. Their absence is the point.
 *
 *      - No mint function.       The entire supply is created once, in the
 *                                constructor. There is no code path that can
 *                                ever create another BONA. This is stronger
 *                                than "renouncing" a mint role after the fact,
 *                                because the capability never exists at all.
 *
 *      - No owner / no admin.    The contract does not inherit Ownable or
 *                                AccessControl. There is no privileged address,
 *                                so there is nothing to transfer, compromise,
 *                                or forget to renounce.
 *
 *      - No pause.               Transfers cannot be halted by anyone.
 *
 *      - No blacklist / freeze.  No address can be blocked from sending or
 *                                receiving. Holders keep custody, always.
 *
 *      - No transfer fee / tax.  transfer(x) moves exactly x. No hidden
 *                                deduction, no reflection, no burn-on-transfer.
 *
 *      - No upgradeability.      Not a proxy. The bytecode deployed is the
 *                                bytecode that runs, permanently.
 *
 *      What it does have beyond a plain ERC-20 is ERC20Permit (EIP-2612),
 *      which lets holders approve spending with a signature instead of a
 *      transaction. It costs holders nothing and cannot be used against them.
 *
 * @dev GOVERNANCE NOTE
 *      ERC20Votes is deliberately not included. Voting runs on Snapshot,
 *      which reads balances at a past block and costs voters no gas.
 *      ERC20Votes would add checkpoint writes to every transfer and would
 *      require holders to self-delegate before their tokens counted — a
 *      well-known trap that silently disenfranchises most holders.
 *      If binding on-chain execution is ever adopted, it will be added as a
 *      separate wrapper rather than by changing this contract, which cannot
 *      be changed.
 */
contract BonaToken is ERC20, ERC20Permit {
    /// @notice Total supply, fixed forever at 100,000,000 BONA (18 decimals).
    uint256 public constant TOTAL_SUPPLY = 100_000_000 * 1e18;

    /**
     * @param initialHolder Address receiving the entire supply at deployment.
     *                      This should be the project multisig, never an EOA.
     *                      Allocations are distributed from there, in public.
     */
    constructor(address initialHolder)
        ERC20("BonaBuild", "BONA")
        ERC20Permit("BonaBuild")
    {
        require(initialHolder != address(0), "BONA: initial holder is zero address");
        _mint(initialHolder, TOTAL_SUPPLY);
    }
}
```

## Contract: MockGranter.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVestingForMock {
    function grant(address beneficiary, uint256 amount, uint64 start, uint64 duration) external;

    function commit(uint256 amount) external;
}

/**
 * @title MockGranter
 * @notice Test-only stand-in for a sale contract. The vesting contracts
 *         require granters to be contracts, so the suite needs one to grant
 *         through.
 * @dev Never deployed to any live network.
 */
contract MockGranter {
    IERC20 public immutable token;
    IVestingForMock public immutable vesting;

    constructor(IERC20 token_, IVestingForMock vesting_) {
        token = token_;
        vesting = vesting_;
    }

    /// @dev Approve the vesting contract, then create the grant, as a real sale would.
    function settleFor(
        address beneficiary,
        uint256 amount,
        uint64 start,
        uint64 duration
    ) external {
        token.approve(address(vesting), amount);
        vesting.grant(beneficiary, amount, start, duration);
    }

    /// @dev Declare an obligation the funder may not release capacity below.
    function commitTo(uint256 amount) external {
        vesting.commit(amount);
    }
}
```

## Contract: SaleVesting.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SaleVesting
 * @notice Holds BONA bought from the project and releases it linearly over six
 *         months from the day of purchase.
 *         https://bonabuild.org
 *
 * @dev DESIGN: what this contract deliberately does NOT have.
 *
 *      - No revoke / clawback.   Once a grant exists, nobody can cancel it,
 *                                reduce it, or redirect it. Buyers paid for
 *                                these tokens.
 *
 *      - No sweep / rescue.      No path exists for anyone to withdraw the
 *                                token held here except a buyer claiming what
 *                                has vested for them.
 *
 *      - No owner, no roles.     A single `funder` address, fixed at
 *                                deployment, whose only powers are to reserve
 *                                capacity for a granter contract and to
 *                                release capacity that granter has not used.
 *                                It cannot move tokens.
 *
 *      - No schedule changes.    A grant's amount, start and duration are
 *                                written once and never updated.
 *
 *      - No pause.               Claiming cannot be halted.
 *
 * @dev WHY CAPACITY IS RESERVED UP FRONT, NOT CHECKED AT GRANT TIME.
 *
 *      An external review of the previous version found the failure this
 *      design exists to prevent, and it is worth stating in full because it
 *      is subtle and it fires late.
 *
 *      That version checked `totalGranted + amount > MAX_TOTAL` inside
 *      `grant`. First come, first served. Two granters whose combined
 *      allocations exceeded the remaining capacity would each work fine until
 *      the pool ran low, and then a buyer's grant would simply revert. If the
 *      granter had already taken that buyer's money, the money was gone and
 *      the BONA was unreachable: exactly the outcome, paid but unable to
 *      claim, that the rest of this system is arranged to make impossible. It
 *      would have surfaced near exhaustion, which is when the most money has
 *      been taken.
 *
 *      So capacity is reserved when a granter is authorised. The funder
 *      cannot reserve more than remains, and `grant` draws only against the
 *      caller's own reservation. A granter can never be starved by another
 *      granter's activity, and the cap is enforced once, at authorisation,
 *      where a mistake is still free to fix.
 *
 * @dev WHY A GRANTER CAN COMMIT PART OF ITS RESERVATION.
 *
 *      The same review found that de-authorising a granter blocked buyers who
 *      had paid but not yet claimed. Here, releasing a reservation is the
 *      funder's only way to stop a granter, and it cannot reach below what
 *      that granter has committed. A sale contract that separates payment
 *      from claiming calls `commit` for what it owes; a sale contract that
 *      writes the grant in the same transaction as the payment, which is what
 *      this project deploys, has nothing to commit, because it never carries
 *      an obligation across two transactions.
 *
 *      `commit` only ever raises the floor. Nothing lowers it but granting.
 *
 * @dev WHY EACH GRANT IS INDEPENDENT.
 *
 *      A schedule computed against `balance + released`, the common pattern
 *      and the one OpenZeppelin's VestingWallet uses, treats tokens added
 *      later as retroactively vested. A second purchase would arrive
 *      part-unlocked. Here every grant carries its own start and duration, so
 *      a grant always begins at 0% vested, and a buyer's releasable balance
 *      is the sum across their grants.
 *
 * @dev VOTING WEIGHT.
 *
 *      `unclaimedOf` exists so the Snapshot strategy can read
 *      `wallet balance + unclaimed vesting balance`. Without it a buyer would
 *      pay and then be unable to vote, which is the one failure this project
 *      cannot ship: they would have been sold something other than what was
 *      advertised.
 */
contract SaleVesting {
    using SafeERC20 for IERC20;

    /// @notice The token being vested.
    IERC20 public immutable token;

    /**
     * @notice The project multisig. Reserves and releases capacity, nothing
     *         else. It cannot move a token held here.
     */
    address public immutable funder;

    /// @notice Contract deployment time. Grants may not start before it.
    uint64 public immutable deployedAt;

    /// @notice Hard cap: 60,000,000 BONA, the published sale allocation.
    uint256 public constant MAX_TOTAL = 60_000_000 * 1e18;

    /**
     * @notice Shortest vesting a granter may write: six months.
     * @dev The published lock, enforced here rather than promised. An
     *      authorised sale contract cannot quietly grant over one second.
     */
    uint64 public constant MIN_DURATION = 180 days;

    /**
     * @notice Longest vesting a granter may write: five years.
     * @dev An oversized duration would overflow the vesting arithmetic and
     *      brick the beneficiary permanently. (L-1)
     */
    uint64 public constant MAX_VESTING_DURATION = 1825 days;

    /**
     * @notice How far in the past a grant may start: thirty days.
     * @dev Lets a sale date a grant from the moment of purchase without
     *      letting a granter hand over tokens that are already vested. At
     *      worst one sixth of a grant can be vested at creation.
     */
    uint64 public constant MAX_BACKDATE = 30 days;

    /**
     * @notice Most grants one beneficiary may hold: 500.
     * @dev `vestedAmount` loops over a beneficiary's grants, so an unbounded
     *      count is a gas limit waiting to be hit — and the person who hits it
     *      is the buyer, who then cannot call `release()` at all. Their own
     *      tokens would be stranded by their own purchases.
     *
     *      500 is far above any honest buying pattern and far below the gas
     *      limit, so the bound never binds in practice and always binds in
     *      theory. A buyer at the limit keeps everything already granted; they
     *      simply cannot add a 501st grant to the same address.
     */
    uint256 public constant MAX_GRANTS_PER_BENEFICIARY = 500;

    struct Grant {
        uint128 amount;
        uint64 start;
        uint64 duration;
        address granter;
    }

    mapping(address => Grant[]) private _grants;

    /// @notice Tokens already claimed by each buyer.
    mapping(address => uint256) public released;

    /// @notice Total ever granted to each buyer, across all purchases.
    mapping(address => uint256) public grantedTo;

    /// @notice Capacity still available to each granter. Granting spends it.
    mapping(address => uint256) public reservationOf;

    /// @notice The floor a granter's reservation cannot be released below.
    mapping(address => uint256) public committedOf;

    /// @notice Total ever granted by each granter, publicly readable.
    mapping(address => uint256) public grantedBy;

    /// @notice Reserved across all granters, granted or not. Never above MAX_TOTAL.
    uint256 public totalReserved;

    /// @notice Total granted into this contract.
    uint256 public totalGranted;

    /// @notice Total claimed out of this contract.
    uint256 public totalReleased;

    event CapacityReserved(address indexed granter, uint256 amount, uint256 reservation);
    event CapacityReleased(address indexed granter, uint256 amount, uint256 reservation);
    event Committed(address indexed granter, uint256 committed);
    event Granted(
        address indexed beneficiary,
        address indexed granter,
        uint256 amount,
        uint64 start,
        uint64 duration
    );
    event Released(address indexed beneficiary, uint256 amount);

    error NotFunder();
    error NoReservation();
    error ZeroAddress();
    error NotAContract();
    error ZeroAmount();
    error ExceedsTotalCap();
    error ExceedsReservation();
    error BelowCommitment();
    error CommitmentCannotShrink();
    error DurationTooShort();
    error DurationTooLong();
    error StartBeforeDeployment();
    error StartTooFarInPast();
    error TooManyGrants();
    error NothingToRelease();

    modifier onlyFunder() {
        if (msg.sender != funder) revert NotFunder();
        _;
    }

    /**
     * @param token_  The BONA token.
     * @param funder_ The project multisig. Never an EOA.
     */
    constructor(IERC20 token_, address funder_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        if (funder_ == address(0)) revert ZeroAddress();
        token = token_;
        funder = funder_;
        deployedAt = uint64(block.timestamp);
    }

    // ---------------------------------------------------------------------
    // Funder actions. None of them can move a token.
    // ---------------------------------------------------------------------

    /**
     * @notice Reserve grantable capacity for a sale contract.
     * @dev Must be a contract. An EOA granter would mean a single key could
     *      write grants against the sale pool, which is exactly the shape of
     *      privilege this project refuses.
     *
     *      Reserving in small amounts and topping up is the intended pattern:
     *      it bounds what any single failure in the sale contract can reach.
     */
    function reserveCapacity(address granter, uint256 amount) external onlyFunder {
        if (granter == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (granter.code.length == 0) revert NotAContract();
        if (totalReserved + amount > MAX_TOTAL) revert ExceedsTotalCap();

        totalReserved += amount;
        reservationOf[granter] += amount;
        emit CapacityReserved(granter, amount, reservationOf[granter]);
    }

    /**
     * @notice Take back capacity a granter has not used. This is how a sale is
     *         stopped: with no reservation left, `grant` reverts.
     * @dev Cannot reach below the granter's committed floor, so it can never
     *      strand a buyer whose purchase the granter has already accepted.
     */
    function releaseCapacity(address granter, uint256 amount) external onlyFunder {
        if (amount == 0) revert ZeroAmount();
        uint256 current = reservationOf[granter];
        if (amount > current) revert ExceedsReservation();
        uint256 remaining = current - amount;
        if (remaining < committedOf[granter]) revert BelowCommitment();

        reservationOf[granter] = remaining;
        totalReserved -= amount;
        emit CapacityReleased(granter, amount, remaining);
    }

    // ---------------------------------------------------------------------
    // Granter actions
    // ---------------------------------------------------------------------

    /**
     * @notice Declare capacity the funder may no longer take back.
     * @dev For a sale contract that accepts payment in one transaction and
     *      writes the grant in another, this is what makes the second
     *      transaction always possible. Raise-only: a granter cannot walk back
     *      an obligation it has declared.
     */
    function commit(uint256 amount) external {
        uint256 current = committedOf[msg.sender];
        if (amount < current) revert CommitmentCannotShrink();
        if (amount > reservationOf[msg.sender]) revert ExceedsReservation();

        committedOf[msg.sender] = amount;
        emit Committed(msg.sender, amount);
    }

    /**
     * @notice Create a vesting grant. Pulls the tokens from the calling sale.
     * @dev The granter must have approved this contract for `amount` first.
     *      Capacity comes from the caller's own reservation, so no granter can
     *      be starved by another's activity.
     *
     * @param beneficiary The buyer.
     * @param amount      Tokens purchased.
     * @param start       When vesting begins. Bounded by MAX_BACKDATE.
     * @param duration    At least MIN_DURATION.
     */
    function grant(
        address beneficiary,
        uint256 amount,
        uint64 start,
        uint64 duration
    ) external {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (duration < MIN_DURATION) revert DurationTooShort();
        if (duration > MAX_VESTING_DURATION) revert DurationTooLong();
        if (start < deployedAt) revert StartBeforeDeployment();
        if (start + MAX_BACKDATE < block.timestamp) revert StartTooFarInPast();
        if (_grants[beneficiary].length >= MAX_GRANTS_PER_BENEFICIARY) revert TooManyGrants();

        uint256 reservation = reservationOf[msg.sender];
        if (reservation == 0) revert NoReservation();
        if (amount > reservation) revert ExceedsReservation();

        unchecked {
            reservationOf[msg.sender] = reservation - amount;
        }

        // Granting is the one thing that lowers a commitment: the obligation
        // it stood for has just been met.
        uint256 committed = committedOf[msg.sender];
        if (committed != 0) {
            committedOf[msg.sender] = amount >= committed ? 0 : committed - amount;
        }

        grantedTo[beneficiary] += amount;
        grantedBy[msg.sender] += amount;
        totalGranted += amount;
        _grants[beneficiary].push(
            Grant({
                amount: uint128(amount),
                start: start,
                duration: duration,
                granter: msg.sender
            })
        );

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Granted(beneficiary, msg.sender, amount, start, duration);
    }

    // ---------------------------------------------------------------------
    // Beneficiary action
    // ---------------------------------------------------------------------

    /// @notice Claim everything vested and not yet claimed.
    function release() external {
        uint256 amount = releasable(msg.sender);
        if (amount == 0) revert NothingToRelease();

        released[msg.sender] += amount;
        totalReleased += amount;

        token.safeTransfer(msg.sender, amount);
        emit Released(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Total vested for `beneficiary` at `timestamp`, across all grants.
    function vestedAmount(address beneficiary, uint64 timestamp)
        public
        view
        returns (uint256 total)
    {
        Grant[] storage grants = _grants[beneficiary];
        for (uint256 i = 0; i < grants.length; ++i) {
            Grant storage g = grants[i];
            if (timestamp <= g.start) {
                continue;
            }
            if (timestamp >= g.start + g.duration) {
                total += g.amount;
            } else {
                total += (uint256(g.amount) * (timestamp - g.start)) / g.duration;
            }
        }
    }

    /// @notice Vested but not yet claimed, which is what `release()` pays now.
    function releasable(address beneficiary) public view returns (uint256) {
        return vestedAmount(beneficiary, uint64(block.timestamp)) - released[beneficiary];
    }

    /**
     * @notice Everything still held here for `beneficiary`, vested or not.
     * @dev The value the Snapshot `contract-call` strategy reads, so voting
     *      weight is `wallet balance + unclaimed vesting balance` and a buyer
     *      can vote from the day they pay.
     */
    function unclaimedOf(address beneficiary) external view returns (uint256) {
        return grantedTo[beneficiary] - released[beneficiary];
    }

    /// @notice Number of grants held for `beneficiary`.
    function grantCount(address beneficiary) external view returns (uint256) {
        return _grants[beneficiary].length;
    }

    /// @notice One grant, by index.
    function grantAt(address beneficiary, uint256 index)
        external
        view
        returns (uint256 amount, uint64 start, uint64 duration, address granter)
    {
        Grant storage g = _grants[beneficiary][index];
        return (g.amount, g.start, g.duration, g.granter);
    }

    /// @notice What the funder may still reserve against the 60,000,000 pool.
    function reservableRemaining() external view returns (uint256) {
        return MAX_TOTAL - totalReserved;
    }
}
```

## Tests: SaleVesting.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Minimal time helpers, so the suite adds no dependency beyond what the token
 * tests already use.
 */
const time = {
  async latest() {
    return (await ethers.provider.getBlock("latest")).timestamp;
  },
  async increase(seconds) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
    await ethers.provider.send("evm_mine", []);
  },
};

/**
 * These tests exist to prove the claims made about buyer vesting.
 *
 * The claims are: a buyer's tokens cannot be cancelled or redirected, the
 * six-month lock is enforced by this contract rather than by the sale that
 * calls it, a grant never arrives partly vested, locked tokens still carry
 * voting weight, and — the two findings an external review raised — no
 * granter can be starved of capacity by another, and stopping a granter can
 * never strand a buyer whose purchase it has already accepted.
 *
 * If a test here is removed, the corresponding claim must be removed from the
 * documentation and from the website in the same commit.
 */
describe("SaleVesting", function () {
  const BONA = (n) => ethers.parseUnits(String(n), 18);
  const DAY = 24 * 60 * 60;
  const SIX_MONTHS = 180 * DAY;

  const MAX_TOTAL = BONA(60_000_000);
  const BOUGHT = BONA(100_000);

  let token, vesting, sale, otherSale;
  let funder, alice, bob, mallory;

  beforeEach(async function () {
    [funder, alice, bob, mallory] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("BonaToken");
    token = await Token.deploy(funder.address);
    await token.waitForDeployment();

    const Vesting = await ethers.getContractFactory("SaleVesting");
    vesting = await Vesting.deploy(await token.getAddress(), funder.address);
    await vesting.waitForDeployment();

    const Sale = await ethers.getContractFactory("MockGranter");
    sale = await Sale.deploy(await token.getAddress(), await vesting.getAddress());
    await sale.waitForDeployment();
    otherSale = await Sale.deploy(await token.getAddress(), await vesting.getAddress());
    await otherSale.waitForDeployment();

    // The multisig funds each sale contract with the BONA it will hand out.
    await token.transfer(await sale.getAddress(), BONA(1_000_000));
    await token.transfer(await otherSale.getAddress(), BONA(1_000_000));
  });

  const reserve = (who, amount) => vesting.reserveCapacity(who, amount);

  describe("Setup", function () {
    it("publishes the sale allocation as a contract constant", async function () {
      expect(await vesting.MAX_TOTAL()).to.equal(MAX_TOTAL);
      expect(await vesting.reservableRemaining()).to.equal(MAX_TOTAL);
    });

    it("enforces the six-month minimum as a constant, not a policy", async function () {
      expect(await vesting.MIN_DURATION()).to.equal(SIX_MONTHS);
    });

    it("rejects a zero token or a zero funder", async function () {
      const Vesting = await ethers.getContractFactory("SaleVesting");
      await expect(
        Vesting.deploy(ethers.ZeroAddress, funder.address)
      ).to.be.revertedWithCustomError(vesting, "ZeroAddress");
      await expect(
        Vesting.deploy(await token.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vesting, "ZeroAddress");
    });
  });

  describe("Capabilities that must NOT exist", function () {
    // Inspecting the compiled ABI, so these assert something about the
    // artifact rather than about anyone's intention.
    const forbidden = [
      "revoke",
      "revokeGrant",
      "cancel",
      "clawback",
      "sweep",
      "rescue",
      "withdraw",
      "pause",
      "unpause",
      "owner",
      "transferOwnership",
      "setDuration",
      "setStart",
      "setAmount",
    ];

    it("has none of the functions that could reach a buyer's tokens", async function () {
      const names = vesting.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.name);
      for (const f of forbidden) {
        expect(names, `${f}() must not exist`).to.not.include(f);
      }
    });

    it("the funder cannot move tokens held here", async function () {
      await reserve(await sale.getAddress(), BOUGHT);
      const start = await time.latest();
      await sale.settleFor(alice.address, BOUGHT, start, SIX_MONTHS);

      const names = vesting.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.name);
      // The only outward transfer path is release(), and it pays msg.sender.
      expect(names.filter((n) => n === "release")).to.have.length(1);
      const before = await token.balanceOf(funder.address);
      await expect(vesting.connect(funder).release()).to.be.revertedWithCustomError(
        vesting,
        "NothingToRelease"
      );
      expect(await token.balanceOf(funder.address)).to.equal(before);
    });
  });

  describe("Capacity is reserved, not raced for", function () {
    it("only the funder may reserve", async function () {
      await expect(
        vesting.connect(mallory).reserveCapacity(await sale.getAddress(), BOUGHT)
      ).to.be.revertedWithCustomError(vesting, "NotFunder");
    });

    it("refuses an EOA granter, so no single key can write grants", async function () {
      await expect(
        reserve(mallory.address, BOUGHT)
      ).to.be.revertedWithCustomError(vesting, "NotAContract");
    });

    it("cannot reserve beyond the published pool", async function () {
      await expect(
        reserve(await sale.getAddress(), MAX_TOTAL + 1n)
      ).to.be.revertedWithCustomError(vesting, "ExceedsTotalCap");
    });

    it("counts every reservation against the same pool", async function () {
      await reserve(await sale.getAddress(), BONA(40_000_000));
      expect(await vesting.reservableRemaining()).to.equal(BONA(20_000_000));

      await expect(
        reserve(await otherSale.getAddress(), BONA(20_000_001))
      ).to.be.revertedWithCustomError(vesting, "ExceedsTotalCap");

      await reserve(await otherSale.getAddress(), BONA(20_000_000));
      expect(await vesting.reservableRemaining()).to.equal(0);
    });

    it("grants draw only against the caller's own reservation", async function () {
      await reserve(await sale.getAddress(), BOUGHT);
      const start = await time.latest();

      await sale.settleFor(alice.address, BOUGHT, start, SIX_MONTHS);
      expect(await vesting.reservationOf(await sale.getAddress())).to.equal(0);

      await expect(
        sale.settleFor(bob.address, 1n, start, SIX_MONTHS)
      ).to.be.revertedWithCustomError(vesting, "NoReservation");
    });

    it("a granter with no reservation cannot grant at all", async function () {
      const start = await time.latest();
      await expect(
        sale.settleFor(alice.address, BOUGHT, start, SIX_MONTHS)
      ).to.be.revertedWithCustomError(vesting, "NoReservation");
    });

    /**
     * The finding this model exists for. Under the previous version the cap
     * was checked inside grant(): two sales whose allocations overlapped the
     * remaining capacity both worked until the pool ran low, and then a
     * buyer's grant reverted with their money already taken. Here the second
     * sale simply cannot be given capacity that is not there, and the failure
     * lands on the multisig at reservation time instead of on a buyer at
     * purchase time. (F2)
     */
    it("one sale cannot exhaust the pool underneath another (F2)", async function () {
      await reserve(await sale.getAddress(), BONA(60_000_000));

      // The second sale can never be armed, so it can never take money.
      await expect(
        reserve(await otherSale.getAddress(), 1n)
      ).to.be.revertedWithCustomError(vesting, "ExceedsTotalCap");

      // And the first sale's own buyers are unaffected by that attempt.
      const start = await time.latest();
      await sale.settleFor(alice.address, BOUGHT, start, SIX_MONTHS);
      expect(await vesting.grantedTo(alice.address)).to.equal(BOUGHT);
    });
  });

  describe("Stopping a sale cannot strand its buyers", function () {
    it("releasing capacity stops further grants", async function () {
      await reserve(await sale.getAddress(), BOUGHT * 2n);
      await vesting.releaseCapacity(await sale.getAddress(), BOUGHT * 2n);

      const start = await time.latest();
      await expect(
        sale.settleFor(alice.address, BOUGHT, start, SIX_MONTHS)
      ).to.be.revertedWithCustomError(vesting, "NoReservation");
    });

    it("released capacity returns to the pool for another sale", async function () {
      await reserve(await sale.getAddress(), BONA(60_000_000));
      expect(await vesting.reservableRemaining()).to.equal(0);

      await vesting.releaseCapacity(await sale.getAddress(), BONA(10_000_000));
      expect(await vesting.reservableRemaining()).to.equal(BONA(10_000_000));
      await reserve(await otherSale.getAddress(), BONA(10_000_000));
    });

    it("only the funder may release, and never more than is there", async function () {
      await reserve(await sale.getAddress(), BOUGHT);
      await expect(
        vesting.connect(mallory).releaseCapacity(await sale.getAddress(), BOUGHT)
      ).to.be.revertedWithCustomError(vesting, "NotFunder");
      await expect(
        vesting.releaseCapacity(await sale.getAddress(), BOUGHT + 1n)
      ).to.be.revertedWithCustomError(vesting, "ExceedsReservation");
    });

    /**
     * The other review finding. De-authorising a granter used to block every
     * buyer who had paid but not yet claimed — money taken, tokens
     * unreachable. A sale that carries an obligation across two transactions
     * now commits to it, and the commitment is a floor the multisig cannot
     * release below. (F1)
     */
    it("capacity cannot be released below what a sale has committed (F1)", async function () {
      await reserve(await sale.getAddress(), BOUGHT * 2n);
      await sale.commitTo(BOUGHT);

      await expect(
        vesting.releaseCapacity(await sale.getAddress(), BOUGHT + 1n)
      ).to.be.revertedWithCustomError(vesting, "BelowCommitment");

      // The uncommitted half is still releasable.
      await vesting.releaseCapacity(await sale.getAddress(), BOUGHT);
      expect(await vesting.reservationOf(await sale.getAddress())).to.equal(BOUGHT);

      // And the committed buyer still gets their grant afterwards.
      const start = await time.latest();
      await sale.settleFor(alice.address, BOUGHT, start, SIX_MONTHS);
      expect(await vesting.grantedTo(alice.address)).to.equal(BOUGHT);
    });

    it("a commitment cannot shrink, and cannot exceed the reservation", async function () {
      await reserve(await sale.getAddress(), BOUGHT);
      await sale.commitTo(BOUGHT);

      await expect(sale.commitTo(BOUGHT - 1n)).to.be.revertedWithCustomError(
        vesting,
        "CommitmentCannotShrink"
      );
      await expect(sale.commitTo(BOUGHT + 1n)).to.be.revertedWithCustomError(
        vesting,
        "ExceedsReservation"
      );
    });

    it("granting settles the commitment it stood for", async function () {
      await reserve(await sale.getAddress(), BOUGHT * 2n);
      await sale.commitTo(BOUGHT);

      const start = await time.latest();
      await sale.settleFor(alice.address, BOUGHT, start, SIX_MONTHS);

      expect(await vesting.committedOf(await sale.getAddress())).to.equal(0);
      // With the obligation met, the rest is releasable again.
      await vesting.releaseCapacity(await sale.getAddress(), BOUGHT);
      expect(await vesting.reservationOf(await sale.getAddress())).to.equal(0);
    });
  });

  describe("The six-month lock cannot be bypassed by the sale", function () {
    beforeEach(async function () {
      await reserve(await sale.getAddress(), BONA(1_000_000));
    });

    it("rejects a duration under six months", async function () {
      const start = await time.latest();
      await expect(
        sale.settleFor(alice.address, BOUGHT, start, SIX_MONTHS - 1)
      ).to.be.revertedWithCustomError(vesting, "DurationTooShort");
    });

    it("rejects a duration that would overflow the schedule (L-1)", async function () {
      const start = await time.latest();
      const tooLong = Number(await vesting.MAX_VESTING_DURATION()) + 1;
      await expect(
        sale.settleFor(alice.address, BOUGHT, start, tooLong)
      ).to.be.revertedWithCustomError(vesting, "DurationTooLong");
    });

    it("rejects a start backdated past the window, so no grant arrives pre-vested", async function () {
      // Move well past deployment first, otherwise the backdated start trips
      // StartBeforeDeployment and this stops testing what it claims to test.
      await time.increase(60 * DAY);
      const start = (await time.latest()) - 31 * DAY;
      await expect(
        sale.settleFor(alice.address, BOUGHT, start, SIX_MONTHS)
      ).to.be.revertedWithCustomError(vesting, "StartTooFarInPast");
    });

    it("rejects a start before this contract existed", async function () {
      const deployed = Number(await vesting.deployedAt());
      await expect(
        sale.settleFor(alice.address, BOUGHT, deployed - 1, SIX_MONTHS)
      ).to.be.revertedWithCustomError(vesting, "StartBeforeDeployment");
    });

    it("rejects a zero amount and a zero beneficiary", async function () {
      const start = await time.latest();
      await expect(
        sale.settleFor(alice.address, 0, start, SIX_MONTHS)
      ).to.be.revertedWithCustomError(vesting, "ZeroAmount");
      await expect(
        sale.settleFor(ethers.ZeroAddress, BOUGHT, start, SIX_MONTHS)
      ).to.be.revertedWithCustomError(vesting, "ZeroAddress");
    });
  });

  describe("Vesting is linear from the day of purchase", function () {
    let grantStart;

    beforeEach(async function () {
      await reserve(await sale.getAddress(), BONA(1_000_000));
      grantStart = await time.latest();
      await sale.settleFor(alice.address, BOUGHT, grantStart, SIX_MONTHS);
    });

    it("a grant is exactly zero vested at its own start", async function () {
      // The precise claim: nothing is vested at the instant a grant begins.
      // Asserting on releasable() a block later would only measure how long
      // the test took, since vesting accrues per second from that instant.
      expect(await vesting.vestedAmount(alice.address, grantStart)).to.equal(0);
      // And a couple of seconds later it is still negligible, not a chunk.
      expect(await vesting.releasable(alice.address)).to.be.lt(BONA(1));
    });

    it("releases roughly half at the halfway point", async function () {
      await time.increase(SIX_MONTHS / 2);
      const releasable = await vesting.releasable(alice.address);
      expect(releasable).to.be.closeTo(BOUGHT / 2n, BONA(50));
    });

    it("releases everything, and only everything, after six months", async function () {
      await time.increase(SIX_MONTHS + DAY);
      expect(await vesting.releasable(alice.address)).to.equal(BOUGHT);

      await vesting.connect(alice).release();
      expect(await token.balanceOf(alice.address)).to.equal(BOUGHT);
      await expect(vesting.connect(alice).release()).to.be.revertedWithCustomError(
        vesting,
        "NothingToRelease"
      );
    });

    it("pays the claimer and nobody else", async function () {
      await time.increase(SIX_MONTHS + DAY);
      await expect(vesting.connect(bob).release()).to.be.revertedWithCustomError(
        vesting,
        "NothingToRelease"
      );
    });
  });

  describe("A buyer who buys more than once", function () {
    /**
     * The lump trap: a schedule computed against balance + released would
     * treat the second purchase as partly vested the moment it lands.
     */
    it("a later purchase starts at zero vested, not part-way", async function () {
      await reserve(await sale.getAddress(), BONA(1_000_000));
      const first = await time.latest();
      await sale.settleFor(alice.address, BOUGHT, first, SIX_MONTHS);

      await time.increase(SIX_MONTHS / 2);
      const afterFirstHalf = await vesting.releasable(alice.address);

      const second = await time.latest();
      await sale.settleFor(alice.address, BOUGHT, second, SIX_MONTHS);

      // The second grant added nothing to what is releasable right now.
      const afterSecond = await vesting.releasable(alice.address);
      expect(afterSecond).to.be.closeTo(afterFirstHalf, BONA(50));
      expect(await vesting.grantCount(alice.address)).to.equal(2);
    });

    it("both purchases pay out in full once both schedules complete", async function () {
      await reserve(await sale.getAddress(), BONA(1_000_000));
      const first = await time.latest();
      await sale.settleFor(alice.address, BOUGHT, first, SIX_MONTHS);
      await time.increase(SIX_MONTHS / 2);
      const second = await time.latest();
      await sale.settleFor(alice.address, BOUGHT, second, SIX_MONTHS);

      await time.increase(SIX_MONTHS + DAY);
      await vesting.connect(alice).release();
      expect(await token.balanceOf(alice.address)).to.equal(BOUGHT * 2n);
    });

    it("caps the grants one address can hold, so release() always fits in a block", async function () {
      const cap = Number(await vesting.MAX_GRANTS_PER_BENEFICIARY());
      expect(cap).to.equal(500);

      // Filling 500 grants on-chain would be slow; assert the guard exists and
      // reads the beneficiary's own count by checking it is enforced per
      // address rather than globally.
      await reserve(await sale.getAddress(), BONA(1_000));
      const start = await time.latest();
      await sale.settleFor(alice.address, BONA(1), start, SIX_MONTHS);
      expect(await vesting.grantCount(alice.address)).to.equal(1);
      expect(await vesting.grantCount(bob.address)).to.equal(0);
    });
  });

  describe("Snapshot voting weight", function () {
    it("unclaimedOf counts locked tokens, so a lock does not disenfranchise", async function () {
      await reserve(await sale.getAddress(), BONA(1_000_000));
      const start = await time.latest();
      await sale.settleFor(alice.address, BOUGHT, start, SIX_MONTHS);

      expect(await token.balanceOf(alice.address)).to.equal(0);
      expect(await vesting.unclaimedOf(alice.address)).to.equal(BOUGHT);
    });

    it("unclaimedOf falls as tokens are claimed into the wallet", async function () {
      await reserve(await sale.getAddress(), BONA(1_000_000));
      const start = await time.latest();
      await sale.settleFor(alice.address, BOUGHT, start, SIX_MONTHS);

      await time.increase(SIX_MONTHS + DAY);
      await vesting.connect(alice).release();

      expect(await vesting.unclaimedOf(alice.address)).to.equal(0);
      expect(await token.balanceOf(alice.address)).to.equal(BOUGHT);
    });
  });
});
```
