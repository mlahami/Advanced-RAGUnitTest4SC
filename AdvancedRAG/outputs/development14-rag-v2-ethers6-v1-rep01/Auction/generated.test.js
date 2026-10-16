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

    const Auction = await ethers.getContractFactory("Auction", seller);
    auction = await Auction.deploy(duration);
    await auction.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct seller and end time", async function () {
      expect(await auction.seller()).to.equal(seller.address);
      const endTime = await auction.endTime();
      const currentBlock = await ethers.provider.getBlock("latest");
      expect(endTime).to.equal(BigInt(currentBlock.timestamp) + duration);
    });

    it("Should initialize with zero highest bid and no highest bidder", async function () {
      expect(await auction.highestBid()).to.equal(0n);
      expect(await auction.highestBidder()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Bidding", function () {
    it("Should accept a valid bid", async function () {
      const bidAmount = ethers.parseEther("1");
      await expect(auction.connect(bidder1).bid({ value: bidAmount }))
        .to.emit(auction, "Bid")
        .withArgs(bidder1.address, bidAmount);

      expect(await auction.highestBid()).to.equal(bidAmount);
      expect(await auction.highestBidder()).to.equal(bidder1.address);
    });

    it("Should reject a bid below the current highest bid", async function () {
      const initialBid = ethers.parseEther("1");
      await auction.connect(bidder1).bid({ value: initialBid });

      const lowerBid = ethers.parseEther("0.5");
      await expect(auction.connect(bidder2).bid({ value: lowerBid }))
        .to.be.revertedWith("bid too low");
    });

    it("Should reject a bid after the auction has ended", async function () {
      await ethers.provider.send("evm_increaseTime", [Number(duration) + 1]);
      await ethers.provider.send("evm_mine");

      const bidAmount = ethers.parseEther("1");
      await expect(auction.connect(bidder1).bid({ value: bidAmount }))
        .to.be.revertedWith("auction ended");
    });

    it("Should refund the previous highest bidder when a new higher bid is placed", async function () {
      const firstBid = ethers.parseEther("1");
      await auction.connect(bidder1).bid({ value: firstBid });

      const secondBid = ethers.parseEther("2");
      await auction.connect(bidder2).bid({ value: secondBid });

      expect(await auction.refunds(bidder1.address)).to.equal(firstBid);
    });
  });

  describe("Withdrawing Refunds", function () {
    it("Should allow a bidder to withdraw their refund", async function () {
      const firstBid = ethers.parseEther("1");
      await auction.connect(bidder1).bid({ value: firstBid });

      const secondBid = ethers.parseEther("2");
      await auction.connect(bidder2).bid({ value: secondBid });

      const initialBalance = await ethers.provider.getBalance(bidder1.address);
      const tx = await auction.connect(bidder1).withdrawRefund();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(bidder1.address);
      expect(finalBalance).to.equal(initialBalance + firstBid - gasUsed);
      expect(await auction.refunds(bidder1.address)).to.equal(0n);
    });

    it("Should reject a refund request for a bidder with no refund", async function () {
      await expect(auction.connect(bidder1).withdrawRefund())
        .to.be.revertedWith("no refund");
    });
  });

  describe("Finalizing the Auction", function () {
    it("Should allow the seller to finalize the auction after it ends", async function () {
      const bidAmount = ethers.parseEther("1");
      await auction.connect(bidder1).bid({ value: bidAmount });

      await ethers.provider.send("evm_increaseTime", [Number(duration) + 1]);
      await ethers.provider.send("evm_mine");

      const initialBalance = await ethers.provider.getBalance(seller.address);
      const tx = await auction.connect(seller).finalize();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(seller.address);
      expect(finalBalance).to.equal(initialBalance + bidAmount - gasUsed);
      expect(await auction.ended()).to.be.true;
    });

    it("Should reject finalization before the auction ends", async function () {
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