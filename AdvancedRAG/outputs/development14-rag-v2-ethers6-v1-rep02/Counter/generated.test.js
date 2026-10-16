const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Counter", function () {
  let counter;
  let owner;
  let otherAccount;

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    const Counter = await ethers.getContractFactory("Counter");
    counter = await Counter.deploy();
    await counter.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await counter.owner()).to.equal(owner.address);
    });

    it("Should initialize count to zero", async function () {
      expect(await counter.count()).to.equal(0n);
    });
  });

  describe("Increment", function () {
    it("Should increment the count", async function () {
      await counter.increment();
      expect(await counter.count()).to.equal(1n);
    });

    it("Should emit no events", async function () {
      await expect(counter.increment())
        .to.not.emit(counter, "ValueSet");
    });
  });

  describe("Decrement", function () {
    it("Should decrement the count", async function () {
      await counter.increment();
      await counter.decrement();
      expect(await counter.count()).to.equal(0n);
    });

    it("Should revert when count is zero", async function () {
      await expect(counter.decrement())
        .to.be.revertedWith("underflow");
    });

    it("Should emit no events", async function () {
      await counter.increment();
      await expect(counter.decrement())
        .to.not.emit(counter, "ValueSet");
    });
  });

  describe("Reset", function () {
    it("Should reset the count to zero", async function () {
      await counter.increment();
      await counter.reset();
      expect(await counter.count()).to.equal(0n);
    });

    it("Should revert when called by non-owner", async function () {
      await expect(counter.connect(otherAccount).reset())
        .to.be.revertedWith("not owner");
    });

    it("Should emit no events", async function () {
      await expect(counter.reset())
        .to.not.emit(counter, "ValueSet");
    });
  });

  describe("State Changes", function () {
    it("Should maintain correct state after multiple operations", async function () {
      await counter.increment();
      await counter.increment();
      await counter.decrement();
      expect(await counter.count()).to.equal(1n);

      await counter.reset();
      expect(await counter.count()).to.equal(0n);
    });
  });

  describe("Access Control", function () {
    it("Should allow owner to call reset", async function () {
      await expect(counter.reset())
        .to.not.be.reverted;
    });

    it("Should prevent non-owner from calling reset", async function () {
      await expect(counter.connect(otherAccount).reset())
        .to.be.revertedWith("not owner");
    });
  });

  describe("Boundary Conditions", function () {
    it("Should handle maximum uint256 value", async function () {
      // Set count to max uint256 - 1
      await counter.setValue(ethers.MaxUint256 - 1n);
      await counter.increment();
      expect(await counter.count()).to.equal(ethers.MaxUint256);

      // Should revert on next increment
      await expect(counter.increment())
        .to.be.reverted;
    });

    it("Should handle minimum uint256 value", async function () {
      await counter.reset();
      expect(await counter.count()).to.equal(0n);

      // Should revert on decrement
      await expect(counter.decrement())
        .to.be.revertedWith("underflow");
    });
  });
});