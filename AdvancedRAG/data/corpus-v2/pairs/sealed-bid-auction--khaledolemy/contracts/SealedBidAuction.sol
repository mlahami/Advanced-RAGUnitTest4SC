// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title SealedBidAuction
 * @author Your Name
 * @notice A first-price sealed-bid auction for a single item, implemented with a
 *         commit-reveal scheme so that bids stay secret on a fully public blockchain.
 *
 * @dev THE PROBLEM THIS SOLVES
 *      Everything stored on a public blockchain is readable by anyone. If bidders
 *      simply sent their bid amounts as plain numbers, every competitor could read
 *      them in real time and trivially outbid at the last second. That destroys the
 *      whole point of a *sealed* bid.
 *
 *      THE SOLUTION: COMMIT-REVEAL (two phases)
 *      1. COMMIT phase: a bidder submits only the keccak256 hash of
 *         (bidAmount, secret, theirAddress), together with an ETH deposit. The hash
 *         leaks nothing about the amount, so bids stay secret.
 *      2. REVEAL phase: bidding is closed. Each bidder re-submits the plain
 *         (bidAmount, secret). The contract recomputes the hash and checks it matches
 *         what they committed. This proves the bid was fixed *before* anyone could see
 *         it, so no one can change a bid after seeing a competitor's.
 *
 *      SECURITY PATTERNS USED (see README / DOCS_FOR_YOU for the reasoning):
 *      - Pull-over-push payments: the contract never pushes ETH to bidders. Everyone
 *        withdraws their own funds. This avoids re-entrancy and denial-of-service via
 *        a recipient that reverts on receipt.
 *      - Checks-Effects-Interactions (CEI): state is updated before any external call.
 *      - Custom errors instead of require-strings: cheaper gas and clearer reverts.
 *      - Immutable configuration and explicit phase modifiers.
 *
 *      DISCLAIMER: This is a portfolio / educational project. It has NOT been audited
 *      and must not be used to custody real funds in production.
 */
contract SealedBidAuction {
    /* --------------------------------------------------------------------- */
    /*                                TYPES                                   */
    /* --------------------------------------------------------------------- */

    /// @notice The three lifecycle phases of the auction.
    enum Phase {
        Bidding, // accepting sealed commitments
        Reveal, // accepting reveals, bidding closed
        Ended // reveal window has passed
    }

    /* --------------------------------------------------------------------- */
    /*                          IMMUTABLE / STORAGE                           */
    /* --------------------------------------------------------------------- */

    /// @notice Address that receives the winning bid amount and any forfeited deposits.
    address public immutable beneficiary;

    /// @notice Unix timestamp at which the commit phase ends and the reveal phase begins.
    uint256 public immutable biddingEnd;

    /// @notice Unix timestamp at which the reveal phase ends and the auction is over.
    uint256 public immutable revealEnd;

    /// @notice Human-readable description of the item being auctioned.
    string public itemDescription;

    /// @notice The current highest revealed & valid bidder. address(0) if none yet.
    address public highestBidder;

    /// @notice The current highest revealed & valid bid, in wei.
    uint256 public highestBid;

    /// @notice True once endAuction() has credited the proceeds to the beneficiary.
    bool public ended;

    /// @notice The blinded bid (commitment hash) submitted by each bidder.
    mapping(address => bytes32) public commitmentOf;

    /// @notice The ETH deposit locked by each bidder at commit time, in wei.
    mapping(address => uint256) public depositOf;

    /// @notice Whether a bidder has already revealed.
    mapping(address => bool) public revealedOf;

    /// @notice Funds that an account is allowed to withdraw (the "pull" ledger).
    mapping(address => uint256) public pendingReturns;

    /* --------------------------------------------------------------------- */
    /*                                EVENTS                                  */
    /* --------------------------------------------------------------------- */

    event BidCommitted(address indexed bidder, bytes32 commitment, uint256 deposit);
    event BidRevealed(address indexed bidder, uint256 value, bool valid, bool becameHighest);
    event HighestBidIncreased(address indexed bidder, uint256 amount);
    event AuctionEnded(address indexed winner, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event ForfeitedDepositCollected(address indexed bidder, uint256 amount);

    /* --------------------------------------------------------------------- */
    /*                             CUSTOM ERRORS                              */
    /* --------------------------------------------------------------------- */

    error TooEarly(uint256 currentTime, uint256 unlockTime);
    error TooLate(uint256 currentTime, uint256 deadline);
    error ZeroDeposit();
    error EmptyCommitment();
    error AlreadyCommitted();
    error NothingCommitted();
    error AlreadyRevealed();
    error InvalidReveal();
    error AuctionAlreadyEnded();
    error NotBeneficiary();
    error BidderDidReveal();
    error NothingToWithdraw();
    error TransferFailed();
    error InvalidConstructorArgs();

    /* --------------------------------------------------------------------- */
    /*                               MODIFIERS                                */
    /* --------------------------------------------------------------------- */

    /// @dev Reverts unless the current block timestamp is strictly before `deadline`.
    modifier onlyBefore(uint256 deadline) {
        if (block.timestamp >= deadline) revert TooLate(block.timestamp, deadline);
        _;
    }

    /// @dev Reverts unless the current block timestamp is at or after `unlockTime`.
    modifier onlyAfter(uint256 unlockTime) {
        if (block.timestamp < unlockTime) revert TooEarly(block.timestamp, unlockTime);
        _;
    }

    /* --------------------------------------------------------------------- */
    /*                              CONSTRUCTOR                               */
    /* --------------------------------------------------------------------- */

    /**
     * @param biddingSeconds  Duration of the commit phase, in seconds (must be > 0).
     * @param revealSeconds   Duration of the reveal phase, in seconds (must be > 0).
     * @param beneficiaryAddr Recipient of the winning bid and forfeited deposits.
     * @param description     Human-readable description of the auctioned item.
     */
    constructor(
        uint256 biddingSeconds,
        uint256 revealSeconds,
        address beneficiaryAddr,
        string memory description
    ) {
        if (beneficiaryAddr == address(0) || biddingSeconds == 0 || revealSeconds == 0) {
            revert InvalidConstructorArgs();
        }
        beneficiary = beneficiaryAddr;
        biddingEnd = block.timestamp + biddingSeconds;
        revealEnd = biddingEnd + revealSeconds;
        itemDescription = description;
    }

    /* --------------------------------------------------------------------- */
    /*                           PHASE 1: COMMIT                              */
    /* --------------------------------------------------------------------- */

    /**
     * @notice Commit to a sealed bid by submitting its hash plus an ETH deposit.
     * @dev The deposit acts as the maximum you can be asked to pay. On reveal, a bid
     *      is only counted if `revealedValue <= deposit`. Over-deposit is fully
     *      refundable. One commitment per address; commit again from a fresh address
     *      if you need multiple bids.
     *
     *      Compute `blindedBid` off-chain (or via {computeCommitment}) as:
     *          keccak256(abi.encodePacked(value, secret, yourAddress))
     *      where `value` is the bid in wei and `secret` is a random 32-byte value you
     *      keep private until the reveal phase.
     *
     * @param blindedBid The commitment hash. Must be non-zero.
     */
    function commitBid(bytes32 blindedBid) external payable onlyBefore(biddingEnd) {
        if (msg.value == 0) revert ZeroDeposit();
        if (blindedBid == bytes32(0)) revert EmptyCommitment();
        if (commitmentOf[msg.sender] != bytes32(0)) revert AlreadyCommitted();

        commitmentOf[msg.sender] = blindedBid;
        depositOf[msg.sender] = msg.value;

        emit BidCommitted(msg.sender, blindedBid, msg.value);
    }

    /* --------------------------------------------------------------------- */
    /*                           PHASE 2: REVEAL                              */
    /* --------------------------------------------------------------------- */

    /**
     * @notice Reveal a previously committed bid.
     * @dev Recomputes the commitment and requires an exact match. A revealed bid is
     *      "valid" only if it is fully collateralised (`value <= deposit`).
     *
     *      Outcome of a successful reveal:
     *      - Valid AND strictly greater than the current highest bid: this bidder
     *        becomes the new highest bidder; the previous highest bidder's locked
     *        amount is returned to their pull-ledger; this bidder's excess deposit
     *        (deposit - value) is returned to their pull-ledger.
     *      - Otherwise (valid-but-not-highest, a tie, or under-collateralised): the
     *        entire deposit is returned to this bidder's pull-ledger. Only the final
     *        winner ever pays; all other revealed bidders are fully refunded.
     *
     * @param value  The bid amount in wei that was committed to.
     * @param secret The 32-byte secret that was committed to.
     */
    function revealBid(uint256 value, bytes32 secret)
        external
        onlyAfter(biddingEnd)
        onlyBefore(revealEnd)
    {
        bytes32 commitment = commitmentOf[msg.sender];
        if (commitment == bytes32(0)) revert NothingCommitted();
        if (revealedOf[msg.sender]) revert AlreadyRevealed();
        if (keccak256(abi.encodePacked(value, secret, msg.sender)) != commitment) {
            revert InvalidReveal();
        }

        revealedOf[msg.sender] = true;

        uint256 deposit = depositOf[msg.sender];
        bool valid = value <= deposit;
        bool becameHighest = false;

        if (valid && value > highestBid) {
            // Dethrone the previous leader: return their locked bid so they can withdraw.
            if (highestBidder != address(0)) {
                pendingReturns[highestBidder] += highestBid;
            }
            highestBid = value;
            highestBidder = msg.sender;
            becameHighest = true;

            // Lock exactly `value`; hand back any over-deposit immediately.
            pendingReturns[msg.sender] += deposit - value;
            emit HighestBidIncreased(msg.sender, value);
        } else {
            // Losing, tying, or invalid bid: the full deposit is refundable.
            pendingReturns[msg.sender] += deposit;
        }

        emit BidRevealed(msg.sender, value, valid, becameHighest);
    }

    /* --------------------------------------------------------------------- */
    /*                          FINALISATION / PAYOUT                         */
    /* --------------------------------------------------------------------- */

    /**
     * @notice Finalise the auction after the reveal phase and credit the winning bid
     *         to the beneficiary's pull-ledger. Permissionless: anyone may call it,
     *         proceeds always go to the fixed `beneficiary`.
     * @dev Uses the pull pattern for the beneficiary too, so a beneficiary contract
     *      that reverts on plain ETH receipt cannot brick finalisation.
     */
    function endAuction() external onlyAfter(revealEnd) {
        if (ended) revert AuctionAlreadyEnded();
        ended = true;

        if (highestBid > 0) {
            pendingReturns[beneficiary] += highestBid;
        }
        emit AuctionEnded(highestBidder, highestBid);
    }

    /**
     * @notice Withdraw everything owed to the caller (refunds, over-deposit, or, for
     *         the beneficiary, the auction proceeds).
     * @dev Checks-Effects-Interactions + restore-on-failure makes this re-entrancy
     *      safe without a separate guard: the balance is zeroed before the external
     *      call, so a re-entrant call finds nothing to withdraw.
     */
    function withdraw() external {
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingReturns[msg.sender] = 0; // effect before interaction

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) {
            pendingReturns[msg.sender] = amount; // restore so funds are never lost
            revert TransferFailed();
        }

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice After the auction ends, the beneficiary may claim the deposit of a
     *         bidder who committed but never revealed. This makes empty/griefing
     *         commitments costly and discourages spam.
     * @dev Restricted to the beneficiary to demonstrate an explicit access-control
     *      check (it could also be permissionless, since funds always route to the
     *      beneficiary). Solidity cannot iterate a mapping, so non-revealers are
     *      collected one address at a time, identified off-chain from emitted events.
     * @param bidder The address whose forfeited deposit is being collected.
     */
    function collectForfeitedDeposit(address bidder) external onlyAfter(revealEnd) {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (commitmentOf[bidder] == bytes32(0)) revert NothingCommitted();
        if (revealedOf[bidder]) revert BidderDidReveal();

        uint256 amount = depositOf[bidder];
        if (amount == 0) revert NothingToWithdraw();

        depositOf[bidder] = 0; // effect
        commitmentOf[bidder] = bytes32(0); // prevents double-collection
        pendingReturns[beneficiary] += amount; // routed through the pull ledger

        emit ForfeitedDepositCollected(bidder, amount);
    }

    /* --------------------------------------------------------------------- */
    /*                                 VIEWS                                  */
    /* --------------------------------------------------------------------- */

    /// @notice The current phase, derived from block.timestamp.
    function phase() public view returns (Phase) {
        if (block.timestamp < biddingEnd) return Phase.Bidding;
        if (block.timestamp < revealEnd) return Phase.Reveal;
        return Phase.Ended;
    }

    /**
     * @notice Helper to compute a commitment exactly the way the contract verifies it.
     * @dev `pure`, so it is free to call off-chain via eth_call. Use it to build a
     *      commitment before bidding, or in tests.
     */
    function computeCommitment(uint256 value, bytes32 secret, address bidder)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(value, secret, bidder));
    }

    /// @notice Convenience getter for the winner once the auction has ended.
    function winner() external view returns (address bidderAddress, uint256 amount) {
        return (highestBidder, highestBid);
    }
}
