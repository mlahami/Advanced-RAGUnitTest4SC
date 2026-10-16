const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Escrow", function () {
  let escrow;
  let seller, buyer, arbiter, other;
  const fundAmount = ethers.parseEther("1");

  beforeEach(async function () {
    [seller, buyer, arbiter, other] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.connect(buyer).deploy(seller.address, arbiter.address);
    await escrow.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct seller, buyer, and arbiter", async function () {
      expect(await escrow.seller()).to.equal(seller.address);
      expect(await escrow.buyer()).to.equal(buyer.address);
      expect(await escrow.arbiter()).to.equal(arbiter.address);
    });

    it("should initialize with funded and closed as false", async function () {
      expect(await escrow.funded()).to.be.false;
      expect(await escrow.closed()).to.be.false;
    });
  });

  describe("Funding", function () {
    it("should allow the buyer to fund the escrow", async function () {
      await expect(escrow.connect(buyer).fund({ value: fundAmount }))
        .to.emit(escrow, "Funded")
        .withArgs(fundAmount);

      expect(await escrow.funded()).to.be.true;
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(fundAmount);
    });

    it("should revert if not called by the buyer", async function () {
      await expect(escrow.connect(other).fund({ value: fundAmount }))
        .to.be.revertedWith("only buyer");
    });

    it("should revert if already funded", async function () {
      await escrow.connect(buyer).fund({ value: fundAmount });
      await expect(escrow.connect(buyer).fund({ value: fundAmount }))
        .to.be.revertedWith("invalid funding");
    });

    it("should revert if funding amount is zero", async function () {
      await expect(escrow.connect(buyer).fund({ value: 0 }))
        .to.be.revertedWith("invalid funding");
    });
  });

  describe("Releasing funds", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).fund({ value: fundAmount });
    });

    it("should allow the buyer to release funds", async function () {
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

      await expect(escrow.connect(buyer).release())
        .to.emit(escrow, "Released")
        .withArgs(fundAmount);

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
      expect(await ethers.provider.getBalance(seller.address)).to.equal(sellerBalanceBefore + fundAmount);
    });

    it("should allow the arbiter to release funds", async function () {
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

      await expect(escrow.connect(arbiter).release())
        .to.emit(escrow, "Released")
        .withArgs(fundAmount);

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
      expect(await ethers.provider.getBalance(seller.address)).to.equal(sellerBalanceBefore + fundAmount);
    });

    it("should revert if not called by buyer or arbiter", async function () {
      await expect(escrow.connect(other).release())
        .to.be.revertedWith("not authorized");
    });

    it("should revert if not funded", async function () {
      const newEscrow = await (await ethers.getContractFactory("Escrow")).connect(buyer).deploy(seller.address, arbiter.address);
      await newEscrow.waitForDeployment();
      await expect(newEscrow.connect(buyer).release())
        .to.be.revertedWith("not releasable");
    });

    it("should revert if already closed", async function () {
      await escrow.connect(buyer).release();
      await expect(escrow.connect(buyer).release())
        .to.be.revertedWith("not releasable");
    });
  });

  describe("Refunding funds", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).fund({ value: fundAmount });
    });

    it("should allow the seller to refund funds", async function () {
      const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);

      await expect(escrow.connect(seller).refund())
        .to.emit(escrow, "Refunded")
        .withArgs(fundAmount);

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
      expect(await ethers.provider.getBalance(buyer.address)).to.be.gt(buyerBalanceBefore);
    });

    it("should allow the arbiter to refund funds", async function () {
      const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);

      await expect(escrow.connect(arbiter).refund())
        .to.emit(escrow, "Refunded")
        .withArgs(fundAmount);

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
      expect(await ethers.provider.getBalance(buyer.address)).to.be.gt(buyerBalanceBefore);
    });

    it("should revert if not called by seller or arbiter", async function () {
      await expect(escrow.connect(other).refund())
        .to.be.revertedWith("not authorized");
    });

    it("should revert if not funded", async function () {
      const newEscrow = await (await ethers.getContractFactory("Escrow")).connect(buyer).deploy(seller.address, arbiter.address);
      await newEscrow.waitForDeployment();
      await expect(newEscrow.connect(seller).refund())
        .to.be.revertedWith("not refundable");
    });

    it("should revert if already closed", async function () {
      await escrow.connect(seller).refund();
      await expect(escrow.connect(seller).refund())
        .to.be.revertedWith("not refundable");
    });
  });
});