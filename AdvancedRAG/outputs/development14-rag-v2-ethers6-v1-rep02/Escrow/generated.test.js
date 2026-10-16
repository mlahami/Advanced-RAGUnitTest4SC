const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Escrow", function () {
  let escrow;
  let seller, buyer, arbiter, other;

  beforeEach(async function () {
    [seller, buyer, arbiter, other] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.deploy(seller.address, arbiter.address);
    await escrow.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct immutable addresses", async function () {
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
      const amount = ethers.parseEther("1.0");
      await expect(escrow.connect(buyer).fund({ value: amount }))
        .to.emit(escrow, "Funded")
        .withArgs(amount);

      expect(await escrow.funded()).to.be.true;
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(amount);
    });

    it("Should revert if not called by buyer", async function () {
      await expect(escrow.connect(other).fund({ value: ethers.parseEther("1.0") }))
        .to.be.revertedWith("only buyer");
    });

    it("Should revert if already funded", async function () {
      await escrow.connect(buyer).fund({ value: ethers.parseEther("1.0") });
      await expect(escrow.connect(buyer).fund({ value: ethers.parseEther("1.0") }))
        .to.be.revertedWith("invalid funding");
    });

    it("Should revert if funding amount is zero", async function () {
      await expect(escrow.connect(buyer).fund({ value: 0 }))
        .to.be.revertedWith("invalid funding");
    });
  });

  describe("Releasing funds", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).fund({ value: ethers.parseEther("1.0") });
    });

    it("Should allow buyer to release funds", async function () {
      const initialBalance = await ethers.provider.getBalance(seller.address);
      const tx = await escrow.connect(buyer).release();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(seller.address))
        .to.equal(initialBalance + ethers.parseEther("1.0") - gasUsed);
    });

    it("Should allow arbiter to release funds", async function () {
      const initialBalance = await ethers.provider.getBalance(seller.address);
      const tx = await escrow.connect(arbiter).release();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(seller.address))
        .to.equal(initialBalance + ethers.parseEther("1.0") - gasUsed);
    });

    it("Should revert if not called by buyer or arbiter", async function () {
      await expect(escrow.connect(other).release())
        .to.be.revertedWith("not authorized");
    });

    it("Should revert if not funded", async function () {
      const newEscrow = await (await ethers.getContractFactory("Escrow")).deploy(seller.address, arbiter.address);
      await newEscrow.waitForDeployment();
      await expect(newEscrow.connect(buyer).release())
        .to.be.revertedWith("not releasable");
    });

    it("Should revert if already closed", async function () {
      await escrow.connect(buyer).release();
      await expect(escrow.connect(buyer).release())
        .to.be.revertedWith("not releasable");
    });
  });

  describe("Refunding", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).fund({ value: ethers.parseEther("1.0") });
    });

    it("Should allow seller to refund", async function () {
      const initialBalance = await ethers.provider.getBalance(buyer.address);
      const tx = await escrow.connect(seller).refund();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(buyer.address))
        .to.equal(initialBalance + ethers.parseEther("1.0") - gasUsed);
    });

    it("Should allow arbiter to refund", async function () {
      const initialBalance = await ethers.provider.getBalance(buyer.address);
      const tx = await escrow.connect(arbiter).refund();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await escrow.closed()).to.be.true;
      expect(await ethers.provider.getBalance(buyer.address))
        .to.equal(initialBalance + ethers.parseEther("1.0") - gasUsed);
    });

    it("Should revert if not called by seller or arbiter", async function () {
      await expect(escrow.connect(other).refund())
        .to.be.revertedWith("not authorized");
    });

    it("Should revert if not funded", async function () {
      const newEscrow = await (await ethers.getContractFactory("Escrow")).deploy(seller.address, arbiter.address);
      await newEscrow.waitForDeployment();
      await expect(newEscrow.connect(seller).refund())
        .to.be.revertedWith("not refundable");
    });

    it("Should revert if already closed", async function () {
      await escrow.connect(seller).refund();
      await expect(escrow.connect(seller).refund())
        .to.be.revertedWith("not refundable");
    });
  });

  describe("State changes", function () {
    it("Should not allow funding after release", async function () {
      await escrow.connect(buyer).fund({ value: ethers.parseEther("1.0") });
      await escrow.connect(buyer).release();
      await expect(escrow.connect(buyer).fund({ value: ethers.parseEther("1.0") }))
        .to.be.revertedWith("invalid funding");
    });

    it("Should not allow funding after refund", async function () {
      await escrow.connect(buyer).fund({ value: ethers.parseEther("1.0") });
      await escrow.connect(seller).refund();
      await expect(escrow.connect(buyer).fund({ value: ethers.parseEther("1.0") }))
        .to.be.revertedWith("invalid funding");
    });

    it("Should not allow release after refund", async function () {
      await escrow.connect(buyer).fund({ value: ethers.parseEther("1.0") });
      await escrow.connect(seller).refund();
      await expect(escrow.connect(buyer).release())
        .to.be.revertedWith("not releasable");
    });

    it("Should not allow refund after release", async function () {
      await escrow.connect(buyer).fund({ value: ethers.parseEther("1.0") });
      await escrow.connect(buyer).release();
      await expect(escrow.connect(seller).refund())
        .to.be.revertedWith("not refundable");
    });
  });
});