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

  describe("setValue", function () {
    it("should set the value and emit ValueSet event", async function () {
      const newValue = 100n;

      await expect(benchmarkTarget.setValue(newValue))
        .to.emit(benchmarkTarget, "ValueSet")
        .withArgs(newValue);

      expect(await benchmarkTarget.value()).to.equal(newValue);
    });

    it("should allow setting value with ether", async function () {
      const newValue = 200n;
      const ethAmount = ethers.parseEther("1");

      await expect(benchmarkTarget.setValue(newValue, { value: ethAmount }))
        .to.emit(benchmarkTarget, "ValueSet")
        .withArgs(newValue);

      expect(await benchmarkTarget.value()).to.equal(newValue);
    });
  });

  describe("value", function () {
    it("should return the current value", async function () {
      const initialValue = await benchmarkTarget.value();
      expect(initialValue).to.equal(0n);

      const newValue = 150n;
      await benchmarkTarget.setValue(newValue);
      expect(await benchmarkTarget.value()).to.equal(newValue);
    });
  });

  describe("fail", function () {
    it("should revert with 'target failure'", async function () {
      await expect(benchmarkTarget.fail())
        .to.be.revertedWith("target failure");
    });
  });
});