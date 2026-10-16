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
