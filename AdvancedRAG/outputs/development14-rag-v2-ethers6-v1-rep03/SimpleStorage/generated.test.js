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
    it("Should set the initial value to 0", async function () {
      expect(await benchmarkTarget.value()).to.equal(0n);
    });
  });

  describe("setValue", function () {
    it("Should update the value and emit ValueSet event", async function () {
      const newValue = 100n;
      await expect(benchmarkTarget.setValue(newValue))
        .to.emit(benchmarkTarget, "ValueSet")
        .withArgs(newValue);

      expect(await benchmarkTarget.value()).to.equal(newValue);
    });

    it("Should allow setting value to 0", async function () {
      const newValue = 0n;
      await expect(benchmarkTarget.setValue(newValue))
        .to.emit(benchmarkTarget, "ValueSet")
        .withArgs(newValue);

      expect(await benchmarkTarget.value()).to.equal(newValue);
    });

    it("Should allow setting value to maximum uint256", async function () {
      const newValue = ethers.MaxUint256;
      await expect(benchmarkTarget.setValue(newValue))
        .to.emit(benchmarkTarget, "ValueSet")
        .withArgs(newValue);

      expect(await benchmarkTarget.value()).to.equal(newValue);
    });

    it("Should accept ether when setting value", async function () {
      const newValue = 200n;
      const tx = await benchmarkTarget.setValue(newValue, { value: ethers.parseEther("1.0") });
      await expect(tx).to.changeEtherBalance(owner, -ethers.parseEther("1.0"));
    });
  });

  describe("value", function () {
    it("Should return the current value", async function () {
      const testValue = 42n;
      await benchmarkTarget.setValue(testValue);
      expect(await benchmarkTarget.value()).to.equal(testValue);
    });
  });

  describe("fail", function () {
    it("Should revert with 'target failure' message", async function () {
      await expect(benchmarkTarget.fail())
        .to.be.revertedWith("target failure");
    });
  });
});