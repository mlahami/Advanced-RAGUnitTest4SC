const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Registry", function () {
  let registry;
  let owner;
  let otherAccount;
  const key = ethers.keccak256(ethers.toUtf8Bytes("testKey"));
  const value = "testValue";

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
    it("Should set a record and emit RecordSet event", async function () {
      await expect(registry.set(key, value))
        .to.emit(registry, "RecordSet")
        .withArgs(key, value);

      expect(await registry.get(key)).to.equal(value);
      expect(await registry.exists(key)).to.be.true;
    });

    it("Should revert if not called by owner", async function () {
      await expect(registry.connect(otherAccount).set(key, value))
        .to.be.revertedWith("not owner");
    });
  });

  describe("get", function () {
    it("Should return the correct value for an existing key", async function () {
      await registry.set(key, value);
      expect(await registry.get(key)).to.equal(value);
    });

    it("Should revert for a non-existent key", async function () {
      await expect(registry.get(key)).to.be.revertedWith("missing");
    });
  });

  describe("remove", function () {
    it("Should remove a record and emit RecordRemoved event", async function () {
      await registry.set(key, value);
      await expect(registry.remove(key))
        .to.emit(registry, "RecordRemoved")
        .withArgs(key);

      await expect(registry.get(key)).to.be.revertedWith("missing");
      expect(await registry.exists(key)).to.be.false;
    });

    it("Should revert if not called by owner", async function () {
      await registry.set(key, value);
      await expect(registry.connect(otherAccount).remove(key))
        .to.be.revertedWith("not owner");
    });
  });

  describe("State persistence", function () {
    it("Should maintain state between transactions", async function () {
      await registry.set(key, value);
      expect(await registry.get(key)).to.equal(value);

      const newValue = "newValue";
      await registry.set(key, newValue);
      expect(await registry.get(key)).to.equal(newValue);
    });

    it("Should not affect other keys", async function () {
      const otherKey = ethers.keccak256(ethers.toUtf8Bytes("otherKey"));
      await registry.set(key, value);
      await registry.set(otherKey, "otherValue");

      expect(await registry.get(key)).to.equal(value);
      expect(await registry.get(otherKey)).to.equal("otherValue");
    });
  });
});