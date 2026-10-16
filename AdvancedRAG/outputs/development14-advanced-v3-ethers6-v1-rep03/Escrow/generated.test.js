const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Escrow", function () {
  let escrow;
  let seller, buyer, arbiter, other;
  const amount = ethers.parseEther("1");

  beforeEach(async function () {
    [seller, buyer, arbiter, other] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.deploy(seller.address, arbiter.address);
    await escrow.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct seller, buyer, and arbiter", async function () {
      expect(await escrow.seller()).to.equal(seller.address);
      expect(await escrow.buyer()).to.equal(buyer.address);
      expect(await escrow.arbiter()).to.equal(arbiter.address);
    });

    it("Should initialize with funded and closed as false", async function () {
      expect(await escrow.funded()).to.be.false;
      expect(await escrow.closed()).to.be.false;
    });
  });

  describe("Funding", function () {
    it("Should allow buyer to fund the escrow", async function () {
      await expect(escrow.connect(buyer).fund({ value: amount }))
        .to.emit(escrow, "Funded")
        .withArgs(amount);

      expect(await escrow.funded()).to.be.true;
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(amount);
    });

    it("Should revert if non-buyer tries to fund", async function () {
      await expect(escrow.connect(other).fund({ value: amount }))
        .to.be.revertedWith("only buyer");
    });

    it("Should revert if funding with zero value", async function () {
      await expect(escrow.connect(buyer).fund({ value: 0 }))
        .to.be.revertedWith("invalid funding");
    });

    it("Should revert if trying to fund twice", async function () {
      await escrow.connect(buyer).fund({ value: amount });
      await expect(escrow.connect(buyer).fund({ value: amount }))
        .to.be.revertedWith("invalid funding");
    });
  });

  describe("Releasing funds", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).fund({ value: amount });
    });

    it("Should allow buyer to release funds", async function () {
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

      await expect(escrow.connect(buyer).release())
        .to.emit(escrow, "Released")
        .withArgs(amount);

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
      expect(await ethers.provider.getBalance(seller.address)).to.equal(sellerBalanceBefore + amount);
    });

    it("Should allow arbiter to release funds", async function () {
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

      await expect(escrow.connect(arbiter).release())
        .to.emit(escrow, "Released")
        .withArgs(amount);

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
      expect(await ethers.provider.getBalance(seller.address)).to.equal(sellerBalanceBefore + amount);
    });

    it("Should revert if non-authorized tries to release", async function () {
      await expect(escrow.connect(other).release())
        .to.be.revertedWith("not authorized");
    });

    it("Should revert if trying to release when not funded", async function () {
      const newEscrow = await (await ethers.getContractFactory("Escrow")).deploy(seller.address, arbiter.address);
      await newEscrow.waitForDeployment();

      await expect(newEscrow.connect(buyer).release())
        .to.be.revertedWith("not releasable");
    });

    it("Should revert if trying to release when already closed", async function () {
      await escrow.connect(buyer).release();
      await expect(escrow.connect(buyer).release())
        .to.be.revertedWith("not releasable");
    });
  });

  describe("Refunding", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).fund({ value: amount });
    });

    it("Should allow seller to refund", async function () {
      const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);

      await expect(escrow.connect(seller).refund())
        .to.emit(escrow, "Refunded")
        .withArgs(amount);

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
      expect(await ethers.provider.getBalance(buyer.address)).to.be.gt(buyerBalanceBefore);
    });

    it("Should allow arbiter to refund", async function () {
      const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);

      await expect(escrow.connect(arbiter).refund())
        .to.emit(escrow, "Refunded")
        .withArgs(amount);

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
      expect(await ethers.provider.getBalance(buyer.address)).to.be.gt(buyerBalanceBefore);
    });

    it("Should revert if non-authorized tries to refund", async function () {
      await expect(escrow.connect(other).refund())
        .to.be.revertedWith("not authorized");
    });

    it("Should revert if trying to refund when not funded", async function () {
      const newEscrow = await (await ethers.getContractFactory("Escrow")).deploy(seller.address, arbiter.address);
      await newEscrow.waitForDeployment();

      await expect(newEscrow.connect(seller).refund())
        .to.be.revertedWith("not refundable");
    });

    it("Should revert if trying to refund when already closed", async function () {
      await escrow.connect(seller).refund();
      await expect(escrow.connect(seller).refund())
        .to.be.revertedWith("not refundable");
    });
  });

  describe("State changes", function () {
    it("Should correctly update state when funding", async function () {
      await escrow.connect(buyer).fund({ value: amount });
      expect(await escrow.funded()).to.be.true;
      expect(await escrow.closed()).to.be.false;
    });

    it("Should correctly update state when releasing", async function () {
      await escrow.connect(buyer).fund({ value: amount });
      await escrow.connect(buyer).release();
      expect(await escrow.funded()).to.be.true;
      expect(await escrow.closed()).to.be.true;
    });

    it("Should correctly update state when refunding", async function () {
      await escrow.connect(buyer).fund({ value: amount });
      await escrow.connect(seller).refund();
      expect(await escrow.funded()).to.be.true;
      expect(await escrow.closed()).to.be.true;
    });
  });
});