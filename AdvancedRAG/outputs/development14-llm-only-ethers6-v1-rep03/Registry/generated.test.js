const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Registry", function () {
  let registry;
  let owner;
  let otherAccount;
  let key1;
  let key2;
  let value1;
  let value2;

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();

    key1 = ethers.keccak256(ethers.toUtf8Bytes("key1"));
    key2 = ethers.keccak256(ethers.toUtf8Bytes("key2"));
    value1 = "value1";
    value2 = "value2";
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });
  });

  describe("set", function () {
    it("Should set a record and emit RecordSet event", async function () {
      await expect(registry.set(key1, value1))
        .to.emit(registry, "RecordSet")
        .withArgs(key1, value1);

      expect(await registry.get(key1)).to.equal(value1);
      expect(await registry.exists(key1)).to.be.true;
    });

    it("Should revert if not called by owner", async function () {
      await expect(registry.connect(otherAccount).set(key1, value1))
        .to.be.revertedWith("not owner");
    });

    it("Should update an existing record", async function () {
      await registry.set(key1, value1);
      await expect(registry.set(key1, value2))
        .to.emit(registry, "RecordSet")
        .withArgs(key1, value2);

      expect(await registry.get(key1)).to.equal(value2);
    });
  });

  describe("get", function () {
    it("Should return the correct value for an existing key", async function () {
      await registry.set(key1, value1);
      expect(await registry.get(key1)).to.equal(value1);
    });

    it("Should revert for a non-existent key", async function () {
      await expect(registry.get(key1)).to.be.revertedWith("missing");
    });
  });

  describe("remove", function () {
    it("Should remove a record and emit RecordRemoved event", async function () {
      await registry.set(key1, value1);
      await expect(registry.remove(key1))
        .to.emit(registry, "RecordRemoved")
        .withArgs(key1);

      expect(await registry.exists(key1)).to.be.false;
      await expect(registry.get(key1)).to.be.revertedWith("missing");
    });

    it("Should revert if not called by owner", async function () {
      await registry.set(key1, value1);
      await expect(registry.connect(otherAccount).remove(key1))
        .to.be.revertedWith("not owner");
    });

    it("Should revert for a non-existent key", async function () {
      await expect(registry.remove(key1)).to.be.revertedWith("missing");
    });
  });

  describe("State persistence", function () {
    it("Should maintain state between transactions", async function () {
      await registry.set(key1, value1);
      await registry.set(key2, value2);

      expect(await registry.get(key1)).to.equal(value1);
      expect(await registry.get(key2)).to.equal(value2);
      expect(await registry.exists(key1)).to.be.true;
      expect(await registry.exists(key2)).to.be.true;

      await registry.remove(key1);
      expect(await registry.exists(key1)).to.be.false;
      expect(await registry.exists(key2)).to.be.true;
    });
  });
});