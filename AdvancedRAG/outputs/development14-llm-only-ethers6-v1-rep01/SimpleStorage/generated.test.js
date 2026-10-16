const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BenchmarkTarget", function () {
  let contract;
  let owner;
  let otherAccount;

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    const BenchmarkTarget = await ethers.getContractFactory("BenchmarkTarget");
    contract = await BenchmarkTarget.deploy();
    await contract.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the initial value to 0", async function () {
      expect(await contract.value()).to.equal(0n);
    });
  });

  describe("setValue", function () {
    it("Should update the value and emit ValueSet event", async function () {
      const newValue = 42n;
      await expect(contract.setValue(newValue))
        .to.emit(contract, "ValueSet")
        .withArgs(newValue);

      expect(await contract.value()).to.equal(newValue);
    });

    it("Should allow setting value with ETH", async function () {
      const newValue = 100n;
      const ethAmount = ethers.parseEther("1");

      await expect(contract.setValue(newValue, { value: ethAmount }))
        .to.emit(contract, "ValueSet")
        .withArgs(newValue);

      expect(await contract.value()).to.equal(newValue);
    });
  });

  describe("value", function () {
    it("Should return the current value", async function () {
      const testValue = 123n;
      await contract.setValue(testValue);
      expect(await contract.value()).to.equal(testValue);
    });
  });

  describe("fail", function () {
    it("Should revert with 'target failure'", async function () {
      await expect(contract.fail()).to.be.revertedWith("target failure");
    });
  });
});