const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Registry", function () {
  let registry;
  let owner;
  let otherAccount;
  const testKey = ethers.keccak256(ethers.toUtf8Bytes("testKey"));
  const testValue = "testValue";

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });
  });

  describe("set", function () {
    it("Should allow owner to set a record", async function () {
      await expect(registry.set(testKey, testValue))
        .to.emit(registry, "RecordSet")
        .withArgs(testKey, testValue);

      expect(await registry.get(testKey)).to.equal(testValue);
      expect(await registry.exists(testKey)).to.be.true;
    });

    it("Should revert when non-owner tries to set a record", async function () {
      await expect(registry.connect(otherAccount).set(testKey, testValue))
        .to.be.revertedWith("not owner");
    });
  });

  describe("get", function () {
    it("Should return the correct value for an existing key", async function () {
      await registry.set(testKey, testValue);
      expect(await registry.get(testKey)).to.equal(testValue);
    });

    it("Should revert when trying to get a non-existent key", async function () {
      await expect(registry.get(testKey)).to.be.revertedWith("missing");
    });
  });

  describe("remove", function () {
    it("Should allow owner to remove a record", async function () {
      await registry.set(testKey, testValue);
      await expect(registry.remove(testKey))
        .to.emit(registry, "RecordRemoved")
        .withArgs(testKey);

      await expect(registry.get(testKey)).to.be.revertedWith("missing");
      expect(await registry.exists(testKey)).to.be.false;
    });

    it("Should revert when non-owner tries to remove a record", async function () {
      await registry.set(testKey, testValue);
      await expect(registry.connect(otherAccount).remove(testKey))
        .to.be.revertedWith("not owner");
    });
  });

  describe("exists", function () {
    it("Should return true for an existing key", async function () {
      await registry.set(testKey, testValue);
      expect(await registry.exists(testKey)).to.be.true;
    });

    it("Should return false for a non-existent key", async function () {
      expect(await registry.exists(testKey)).to.be.false;
    });
  });
});