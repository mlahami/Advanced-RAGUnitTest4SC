const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Auction", function () {
  let auction;
  let seller;
  let bidder1;
  let bidder2;
  let duration = 3600; // 1 hour

  beforeEach(async function () {
    [seller, bidder1, bidder2] = await ethers.getSigners();

    const Auction = await ethers.getContractFactory("Auction");
    auction = await Auction.connect(seller).deploy(duration);
    await auction.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct seller and endTime", async function () {
      expect(await auction.seller()).to.equal(seller.address);
      expect(await auction.endTime()).to.equal((await ethers.provider.getBlock("latest")).timestamp + duration);
    });

    it("should initialize with zero highest bid and no highest bidder", async function () {
      expect(await auction.highestBid()).to.equal(0n);
      expect(await auction.highestBidder()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Bidding", function () {
    it("should accept a valid bid", async function () {
      const bidAmount = ethers.parseEther("1");
      await expect(auction.connect(bidder1).bid({ value: bidAmount }))
        .to.emit(auction, "Bid")
        .withArgs(bidder1.address, bidAmount);

      expect(await auction.highestBid()).to.equal(bidAmount);
      expect(await auction.highestBidder()).to.equal(bidder1.address);
    });

    it("should refund the previous highest bidder", async function () {
      const firstBid = ethers.parseEther("1");
      const secondBid = ethers.parseEther("2");

      await auction.connect(bidder1).bid({ value: firstBid });
      await auction.connect(bidder2).bid({ value: secondBid });

      expect(await auction.refunds(bidder1.address)).to.equal(firstBid);
    });

    it("should revert if bid is too low", async function () {
      const firstBid = ethers.parseEther("1");
      const secondBid = ethers.parseEther("0.5");

      await auction.connect(bidder1).bid({ value: firstBid });
      await expect(auction.connect(bidder2).bid({ value: secondBid }))
        .to.be.revertedWith("bid too low");
    });

    it("should revert if auction has ended", async function () {
      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      await expect(auction.connect(bidder1).bid({ value: ethers.parseEther("1") }))
        .to.be.revertedWith("auction ended");
    });
  });

  describe("Withdrawing Refunds", function () {
    it("should allow a bidder to withdraw their refund", async function () {
      const firstBid = ethers.parseEther("1");
      const secondBid = ethers.parseEther("2");

      await auction.connect(bidder1).bid({ value: firstBid });
      await auction.connect(bidder2).bid({ value: secondBid });

      const initialBalance = await ethers.provider.getBalance(bidder1.address);
      const tx = await auction.connect(bidder1).withdrawRefund();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await ethers.provider.getBalance(bidder1.address)).to.equal(initialBalance + firstBid - gasUsed);
      expect(await auction.refunds(bidder1.address)).to.equal(0n);
    });

    it("should revert if no refund is available", async function () {
      await expect(auction.connect(bidder1).withdrawRefund())
        .to.be.revertedWith("no refund");
    });
  });

  describe("Finalizing Auction", function () {
    it("should allow the seller to finalize the auction after it ends", async function () {
      const bidAmount = ethers.parseEther("1");
      await auction.connect(bidder1).bid({ value: bidAmount });

      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      const initialBalance = await ethers.provider.getBalance(seller.address);
      const tx = await auction.connect(seller).finalize();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await ethers.provider.getBalance(seller.address)).to.equal(initialBalance + bidAmount - gasUsed);
      expect(await auction.ended()).to.be.true;
    });

    it("should revert if finalizing before auction ends", async function () {
      await expect(auction.connect(seller).finalize())
        .to.be.revertedWith("too early");
    });

    it("should revert if auction is already ended", async function () {
      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      await auction.connect(seller).finalize();
      await expect(auction.connect(seller).finalize())
        .to.be.revertedWith("already ended");
    });
  });
});