# sealed-bid-auction--khaledolemy

- domain: auctions (auction)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/KhaledOlemy/sealed-bid-auction @ 57f8bf6bff583282cfefc7db43ebd0d125fdce18
- license: MIT
- targets: SealedBidAuction.sol, ReentrancyAttacker.sol
- validation: 32 passing tests, 0 failing; statement coverage SealedBidAuction.sol 89.74 %, ReentrancyAttacker.sol 100.0 %

## Contract: ReentrancyAttacker.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SealedBidAuction} from "./SealedBidAuction.sol";

/**
 * @title ReentrancyAttacker
 * @notice Test-only contract. It loses the auction on purpose (so it is owed a refund)
 *         and then tries to re-enter `withdraw()` from its `receive()` function to
 *         drain more than it is owed. The auction's Checks-Effects-Interactions logic
 *         must make that attack fail.
 * @dev Never deploy this to a real network. It exists solely to prove a security
 *      property in the test suite.
 */
contract ReentrancyAttacker {
    SealedBidAuction public immutable auction;
    uint256 public reentryCount;

    constructor(SealedBidAuction _auction) {
        auction = _auction;
    }

    /// @dev Forward a sealed commitment from this contract's address.
    function commit(bytes32 blindedBid) external payable {
        auction.commitBid{value: msg.value}(blindedBid);
    }

    /// @dev Reveal this contract's bid.
    function reveal(uint256 value, bytes32 secret) external {
        auction.revealBid(value, secret);
    }

    /// @dev Kick off a withdrawal; the re-entrancy happens inside receive().
    function attackWithdraw() external {
        auction.withdraw();
    }

    /// @dev On receiving ETH, try to re-enter withdraw() to double-spend.
    receive() external payable {
        reentryCount += 1;
        // Attempt the re-entrant call. It is expected to revert inside the auction,
        // which will bubble up and cause the outer withdraw's low-level call to fail.
        if (reentryCount < 5) {
            auction.withdraw();
        }
    }
}
```

## Contract: SealedBidAuction.sol (primary target)

```solidity
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
```

## Tests: SealedBidAuction.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Full test suite for SealedBidAuction.
 *
 * The tests are grouped by concern:
 *   1. Deployment / configuration
 *   2. Commit phase rules
 *   3. Reveal phase rules
 *   4. Winner selection and payouts (the money math)
 *   5. Forfeited deposits (non-revealers)
 *   6. Security: re-entrancy protection
 *   7. End-to-end integration
 *
 * Helper: `commitmentFor` reproduces, in JavaScript, exactly the hash the contract
 * checks on reveal: keccak256(abi.encodePacked(value, secret, bidder)).
 */

const ONE = ethers.parseEther("1");
const BIDDING_SECONDS = 1000;
const REVEAL_SECONDS = 1000;

function commitmentFor(value, secret, bidderAddress) {
  return ethers.solidityPackedKeccak256(
    ["uint256", "bytes32", "address"],
    [value, secret, bidderAddress]
  );
}

// Deterministic 32-byte secrets derived from a label.
function secret(label) {
  return ethers.id(label); // keccak256 of the string -> 32-byte hex
}

async function deployAuction(beneficiary) {
  const Factory = await ethers.getContractFactory("SealedBidAuction");
  const auction = await Factory.deploy(
    BIDDING_SECONDS,
    REVEAL_SECONDS,
    beneficiary.address,
    "Rare collectible #1"
  );
  await auction.waitForDeployment();
  return auction;
}

async function moveToRevealPhase(auction) {
  await time.increaseTo(Number(await auction.biddingEnd()));
}

async function moveToEndedPhase(auction) {
  await time.increaseTo(Number(await auction.revealEnd()));
}

describe("SealedBidAuction", function () {
  let owner, beneficiary, alice, bob, carol, dave;

  beforeEach(async function () {
    [owner, beneficiary, alice, bob, carol, dave] = await ethers.getSigners();
  });

  /* ------------------------------------------------------------------ */
  describe("Deployment", function () {
    it("stores constructor parameters and starts in the Bidding phase", async function () {
      const auction = await deployAuction(beneficiary);

      expect(await auction.beneficiary()).to.equal(beneficiary.address);
      expect(await auction.itemDescription()).to.equal("Rare collectible #1");
      expect(await auction.highestBidder()).to.equal(ethers.ZeroAddress);
      expect(await auction.highestBid()).to.equal(0n);
      expect(await auction.ended()).to.equal(false);
      expect(await auction.phase()).to.equal(0n); // Phase.Bidding

      const biddingEnd = await auction.biddingEnd();
      const revealEnd = await auction.revealEnd();
      expect(revealEnd - biddingEnd).to.equal(BigInt(REVEAL_SECONDS));
    });

    it("reverts on invalid constructor arguments", async function () {
      const Factory = await ethers.getContractFactory("SealedBidAuction");
      await expect(
        Factory.deploy(0, REVEAL_SECONDS, beneficiary.address, "x")
      ).to.be.revertedWithCustomError(Factory, "InvalidConstructorArgs");
      await expect(
        Factory.deploy(BIDDING_SECONDS, 0, beneficiary.address, "x")
      ).to.be.revertedWithCustomError(Factory, "InvalidConstructorArgs");
      await expect(
        Factory.deploy(BIDDING_SECONDS, REVEAL_SECONDS, ethers.ZeroAddress, "x")
      ).to.be.revertedWithCustomError(Factory, "InvalidConstructorArgs");
    });

    it("computeCommitment matches the JavaScript reproduction", async function () {
      const auction = await deployAuction(beneficiary);
      const value = ethers.parseEther("1.5");
      const s = secret("alice-1");
      const onChain = await auction.computeCommitment(value, s, alice.address);
      expect(onChain).to.equal(commitmentFor(value, s, alice.address));
    });
  });

  /* ------------------------------------------------------------------ */
  describe("Commit phase", function () {
    it("accepts a commitment with a deposit and emits BidCommitted", async function () {
      const auction = await deployAuction(beneficiary);
      const c = commitmentFor(ONE, secret("a"), alice.address);

      await expect(auction.connect(alice).commitBid(c, { value: ONE }))
        .to.emit(auction, "BidCommitted")
        .withArgs(alice.address, c, ONE);

      expect(await auction.commitmentOf(alice.address)).to.equal(c);
      expect(await auction.depositOf(alice.address)).to.equal(ONE);
    });

    it("rejects a zero-value deposit", async function () {
      const auction = await deployAuction(beneficiary);
      const c = commitmentFor(ONE, secret("a"), alice.address);
      await expect(
        auction.connect(alice).commitBid(c, { value: 0 })
      ).to.be.revertedWithCustomError(auction, "ZeroDeposit");
    });

    it("rejects an empty commitment hash", async function () {
      const auction = await deployAuction(beneficiary);
      await expect(
        auction.connect(alice).commitBid(ethers.ZeroHash, { value: ONE })
      ).to.be.revertedWithCustomError(auction, "EmptyCommitment");
    });

    it("rejects a second commitment from the same address", async function () {
      const auction = await deployAuction(beneficiary);
      const c = commitmentFor(ONE, secret("a"), alice.address);
      await auction.connect(alice).commitBid(c, { value: ONE });
      await expect(
        auction.connect(alice).commitBid(c, { value: ONE })
      ).to.be.revertedWithCustomError(auction, "AlreadyCommitted");
    });

    it("rejects commitments once the bidding deadline has passed", async function () {
      const auction = await deployAuction(beneficiary);
      await moveToRevealPhase(auction);
      const c = commitmentFor(ONE, secret("a"), alice.address);
      await expect(
        auction.connect(alice).commitBid(c, { value: ONE })
      ).to.be.revertedWithCustomError(auction, "TooLate");
    });
  });

  /* ------------------------------------------------------------------ */
  describe("Reveal phase", function () {
    it("rejects reveals during the bidding phase (too early)", async function () {
      const auction = await deployAuction(beneficiary);
      const s = secret("a");
      await auction
        .connect(alice)
        .commitBid(commitmentFor(ONE, s, alice.address), { value: ONE });
      await expect(
        auction.connect(alice).revealBid(ONE, s)
      ).to.be.revertedWithCustomError(auction, "TooEarly");
    });

    it("accepts a correct reveal and sets the highest bid", async function () {
      const auction = await deployAuction(beneficiary);
      const s = secret("a");
      await auction
        .connect(alice)
        .commitBid(commitmentFor(ONE, s, alice.address), { value: ONE });

      await moveToRevealPhase(auction);

      await expect(auction.connect(alice).revealBid(ONE, s))
        .to.emit(auction, "HighestBidIncreased")
        .withArgs(alice.address, ONE);

      expect(await auction.highestBidder()).to.equal(alice.address);
      expect(await auction.highestBid()).to.equal(ONE);
      expect(await auction.revealedOf(alice.address)).to.equal(true);
    });

    it("rejects a reveal with the wrong secret", async function () {
      const auction = await deployAuction(beneficiary);
      await auction
        .connect(alice)
        .commitBid(commitmentFor(ONE, secret("right"), alice.address), { value: ONE });
      await moveToRevealPhase(auction);
      await expect(
        auction.connect(alice).revealBid(ONE, secret("wrong"))
      ).to.be.revertedWithCustomError(auction, "InvalidReveal");
    });

    it("rejects a reveal with the wrong value", async function () {
      const auction = await deployAuction(beneficiary);
      const s = secret("a");
      await auction
        .connect(alice)
        .commitBid(commitmentFor(ONE, s, alice.address), { value: ONE });
      await moveToRevealPhase(auction);
      await expect(
        auction.connect(alice).revealBid(ethers.parseEther("2"), s)
      ).to.be.revertedWithCustomError(auction, "InvalidReveal");
    });

    it("rejects revealing twice", async function () {
      const auction = await deployAuction(beneficiary);
      const s = secret("a");
      await auction
        .connect(alice)
        .commitBid(commitmentFor(ONE, s, alice.address), { value: ONE });
      await moveToRevealPhase(auction);
      await auction.connect(alice).revealBid(ONE, s);
      await expect(
        auction.connect(alice).revealBid(ONE, s)
      ).to.be.revertedWithCustomError(auction, "AlreadyRevealed");
    });

    it("rejects a reveal from an address that never committed", async function () {
      const auction = await deployAuction(beneficiary);
      await moveToRevealPhase(auction);
      await expect(
        auction.connect(alice).revealBid(ONE, secret("a"))
      ).to.be.revertedWithCustomError(auction, "NothingCommitted");
    });

    it("rejects reveals after the reveal deadline (too late)", async function () {
      const auction = await deployAuction(beneficiary);
      const s = secret("a");
      await auction
        .connect(alice)
        .commitBid(commitmentFor(ONE, s, alice.address), { value: ONE });
      await moveToEndedPhase(auction);
      await expect(
        auction.connect(alice).revealBid(ONE, s)
      ).to.be.revertedWithCustomError(auction, "TooLate");
    });

    it("treats an under-collateralised bid as invalid but refundable", async function () {
      // Bidder deposits 1 ETH but reveals a 2 ETH bid -> not fully collateralised.
      const auction = await deployAuction(beneficiary);
      const bid = ethers.parseEther("2");
      const s = secret("a");
      await auction
        .connect(alice)
        .commitBid(commitmentFor(bid, s, alice.address), { value: ONE }); // only 1 ETH

      await moveToRevealPhase(auction);

      await expect(auction.connect(alice).revealBid(bid, s))
        .to.emit(auction, "BidRevealed")
        .withArgs(alice.address, bid, false, false); // valid=false, becameHighest=false

      expect(await auction.highestBidder()).to.equal(ethers.ZeroAddress);
      expect(await auction.pendingReturns(alice.address)).to.equal(ONE); // full deposit back
    });
  });

  /* ------------------------------------------------------------------ */
  describe("Winner selection and payouts", function () {
    it("selects the highest valid bidder and refunds everyone else in full", async function () {
      const auction = await deployAuction(beneficiary);

      const aBid = ethers.parseEther("1.5");
      const aDep = ethers.parseEther("2");
      const bBid = ethers.parseEther("1");
      const bDep = ethers.parseEther("1");
      const cBid = ethers.parseEther("2");
      const cDep = ethers.parseEther("3");

      await auction
        .connect(alice)
        .commitBid(commitmentFor(aBid, secret("a"), alice.address), { value: aDep });
      await auction
        .connect(bob)
        .commitBid(commitmentFor(bBid, secret("b"), bob.address), { value: bDep });
      await auction
        .connect(carol)
        .commitBid(commitmentFor(cBid, secret("c"), carol.address), { value: cDep });

      await moveToRevealPhase(auction);

      await auction.connect(alice).revealBid(aBid, secret("a"));
      await auction.connect(bob).revealBid(bBid, secret("b"));
      await auction.connect(carol).revealBid(cBid, secret("c"));

      // Carol wins at 2 ETH.
      expect(await auction.highestBidder()).to.equal(carol.address);
      expect(await auction.highestBid()).to.equal(cBid);

      // Pull-ledger balances:
      // Alice: dethroned -> full 2 ETH deposit back.
      // Bob:   never highest -> full 1 ETH deposit back.
      // Carol: winner -> only her 1 ETH over-deposit back (pays 2 of her 3).
      expect(await auction.pendingReturns(alice.address)).to.equal(aDep);
      expect(await auction.pendingReturns(bob.address)).to.equal(bDep);
      expect(await auction.pendingReturns(carol.address)).to.equal(cDep - cBid);
    });

    it("breaks ties in favour of the earlier revealer (strict greater-than)", async function () {
      const auction = await deployAuction(beneficiary);
      const bid = ethers.parseEther("1");

      await auction
        .connect(alice)
        .commitBid(commitmentFor(bid, secret("a"), alice.address), { value: bid });
      await auction
        .connect(bob)
        .commitBid(commitmentFor(bid, secret("b"), bob.address), { value: bid });

      await moveToRevealPhase(auction);

      await auction.connect(alice).revealBid(bid, secret("a")); // first to reveal
      await auction.connect(bob).revealBid(bid, secret("b")); // equal bid, later

      expect(await auction.highestBidder()).to.equal(alice.address);
      // Bob is refunded in full; his equal bid did not displace Alice.
      expect(await auction.pendingReturns(bob.address)).to.equal(bid);
    });

    it("lets losers withdraw and moves the exact ETH out of the contract", async function () {
      const auction = await deployAuction(beneficiary);
      const aBid = ethers.parseEther("1");
      const cBid = ethers.parseEther("2");

      await auction
        .connect(alice)
        .commitBid(commitmentFor(aBid, secret("a"), alice.address), { value: aBid });
      await auction
        .connect(carol)
        .commitBid(commitmentFor(cBid, secret("c"), carol.address), { value: cBid });

      await moveToRevealPhase(auction);
      await auction.connect(alice).revealBid(aBid, secret("a"));
      await auction.connect(carol).revealBid(cBid, secret("c"));

      const before = await ethers.provider.getBalance(await auction.getAddress());
      await auction.connect(alice).withdraw();
      const after = await ethers.provider.getBalance(await auction.getAddress());

      expect(before - after).to.equal(aBid); // exactly the refund left the contract
      expect(await auction.pendingReturns(alice.address)).to.equal(0n);
    });

    it("reverts withdraw when there is nothing owed", async function () {
      const auction = await deployAuction(beneficiary);
      await expect(
        auction.connect(dave).withdraw()
      ).to.be.revertedWithCustomError(auction, "NothingToWithdraw");
    });

    it("reverts a double withdrawal", async function () {
      const auction = await deployAuction(beneficiary);
      const bid = ethers.parseEther("1");
      await auction
        .connect(alice)
        .commitBid(commitmentFor(bid, secret("a"), alice.address), { value: bid });
      const cBid = ethers.parseEther("2");
      await auction
        .connect(carol)
        .commitBid(commitmentFor(cBid, secret("c"), carol.address), { value: cBid });

      await moveToRevealPhase(auction);
      await auction.connect(alice).revealBid(bid, secret("a"));
      await auction.connect(carol).revealBid(cBid, secret("c"));

      await auction.connect(alice).withdraw();
      await expect(
        auction.connect(alice).withdraw()
      ).to.be.revertedWithCustomError(auction, "NothingToWithdraw");
    });

    it("credits the winning bid to the beneficiary on endAuction", async function () {
      const auction = await deployAuction(beneficiary);
      const cBid = ethers.parseEther("2");
      await auction
        .connect(carol)
        .commitBid(commitmentFor(cBid, secret("c"), carol.address), { value: cBid });

      await moveToRevealPhase(auction);
      await auction.connect(carol).revealBid(cBid, secret("c"));
      await moveToEndedPhase(auction);

      await expect(auction.endAuction())
        .to.emit(auction, "AuctionEnded")
        .withArgs(carol.address, cBid);

      expect(await auction.ended()).to.equal(true);
      expect(await auction.pendingReturns(beneficiary.address)).to.equal(cBid);

      // Beneficiary pulls the proceeds out of the contract.
      const before = await ethers.provider.getBalance(await auction.getAddress());
      await auction.connect(beneficiary).withdraw();
      const after = await ethers.provider.getBalance(await auction.getAddress());
      expect(before - after).to.equal(cBid);
    });

    it("reverts endAuction before the reveal phase ends", async function () {
      const auction = await deployAuction(beneficiary);
      await expect(
        auction.endAuction()
      ).to.be.revertedWithCustomError(auction, "TooEarly");
    });

    it("reverts a second endAuction call", async function () {
      const auction = await deployAuction(beneficiary);
      await moveToEndedPhase(auction);
      await auction.endAuction();
      await expect(
        auction.endAuction()
      ).to.be.revertedWithCustomError(auction, "AuctionAlreadyEnded");
    });

    it("handles an auction with no bids gracefully", async function () {
      const auction = await deployAuction(beneficiary);
      await moveToEndedPhase(auction);
      await expect(auction.endAuction())
        .to.emit(auction, "AuctionEnded")
        .withArgs(ethers.ZeroAddress, 0n);
      expect(await auction.pendingReturns(beneficiary.address)).to.equal(0n);
    });
  });

  /* ------------------------------------------------------------------ */
  describe("Forfeited deposits (non-revealers)", function () {
    it("lets the beneficiary collect a committed-but-never-revealed deposit", async function () {
      const auction = await deployAuction(beneficiary);
      await auction
        .connect(dave)
        .commitBid(commitmentFor(ONE, secret("d"), dave.address), { value: ONE });

      await moveToEndedPhase(auction);

      await expect(auction.connect(beneficiary).collectForfeitedDeposit(dave.address))
        .to.emit(auction, "ForfeitedDepositCollected")
        .withArgs(dave.address, ONE);

      expect(await auction.pendingReturns(beneficiary.address)).to.equal(ONE);
      expect(await auction.depositOf(dave.address)).to.equal(0n);
    });

    it("blocks non-beneficiaries from collecting forfeited deposits", async function () {
      const auction = await deployAuction(beneficiary);
      await auction
        .connect(dave)
        .commitBid(commitmentFor(ONE, secret("d"), dave.address), { value: ONE });
      await moveToEndedPhase(auction);
      await expect(
        auction.connect(alice).collectForfeitedDeposit(dave.address)
      ).to.be.revertedWithCustomError(auction, "NotBeneficiary");
    });

    it("cannot collect from a bidder who did reveal", async function () {
      const auction = await deployAuction(beneficiary);
      await auction
        .connect(alice)
        .commitBid(commitmentFor(ONE, secret("a"), alice.address), { value: ONE });
      await moveToRevealPhase(auction);
      await auction.connect(alice).revealBid(ONE, secret("a"));
      await moveToEndedPhase(auction);
      await expect(
        auction.connect(beneficiary).collectForfeitedDeposit(alice.address)
      ).to.be.revertedWithCustomError(auction, "BidderDidReveal");
    });

    it("cannot double-collect a forfeited deposit", async function () {
      const auction = await deployAuction(beneficiary);
      await auction
        .connect(dave)
        .commitBid(commitmentFor(ONE, secret("d"), dave.address), { value: ONE });
      await moveToEndedPhase(auction);
      await auction.connect(beneficiary).collectForfeitedDeposit(dave.address);
      await expect(
        auction.connect(beneficiary).collectForfeitedDeposit(dave.address)
      ).to.be.revertedWithCustomError(auction, "NothingCommitted");
    });

    it("cannot collect before the auction has ended", async function () {
      const auction = await deployAuction(beneficiary);
      await auction
        .connect(dave)
        .commitBid(commitmentFor(ONE, secret("d"), dave.address), { value: ONE });
      await expect(
        auction.connect(beneficiary).collectForfeitedDeposit(dave.address)
      ).to.be.revertedWithCustomError(auction, "TooEarly");
    });
  });

  /* ------------------------------------------------------------------ */
  describe("Security: re-entrancy", function () {
    it("prevents a re-entrant withdraw from draining extra funds", async function () {
      const auction = await deployAuction(beneficiary);

      const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await Attacker.deploy(await auction.getAddress());
      await attacker.waitForDeployment();
      const attackerAddr = await attacker.getAddress();

      // Attacker commits a LOSING bid so it is owed exactly its deposit back.
      const attackerBid = ethers.parseEther("1");
      await attacker.commit(commitmentFor(attackerBid, secret("atk"), attackerAddr), {
        value: attackerBid,
      });

      // Carol commits and will win.
      const carolBid = ethers.parseEther("2");
      await auction
        .connect(carol)
        .commitBid(commitmentFor(carolBid, secret("c"), carol.address), { value: carolBid });

      await moveToRevealPhase(auction);
      await attacker.reveal(attackerBid, secret("atk"));
      await auction.connect(carol).revealBid(carolBid, secret("c"));

      // The attacker is owed exactly 1 ETH.
      expect(await auction.pendingReturns(attackerAddr)).to.equal(attackerBid);

      const contractBefore = await ethers.provider.getBalance(await auction.getAddress());

      // The re-entrant withdrawal must fail; no funds should move.
      await expect(attacker.attackWithdraw()).to.be.revertedWithCustomError(
        auction,
        "TransferFailed"
      );

      const contractAfter = await ethers.provider.getBalance(await auction.getAddress());
      expect(contractAfter).to.equal(contractBefore); // nothing drained
      // Balance is preserved (transaction rolled back), so it is still owed.
      expect(await auction.pendingReturns(attackerAddr)).to.equal(attackerBid);
    });
  });

  /* ------------------------------------------------------------------ */
  describe("End-to-end integration", function () {
    it("runs a full auction and conserves all ETH", async function () {
      const auction = await deployAuction(beneficiary);
      const auctionAddr = await auction.getAddress();

      const bids = [
        { signer: alice, bid: ethers.parseEther("1.5"), dep: ethers.parseEther("2"), s: secret("a") },
        { signer: bob, bid: ethers.parseEther("1"), dep: ethers.parseEther("1"), s: secret("b") },
        { signer: carol, bid: ethers.parseEther("2"), dep: ethers.parseEther("3"), s: secret("c") },
      ];

      let totalDeposited = 0n;
      for (const b of bids) {
        await auction
          .connect(b.signer)
          .commitBid(commitmentFor(b.bid, b.s, b.signer.address), { value: b.dep });
        totalDeposited += b.dep;
      }

      // Dave commits 1 ETH and never reveals -> forfeit.
      const daveDep = ethers.parseEther("1");
      await auction
        .connect(dave)
        .commitBid(commitmentFor(ONE, secret("d"), dave.address), { value: daveDep });
      totalDeposited += daveDep;

      expect(await ethers.provider.getBalance(auctionAddr)).to.equal(totalDeposited);

      await moveToRevealPhase(auction);
      for (const b of bids) {
        await auction.connect(b.signer).revealBid(b.bid, b.s);
      }

      await moveToEndedPhase(auction);
      await auction.endAuction();
      await auction.connect(beneficiary).collectForfeitedDeposit(dave.address);

      // Everyone withdraws everything they are owed.
      for (const b of bids) {
        if ((await auction.pendingReturns(b.signer.address)) > 0n) {
          await auction.connect(b.signer).withdraw();
        }
      }
      await auction.connect(beneficiary).withdraw();

      // Carol won at 2 ETH; beneficiary receives 2 (winning bid) + 1 (forfeit) = 3.
      expect(await auction.highestBidder()).to.equal(carol.address);
      expect(await auction.highestBid()).to.equal(ethers.parseEther("2"));

      // The contract should now be empty: every wei has been accounted for.
      expect(await ethers.provider.getBalance(auctionAddr)).to.equal(0n);
    });
  });
});
```
