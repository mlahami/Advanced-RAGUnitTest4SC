const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BenchmarkTarget", function () {
  let benchmarkTarget;
  let owner;
  let otherAccount;

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    const BenchmarkTarget = await ethers.getContractFactory("BenchmarkTarget");
    benchmarkTarget = await BenchmarkTarget.deploy();
    await benchmarkTarget.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct initial value", async function () {
      expect(await benchmarkTarget.value()).to.equal(0n);
    });
  });

  describe("setValue", function () {
    it("Should update the value and emit ValueSet event", async function () {
      const newValue = 42n;
      await expect(benchmarkTarget.setValue(newValue))
        .to.emit(benchmarkTarget, "ValueSet")
        .withArgs(newValue);

      expect(await benchmarkTarget.value()).to.equal(newValue);
    });

    it("Should allow setting value to zero", async function () {
      await benchmarkTarget.setValue(100n);
      await benchmarkTarget.setValue(0n);
      expect(await benchmarkTarget.value()).to.equal(0n);
    });

    it("Should allow setting value to maximum uint256", async function () {
      const maxValue = ethers.MaxUint256;
      await benchmarkTarget.setValue(maxValue);
      expect(await benchmarkTarget.value()).to.equal(maxValue);
    });

    it("Should accept ether when setting value", async function () {
      const tx = await benchmarkTarget.setValue(100n, { value: ethers.parseEther("1") });
      await expect(tx).to.changeEtherBalance(owner, -ethers.parseEther("1"));
    });
  });

  describe("value", function () {
    it("Should return the current value", async function () {
      const testValue = 12345n;
      await benchmarkTarget.setValue(testValue);
      expect(await benchmarkTarget.value()).to.equal(testValue);
    });
  });

  describe("fail", function () {
    it("Should revert with 'target failure'", async function () {
      await expect(benchmarkTarget.fail()).to.be.revertedWith("target failure");
    });
  });
});