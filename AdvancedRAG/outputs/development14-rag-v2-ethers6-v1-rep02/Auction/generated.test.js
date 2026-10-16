const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Auction", function () {
  let auction;
  let seller;
  let bidder1;
  let bidder2;
  const duration = 3600n; // 1 hour in seconds

  beforeEach(async function () {
    [seller, bidder1, bidder2] = await ethers.getSigners();

    const Auction = await ethers.getContractFactory("Auction");
    auction = await Auction.connect(seller).deploy(duration);
    await auction.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right seller and end time", async function () {
      expect(await auction.seller()).to.equal(seller.address);
      expect(await auction.endTime()).to.equal((await ethers.provider.getBlock("latest")).timestamp + Number(duration));
    });

    it("Should initialize with zero highest bid and no highest bidder", async function () {
      expect(await auction.highestBid()).to.equal(0n);
      expect(await auction.highestBidder()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Bidding", function () {
    it("Should accept valid bids", async function () {
      const bidAmount = ethers.parseEther("1");
      await expect(auction.connect(bidder1).bid({ value: bidAmount }))
        .to.emit(auction, "Bid")
        .withArgs(bidder1.address, bidAmount);

      expect(await auction.highestBid()).to.equal(bidAmount);
      expect(await auction.highestBidder()).to.equal(bidder1.address);
    });

    it("Should reject bids below the current highest bid", async function () {
      const initialBid = ethers.parseEther("1");
      await auction.connect(bidder1).bid({ value: initialBid });

      const lowerBid = ethers.parseEther("0.5");
      await expect(auction.connect(bidder2).bid({ value: lowerBid }))
        .to.be.revertedWith("bid too low");
    });

    it("Should reject bids after auction ends", async function () {
      await ethers.provider.send("evm_increaseTime", [Number(duration) + 1]);
      await ethers.provider.send("evm_mine");

      const bidAmount = ethers.parseEther("1");
      await expect(auction.connect(bidder1).bid({ value: bidAmount }))
        .to.be.revertedWith("auction ended");
    });

    it("Should refund previous highest bidder when a new higher bid is placed", async function () {
      const firstBid = ethers.parseEther("1");
      await auction.connect(bidder1).bid({ value: firstBid });

      const secondBid = ethers.parseEther("2");
      await auction.connect(bidder2).bid({ value: secondBid });

      expect(await auction.refunds(bidder1.address)).to.equal(firstBid);
    });
  });

  describe("Withdrawing Refunds", function () {
    it("Should allow bidder to withdraw refund", async function () {
      const firstBid = ethers.parseEther("1");
      await auction.connect(bidder1).bid({ value: firstBid });

      const secondBid = ethers.parseEther("2");
      await auction.connect(bidder2).bid({ value: secondBid });

      const initialBalance = await ethers.provider.getBalance(bidder1.address);
      const tx = await auction.connect(bidder1).withdrawRefund();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await auction.refunds(bidder1.address)).to.equal(0n);
      expect(await ethers.provider.getBalance(bidder1.address)).to.equal(
        initialBalance + firstBid - gasUsed
      );
    });

    it("Should reject withdrawals for bidders with no refund", async function () {
      await expect(auction.connect(bidder1).withdrawRefund())
        .to.be.revertedWith("no refund");
    });
  });

  describe("Finalizing Auction", function () {
    it("Should allow seller to finalize auction after it ends", async function () {
      const bidAmount = ethers.parseEther("1");
      await auction.connect(bidder1).bid({ value: bidAmount });

      await ethers.provider.send("evm_increaseTime", [Number(duration) + 1]);
      await ethers.provider.send("evm_mine");

      const initialBalance = await ethers.provider.getBalance(seller.address);
      const tx = await auction.connect(seller).finalize();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await auction.ended()).to.be.true;
      expect(await ethers.provider.getBalance(seller.address)).to.equal(
        initialBalance + bidAmount - gasUsed
      );
    });

    it("Should reject finalization before auction ends", async function () {
      await expect(auction.connect(seller).finalize())
        .to.be.revertedWith("too early");
    });

    it("Should reject finalization if already ended", async function () {
      await ethers.provider.send("evm_increaseTime", [Number(duration) + 1]);
      await ethers.provider.send("evm_mine");

      await auction.connect(seller).finalize();
      await expect(auction.connect(seller).finalize())
        .to.be.revertedWith("already ended");
    });
  });
});