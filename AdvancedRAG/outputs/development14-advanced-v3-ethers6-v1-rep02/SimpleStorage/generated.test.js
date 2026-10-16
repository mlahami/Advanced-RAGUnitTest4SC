const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BenchmarkTarget", function () {
  let contract;
  let owner;
  let other;

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();

    const Contract = await ethers.getContractFactory("BenchmarkTarget");
    contract = await Contract.deploy();
    await contract.waitForDeployment();
  });

  describe("setValue", function () {
    it("should set the value and emit ValueSet event", async function () {
      const newValue = 100n;

      await expect(contract.setValue(newValue))
        .to.emit(contract, "ValueSet")
        .withArgs(newValue);

      expect(await contract.value()).to.equal(newValue);
    });

    it("should allow setting value with ether", async function () {
      const newValue = 200n;
      const etherAmount = ethers.parseEther("1");

      await expect(contract.setValue(newValue, { value: etherAmount }))
        .to.emit(contract, "ValueSet")
        .withArgs(newValue);

      expect(await contract.value()).to.equal(newValue);
    });

    it("should allow setting value to zero", async function () {
      const newValue = 0n;

      await expect(contract.setValue(newValue))
        .to.emit(contract, "ValueSet")
        .withArgs(newValue);

      expect(await contract.value()).to.equal(newValue);
    });

    it("should allow setting value to maximum uint256", async function () {
      const newValue = ethers.MaxUint256;

      await expect(contract.setValue(newValue))
        .to.emit(contract, "ValueSet")
        .withArgs(newValue);

      expect(await contract.value()).to.equal(newValue);
    });
  });

  describe("value", function () {
    it("should return the current value", async function () {
      const initialValue = await contract.value();
      expect(initialValue).to.equal(0n);

      const newValue = 50n;
      await contract.setValue(newValue);
      expect(await contract.value()).to.equal(newValue);
    });
  });

  describe("fail", function () {
    it("should revert with target failure message", async function () {
      await expect(contract.fail())
        .to.be.revertedWith("target failure");
    });
  });
});