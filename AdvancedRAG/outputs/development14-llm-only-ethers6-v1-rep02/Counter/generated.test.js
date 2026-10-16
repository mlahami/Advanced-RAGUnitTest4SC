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
      await expect(counter.increment()).to.not.emit(counter, "Incremented");
    });
  });

  describe("Decrement", function () {
    it("Should decrement the count", async function () {
      await counter.increment();
      await counter.decrement();
      expect(await counter.count()).to.equal(0n);
    });

    it("Should revert when count is zero", async function () {
      await expect(counter.decrement()).to.be.revertedWith("underflow");
    });
  });

  describe("Reset", function () {
    it("Should reset the count to zero", async function () {
      await counter.increment();
      await counter.reset();
      expect(await counter.count()).to.equal(0n);
    });

    it("Should revert if called by non-owner", async function () {
      await expect(counter.connect(otherAccount).reset()).to.be.revertedWith("not owner");
    });
  });

  describe("State Changes", function () {
    it("Should maintain correct count after multiple operations", async function () {
      await counter.increment();
      await counter.increment();
      await counter.decrement();
      expect(await counter.count()).to.equal(1n);
    });
  });
});