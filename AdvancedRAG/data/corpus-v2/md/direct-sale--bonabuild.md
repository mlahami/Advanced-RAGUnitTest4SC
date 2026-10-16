# direct-sale--bonabuild

- domain: fungible-tokens (token-sale)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/bonabuild/bona-contracts @ 9da35f2070c65c837944bb5210bb31cd500f6b45
- license: MIT
- targets: DirectSale.sol, BonaToken.sol, Mocks.sol
- validation: 23 passing tests, 0 failing; statement coverage DirectSale.sol 100.0 %, BonaToken.sol 100.0 %, Mocks.sol 50.0 %

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

## Contract: DirectSale.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DirectSale
 * @notice Sells BONA for USDC at one published price, continuously, to anyone.
 *         The BONA lands in the buyer's wallet in the transaction they pay in.
 *         https://bonabuild.org
 *
 * @dev THE ONE PROPERTY THIS CONTRACT EXISTS TO HAVE.
 *
 *      Payment and delivery happen in the same transaction. The buyer's USDC
 *      moves to the treasury and the BONA moves to the buyer in a single
 *      call, so either both happen or neither does. There is no window in
 *      which the project holds money that has not yet bought anything, and no
 *      state in which a buyer has paid and holds nothing.
 *
 *      That is not a small detail. The two worst findings in this project's
 *      external review were both instances of the opposite shape: a sale that
 *      takes money in one transaction and delivers in another can fail in
 *      between, and when it does, the money is gone and the tokens are
 *      unreachable. Removing the gap removes the entire class.
 *
 * @dev WHY THE TOKENS GO STRAIGHT TO THE WALLET.
 *
 *      The first version of this sale wrote a six-month vesting grant instead
 *      of transferring. It was correct and it was tested, and it had one
 *      effect nothing in the code could fix: a buyer who had just paid opened
 *      their wallet and saw zero. A purchase that leaves nothing visible is
 *      indistinguishable from a purchase that failed, and the tokens could
 *      not be moved, could not be used to back a request, and could only be
 *      claimed a fraction at a time. The grants written by that version stay
 *      exactly as they were, in the vesting contract, claimable by their
 *      owners on the schedule they were sold on. This version simply
 *      transfers.
 *
 * @dev DESIGN: what this contract deliberately does NOT have.
 *
 *      - No owner, no admin.     A single `treasury` address, fixed at
 *                                deployment, which receives the USDC and may
 *                                take back unsold BONA. It cannot touch a
 *                                buyer's tokens, because this contract never
 *                                holds them: they go straight to the buyer.
 *
 *      - No pause.               The sale is stopped by the treasury taking
 *                                back this contract's BONA balance. A pause
 *                                switch inside the sale would be one more
 *                                privileged lever for no extra safety.
 *
 *      - No price change.        `bonaPerUsdc` is immutable. The price the
 *                                first buyer paid is the price the last buyer
 *                                pays. There are no tiers, no volume
 *                                discounts, no early-bird rate and no
 *                                referral bonus: the amount of BONA a dollar
 *                                buys does not depend on who is spending it
 *                                or when.
 *
 *      - No lock, no vesting.    What is bought is delivered. A buyer can
 *                                hold it, move it, vote with it or lock it
 *                                behind a request the moment the transaction
 *                                confirms.
 *
 *      - No escrow, no refund.   Nothing is held back, so there is nothing to
 *                                release and nothing to return.
 *
 *      - No ETH lane.            USDC only. A frozen BONA/ETH rate drifts as
 *                                ETH moves, and a live one would put an
 *                                oracle in charge of the price. Anyone
 *                                holding ETH can swap to USDC on Base for a
 *                                few cents; that is a better trade than
 *                                either alternative.
 *
 *      - No other stablecoin.    Accepting USDT alongside USDC at a fixed
 *                                one-to-one would mean that whenever the two
 *                                diverge, buyers pay in the cheaper one and
 *                                the project absorbs the difference on every
 *                                sale. Both have broken their peg before.
 *
 * @dev WHY THE TOKENS ARRIVE IN INSTALMENTS.
 *
 *      This contract sells only the BONA it holds. The multisig tops it up
 *      in small amounts rather than handing over the whole allocation, so
 *      the most any single failure here can reach is the current instalment
 *      rather than the entire sale pool. `maxBona` is the ceiling for this
 *      contract across its whole life and cannot be raised.
 *
 * @dev WHAT A BUYER GETS, STATED PLAINLY.
 *
 *      BONA in their wallet, voting weight from the moment of purchase, and a
 *      permanent public record of the purchase. It is not a share, it
 *      carries no claim on revenue, and it comes with no promise of return.
 *      There is no buy-back and no price floor. The software this funds is
 *      free to every member whether or not they ever hold a unit.
 */
contract DirectSale is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The token being sold.
    IERC20 public immutable bona;

    /// @notice The token accepted as payment. USDC on Base, six decimals.
    IERC20 public immutable usdc;

    /// @notice The project multisig. Receives every dollar, holds no buyer tokens.
    address public immutable treasury;

    /// @notice BONA-wei per one whole USDC. Immutable: one price, for everyone.
    uint256 public immutable bonaPerUsdc;

    /// @notice Ceiling on what this contract can ever sell. Cannot be raised.
    uint256 public immutable maxBona;

    /**
     * @notice Smallest purchase: one whole USDC.
     * @dev Not a barrier — it is a fifth of a cent above nothing at this
     *      price. It exists so that the public purchase record stays a record
     *      of purchases rather than of dust, and so that a buyer is never
     *      charged more in gas than the BONA they receive is quoted at.
     */
    uint256 public constant MIN_USDC = 1e6;

    /// @notice Total BONA sold by this contract.
    uint256 public bonaSold;

    /// @notice Total USDC received by this contract, all of it forwarded on.
    uint256 public usdcReceived;

    /// @notice BONA bought by each address, across all of their purchases.
    mapping(address => uint256) public boughtBy;

    event Bought(address indexed buyer, uint256 usdcAmount, uint256 bonaAmount);
    event UnsoldReclaimed(uint256 amount);

    error ZeroAddress();
    error BadPrice();
    error BadAllocation();
    error BelowMinimum();
    error SoldOut();
    error NotTreasury();
    error NothingToReclaim();

    /**
     * @param bona_        The BONA token.
     * @param usdc_        USDC on Base. Verify the address at circle.com.
     * @param treasury_    The project multisig. Never an EOA.
     * @param bonaPerUsdc_ BONA-wei per one whole USDC.
     * @param maxBona_     Lifetime ceiling for this contract, in BONA-wei.
     */
    constructor(
        IERC20 bona_,
        IERC20 usdc_,
        address treasury_,
        uint256 bonaPerUsdc_,
        uint256 maxBona_
    ) {
        if (address(bona_) == address(0)) revert ZeroAddress();
        if (address(usdc_) == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();
        if (bonaPerUsdc_ == 0) revert BadPrice();
        if (maxBona_ == 0) revert BadAllocation();

        bona = bona_;
        usdc = usdc_;
        treasury = treasury_;
        bonaPerUsdc = bonaPerUsdc_;
        maxBona = maxBona_;
    }

    // ---------------------------------------------------------------------
    // Buying
    // ---------------------------------------------------------------------

    /**
     * @notice Buy BONA with USDC at the published price.
     * @dev Approve this contract for `usdcAmount` on USDC first.
     *
     *      The order below is deliberate: the amount of BONA is fixed and
     *      both limits are checked before any token moves, and the USDC and
     *      the BONA move in the same call. If this contract cannot deliver —
     *      the ceiling reached, the instalment sold out — the whole
     *      transaction reverts and the buyer keeps their money.
     *
     * @param usdcAmount Payment in USDC units, six decimals. At least MIN_USDC.
     */
    function buy(uint256 usdcAmount) external nonReentrant {
        if (usdcAmount < MIN_USDC) revert BelowMinimum();

        uint256 bonaAmount = (usdcAmount * bonaPerUsdc) / 1e6;
        if (bonaSold + bonaAmount > maxBona) revert SoldOut();

        // Checked explicitly rather than left to the transfer, so that a
        // sold-out instalment fails with a reason a wallet can show rather
        // than a bare revert from inside the token.
        if (bona.balanceOf(address(this)) < bonaAmount) revert SoldOut();

        bonaSold += bonaAmount;
        usdcReceived += usdcAmount;
        boughtBy[msg.sender] += bonaAmount;

        // Straight to the multisig. This contract never holds a dollar, so
        // there is no balance here for anyone to argue about or to rescue.
        usdc.safeTransferFrom(msg.sender, treasury, usdcAmount);

        // Straight to the buyer. Not to a vesting contract, not to an escrow:
        // the wallet that paid is the wallet that holds the BONA when this
        // call returns.
        bona.safeTransfer(msg.sender, bonaAmount);

        emit Bought(msg.sender, usdcAmount, bonaAmount);
    }

    // ---------------------------------------------------------------------
    // Treasury
    // ---------------------------------------------------------------------

    /**
     * @notice Return BONA held here to the multisig.
     * @dev Safe to take everything: a purchase moves the buyer's BONA out
     *      inside the same transaction, so nothing held here is ever owed to
     *      anyone. Emptying this contract stops the sale, which is the
     *      intended way to stop it; transferring BONA back in reopens it.
     */
    function reclaimUnsold() external nonReentrant {
        if (msg.sender != treasury) revert NotTreasury();

        uint256 amount = bona.balanceOf(address(this));
        if (amount == 0) revert NothingToReclaim();

        bona.safeTransfer(treasury, amount);
        emit UnsoldReclaimed(amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice BONA that `usdcAmount` buys right now, before any transaction.
    function quote(uint256 usdcAmount) external view returns (uint256) {
        return (usdcAmount * bonaPerUsdc) / 1e6;
    }

    /// @notice BONA still sellable under this contract's own ceiling.
    function remainingBona() external view returns (uint256) {
        return maxBona - bonaSold;
    }

    /**
     * @notice BONA this contract can actually sell at this moment.
     * @dev The binding limit is whichever of two runs out first: the lifetime
     *      ceiling, or the tokens held here. A buyer wanting to know whether
     *      their purchase will go through should read this, not `maxBona`.
     */
    function availableBona() external view returns (uint256) {
        uint256 remaining = maxBona - bonaSold;
        uint256 held = bona.balanceOf(address(this));
        return remaining < held ? remaining : held;
    }
}
```

## Contract: Mocks.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Test-only six-decimal stablecoin. USDC's decimals matter to the
 *         price maths, so the suite must not test against an 18-decimal stand-in.
 */
contract MockUSDC is ERC20 {
    constructor(address holder, uint256 supply) ERC20("USD Coin", "USDC") {
        _mint(holder, supply);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
```

## Tests: DirectSale.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

const time = {
  async increase(seconds) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
    await ethers.provider.send("evm_mine", []);
  },
};

/**
 * These tests exist to prove the claims made about the sale.
 *
 * The claims are: one published price for everyone with no way to change it,
 * the buyer's money and the buyer's BONA move in the same transaction, the
 * BONA is in the buyer's wallet when that transaction confirms, the project
 * never holds a dollar that has not bought anything, what the contract can
 * sell is bounded two separate ways, and nothing here can reach a token that
 * belongs to a buyer.
 *
 * If a test here is removed, the corresponding claim must be removed from the
 * website and the documentation in the same commit.
 */
describe("DirectSale", function () {
  const BONA = (n) => ethers.parseUnits(String(n), 18);
  const USDC = (n) => ethers.parseUnits(String(n), 6);
  const DAY = 24 * 60 * 60;

  // The published price: 1 USDC = 100 BONA.
  const PRICE = BONA(100);
  const MAX_BONA = BONA(60_000_000);
  const TRANCHE = BONA(500_000);

  let bona, usdc, sale;
  let treasury, alice, bob, mallory;

  beforeEach(async function () {
    [treasury, alice, bob, mallory] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("BonaToken");
    bona = await Token.deploy(treasury.address);
    await bona.waitForDeployment();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy(treasury.address, USDC(1_000_000));
    await usdc.waitForDeployment();

    const Sale = await ethers.getContractFactory("DirectSale");
    sale = await Sale.deploy(
      await bona.getAddress(),
      await usdc.getAddress(),
      treasury.address,
      PRICE,
      MAX_BONA
    );
    await sale.waitForDeployment();

    // Buyers need dollars. The mock mints its whole supply to the deployer,
    // so hand some out from there.
    await usdc.transfer(alice.address, USDC(10_000));
    await usdc.transfer(bob.address, USDC(10_000));
    await usdc.connect(alice).approve(await sale.getAddress(), ethers.MaxUint256);
    await usdc.connect(bob).approve(await sale.getAddress(), ethers.MaxUint256);
  });

  /** Arm the sale the way the multisig will: one instalment of BONA. */
  async function arm(amount = TRANCHE) {
    await bona.transfer(await sale.getAddress(), amount);
  }

  describe("Terms are fixed at deployment", function () {
    it("publishes one price, and nothing can change it", async function () {
      expect(await sale.bonaPerUsdc()).to.equal(PRICE);
      expect(await sale.maxBona()).to.equal(MAX_BONA);

      const names = sale.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.name);
      for (const f of [
        "setPrice",
        "updatePrice",
        "setRate",
        "setMaxBona",
        "pause",
        "unpause",
        "owner",
        "transferOwnership",
        "setTreasury",
        "setVesting",
        "withdraw",
        "sweep",
        "rescue",
      ]) {
        expect(names, `${f}() must not exist`).to.not.include(f);
      }
    });

    it("quotes the published price before any transaction", async function () {
      expect(await sale.quote(USDC(1))).to.equal(BONA(100));
      expect(await sale.quote(USDC(10))).to.equal(BONA(1_000));
      expect(await sale.quote(USDC(2_500))).to.equal(BONA(250_000));
    });

    it("rejects a zero address, a zero price and a zero ceiling", async function () {
      const Sale = await ethers.getContractFactory("DirectSale");
      const args = [
        await bona.getAddress(),
        await usdc.getAddress(),
        treasury.address,
        PRICE,
        MAX_BONA,
      ];
      const swap = (i, v) => args.map((a, j) => (i === j ? v : a));

      for (const i of [0, 1, 2]) {
        await expect(Sale.deploy(...swap(i, ethers.ZeroAddress))).to.be.reverted;
      }
      await expect(Sale.deploy(...swap(3, 0))).to.be.revertedWithCustomError(sale, "BadPrice");
      await expect(Sale.deploy(...swap(4, 0))).to.be.revertedWithCustomError(
        sale,
        "BadAllocation"
      );
    });
  });

  describe("Buying", function () {
    beforeEach(arm);

    it("puts the published amount of BONA in the buyer's wallet", async function () {
      await sale.connect(alice).buy(USDC(10));

      expect(await bona.balanceOf(alice.address)).to.equal(BONA(1_000));
      expect(await sale.bonaSold()).to.equal(BONA(1_000));
      expect(await sale.boughtBy(alice.address)).to.equal(BONA(1_000));
    });

    it("charges the first buyer and the last buyer the same", async function () {
      await sale.connect(alice).buy(USDC(100));
      await sale.connect(bob).buy(USDC(100));
      await time.increase(90 * DAY);
      await sale.connect(alice).buy(USDC(100));

      expect(await bona.balanceOf(bob.address)).to.equal(BONA(10_000));
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(20_000));
      expect(await sale.boughtBy(alice.address)).to.equal(BONA(20_000));
    });

    /**
     * The property the whole contract is arranged around: the dollars land in
     * the multisig and the BONA lands in the wallet in one call, so the
     * project never holds money that has not yet bought anything.
     */
    it("sends the USDC straight to the multisig and keeps none", async function () {
      const before = await usdc.balanceOf(treasury.address);
      await sale.connect(alice).buy(USDC(250));

      expect(await usdc.balanceOf(treasury.address)).to.equal(before + USDC(250));
      expect(await usdc.balanceOf(await sale.getAddress())).to.equal(0);
      expect(await sale.usdcReceived()).to.equal(USDC(250));
    });

    it("moves the money and the BONA in the same transaction", async function () {
      const saleAddr = await sale.getAddress();
      await expect(sale.connect(alice).buy(USDC(10)))
        .to.emit(sale, "Bought")
        .withArgs(alice.address, USDC(10), BONA(1_000))
        .and.to.emit(usdc, "Transfer")
        .withArgs(alice.address, treasury.address, USDC(10))
        .and.to.emit(bona, "Transfer")
        .withArgs(saleAddr, alice.address, BONA(1_000));
    });

    it("leaves nothing of the buyer's in any contract", async function () {
      await sale.connect(alice).buy(USDC(10));

      // Every unit bought is in the wallet; the sale holds only what is
      // still for sale.
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(1_000));
      expect(await bona.balanceOf(await sale.getAddress())).to.equal(TRANCHE - BONA(1_000));
    });

    it("lets the buyer move their BONA the moment the purchase confirms", async function () {
      await sale.connect(alice).buy(USDC(10));

      // No lock, no vesting, no claim step: a plain transfer works at once.
      await bona.connect(alice).transfer(bob.address, BONA(400));
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(600));
      expect(await bona.balanceOf(bob.address)).to.equal(BONA(400));
    });

    it("handles fractional dollars at the same rate", async function () {
      await sale.connect(alice).buy(USDC("2.5"));
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(250));

      // The smallest unit of USDC buys exactly its share, with no rounding
      // in either direction that a buyer could notice.
      await sale.connect(bob).buy(USDC("1.000001"));
      expect(await bona.balanceOf(bob.address)).to.equal(BONA("100.0001"));
    });

    it("refuses a purchase below the minimum", async function () {
      await expect(sale.connect(alice).buy(USDC(1) - 1n)).to.be.revertedWithCustomError(
        sale,
        "BelowMinimum"
      );
      await expect(sale.connect(alice).buy(0)).to.be.revertedWithCustomError(
        sale,
        "BelowMinimum"
      );
      await sale.connect(alice).buy(USDC(1));
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(100));
    });
  });

  describe("Nothing is taken that is not delivered", function () {
    /**
     * The failure class this design removes. If the BONA cannot be delivered —
     * none in the contract, the instalment sold out, the ceiling reached —
     * the buyer's USDC must stay in the buyer's wallet.
     */
    it("takes no money when the sale holds no BONA", async function () {
      const buyer = await usdc.balanceOf(alice.address);
      const treasuryBefore = await usdc.balanceOf(treasury.address);

      await expect(sale.connect(alice).buy(USDC(10))).to.be.revertedWithCustomError(
        sale,
        "SoldOut"
      );

      expect(await usdc.balanceOf(alice.address)).to.equal(buyer);
      expect(await usdc.balanceOf(treasury.address)).to.equal(treasuryBefore);
      expect(await sale.bonaSold()).to.equal(0);
    });

    it("takes no money for a purchase larger than what it holds", async function () {
      await arm(BONA(1_000));
      const buyer = await usdc.balanceOf(alice.address);

      await expect(sale.connect(alice).buy(USDC(11))).to.be.revertedWithCustomError(
        sale,
        "SoldOut"
      );
      expect(await usdc.balanceOf(alice.address)).to.equal(buyer);
      expect(await bona.balanceOf(alice.address)).to.equal(0);
    });

    it("takes no money once the instalment runs out mid-sale", async function () {
      await arm(BONA(1_000));

      await sale.connect(alice).buy(USDC(10)); // exactly the instalment
      expect(await sale.availableBona()).to.equal(0);
      const before = await usdc.balanceOf(bob.address);

      await expect(sale.connect(bob).buy(USDC(1))).to.be.revertedWithCustomError(
        sale,
        "SoldOut"
      );
      expect(await usdc.balanceOf(bob.address)).to.equal(before);
    });

    it("delivers nothing when the buyer's dollars do not arrive", async function () {
      await arm();

      // No approval: USDC refuses the pull, and the whole call unwinds with
      // it — no BONA leaves the sale, nothing is recorded as sold.
      await usdc.connect(mallory).approve(await sale.getAddress(), 0);
      await usdc.transfer(mallory.address, USDC(10));
      await expect(sale.connect(mallory).buy(USDC(10))).to.be.reverted;

      // Approved but broke: the same.
      await usdc.connect(mallory).approve(await sale.getAddress(), ethers.MaxUint256);
      await expect(sale.connect(mallory).buy(USDC(11))).to.be.reverted;

      expect(await bona.balanceOf(mallory.address)).to.equal(0);
      expect(await bona.balanceOf(await sale.getAddress())).to.equal(TRANCHE);
      expect(await sale.bonaSold()).to.equal(0);
      expect(await sale.usdcReceived()).to.equal(0);
    });
  });

  describe("What the sale can sell is bounded two ways", function () {
    it("stops at its own lifetime ceiling", async function () {
      const Sale = await ethers.getContractFactory("DirectSale");
      const small = await Sale.deploy(
        await bona.getAddress(),
        await usdc.getAddress(),
        treasury.address,
        PRICE,
        BONA(1_000)
      );
      await small.waitForDeployment();
      await bona.transfer(await small.getAddress(), BONA(100_000));
      await usdc.connect(alice).approve(await small.getAddress(), ethers.MaxUint256);

      await small.connect(alice).buy(USDC(10)); // 1,000 BONA — the whole ceiling
      expect(await small.remainingBona()).to.equal(0);
      expect(await small.availableBona()).to.equal(0);

      const before = await usdc.balanceOf(alice.address);
      await expect(small.connect(alice).buy(USDC(1))).to.be.revertedWithCustomError(
        small,
        "SoldOut"
      );
      expect(await usdc.balanceOf(alice.address)).to.equal(before);
    });

    it("availableBona reports the tighter of the two limits", async function () {
      // Ceiling is huge; the instalment is what binds.
      await bona.transfer(await sale.getAddress(), BONA(5_000));
      expect(await sale.availableBona()).to.equal(BONA(5_000));

      // A small ceiling binds before a large instalment does.
      const Sale = await ethers.getContractFactory("DirectSale");
      const small = await Sale.deploy(
        await bona.getAddress(),
        await usdc.getAddress(),
        treasury.address,
        PRICE,
        BONA(2_000)
      );
      await small.waitForDeployment();
      await bona.transfer(await small.getAddress(), BONA(9_000));
      expect(await small.availableBona()).to.equal(BONA(2_000));
    });

    it("the ceiling is the published sale allocation and holds across purchases", async function () {
      expect(await sale.maxBona()).to.equal(BONA(60_000_000));
      await arm(BONA(1_000));
      await sale.connect(alice).buy(USDC(4));
      expect(await sale.remainingBona()).to.equal(MAX_BONA - BONA(400));
      expect(await sale.availableBona()).to.equal(BONA(600));
    });
  });

  describe("Reclaiming unsold tokens", function () {
    beforeEach(arm);

    it("only the multisig may reclaim", async function () {
      await expect(sale.connect(mallory).reclaimUnsold()).to.be.revertedWithCustomError(
        sale,
        "NotTreasury"
      );
      await expect(sale.connect(alice).reclaimUnsold()).to.be.revertedWithCustomError(
        sale,
        "NotTreasury"
      );
    });

    /**
     * Safe to take everything precisely because a purchase moves the buyer's
     * BONA out in the same transaction: nothing held here is ever owed.
     */
    it("returns the whole balance and cannot touch a buyer's tokens", async function () {
      await sale.connect(alice).buy(USDC(10));
      const bought = BONA(1_000);

      const before = await bona.balanceOf(treasury.address);
      await expect(sale.reclaimUnsold())
        .to.emit(sale, "UnsoldReclaimed")
        .withArgs(TRANCHE - bought);

      expect(await bona.balanceOf(await sale.getAddress())).to.equal(0);
      expect(await bona.balanceOf(treasury.address)).to.equal(before + TRANCHE - bought);

      // The buyer's tokens are in the buyer's wallet, untouched.
      expect(await bona.balanceOf(alice.address)).to.equal(bought);
    });

    it("emptying the contract is how the sale is stopped, and it charges nobody", async function () {
      await sale.reclaimUnsold();
      const before = await usdc.balanceOf(alice.address);
      await expect(sale.connect(alice).buy(USDC(10))).to.be.revertedWithCustomError(
        sale,
        "SoldOut"
      );
      expect(await usdc.balanceOf(alice.address)).to.equal(before);
    });

    it("topping the contract up again is how the sale is reopened", async function () {
      await sale.reclaimUnsold();
      await bona.transfer(await sale.getAddress(), BONA(200));

      await sale.connect(alice).buy(USDC(2));
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(200));
      expect(await sale.availableBona()).to.equal(0);
    });

    it("reverts when there is nothing to reclaim", async function () {
      await sale.reclaimUnsold();
      await expect(sale.reclaimUnsold()).to.be.revertedWithCustomError(
        sale,
        "NothingToReclaim"
      );
    });
  });
});
```
