const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Registry", function () {
  let registry;
  let owner;
  let otherAccount;

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
      const key = ethers.keccak256(ethers.toUtf8Bytes("test-key"));
      const value = "test-value";

      await expect(registry.connect(owner).set(key, value))
        .to.emit(registry, "RecordSet")
        .withArgs(key, value);

      expect(await registry.get(key)).to.equal(value);
      expect(await registry.exists(key)).to.be.true;
    });

    it("Should revert when non-owner tries to set a record", async function () {
      const key = ethers.keccak256(ethers.toUtf8Bytes("test-key"));
      const value = "test-value";

      await expect(registry.connect(otherAccount).set(key, value))
        .to.be.revertedWith("not owner");
    });
  });

  describe("get", function () {
    it("Should return the correct value for an existing key", async function () {
      const key = ethers.keccak256(ethers.toUtf8Bytes("test-key"));
      const value = "test-value";

      await registry.connect(owner).set(key, value);
      expect(await registry.get(key)).to.equal(value);
    });

    it("Should revert when trying to get a non-existent key", async function () {
      const key = ethers.keccak256(ethers.toUtf8Bytes("non-existent-key"));

      await expect(registry.get(key)).to.be.revertedWith("missing");
    });
  });

  describe("remove", function () {
    it("Should allow owner to remove a record", async function () {
      const key = ethers.keccak256(ethers.toUtf8Bytes("test-key"));
      const value = "test-value";

      await registry.connect(owner).set(key, value);
      await expect(registry.connect(owner).remove(key))
        .to.emit(registry, "RecordRemoved")
        .withArgs(key);

      await expect(registry.get(key)).to.be.revertedWith("missing");
      expect(await registry.exists(key)).to.be.false;
    });

    it("Should revert when non-owner tries to remove a record", async function () {
      const key = ethers.keccak256(ethers.toUtf8Bytes("test-key"));
      const value = "test-value";

      await registry.connect(owner).set(key, value);
      await expect(registry.connect(otherAccount).remove(key))
        .to.be.revertedWith("not owner");
    });
  });

  describe("State Management", function () {
    it("Should correctly track existence of records", async function () {
      const key1 = ethers.keccak256(ethers.toUtf8Bytes("key1"));
      const key2 = ethers.keccak256(ethers.toUtf8Bytes("key2"));

      expect(await registry.exists(key1)).to.be.false;
      expect(await registry.exists(key2)).to.be.false;

      await registry.connect(owner).set(key1, "value1");
      expect(await registry.exists(key1)).to.be.true;
      expect(await registry.exists(key2)).to.be.false;

      await registry.connect(owner).remove(key1);
      expect(await registry.exists(key1)).to.be.false;
    });
  });
});