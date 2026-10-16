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
