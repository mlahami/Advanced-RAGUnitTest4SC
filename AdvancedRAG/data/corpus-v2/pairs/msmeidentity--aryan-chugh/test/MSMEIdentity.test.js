const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("MSMEIdentity", function () {
  async function deployMSMEIdentityFixture() {
    const [owner, msme, operator, other] = await ethers.getSigners();

    const MSMEIdentity = await ethers.getContractFactory("MSMEIdentity");
    const identity = await MSMEIdentity.deploy(msme.address);

    return { identity, owner, msme, operator, other };
  }

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      const { identity, msme } = await loadFixture(deployMSMEIdentityFixture);
      expect(await identity.owner()).to.equal(msme.address);
    });

    it("Should revert if initial owner is zero address", async function () {
      const MSMEIdentity = await ethers.getContractFactory("MSMEIdentity");
      await expect(
        MSMEIdentity.deploy(ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe("Operator Management", function () {
    it("Should allow owner to approve operator", async function () {
      const { identity, msme, operator } = await loadFixture(deployMSMEIdentityFixture);
      
      await expect(identity.connect(msme).approveOperator(operator.address))
        .to.emit(identity, "OperatorApproved")
        .withArgs(operator.address);
      
      expect(await identity.isApprovedOperator(operator.address)).to.be.true;
    });

    it("Should allow owner to revoke operator", async function () {
      const { identity, msme, operator } = await loadFixture(deployMSMEIdentityFixture);
      
      await identity.connect(msme).approveOperator(operator.address);
      
      await expect(identity.connect(msme).revokeOperator(operator.address))
        .to.emit(identity, "OperatorRevoked")
        .withArgs(operator.address);
      
      expect(await identity.isApprovedOperator(operator.address)).to.be.false;
    });

    it("Should not allow non-owner to approve operator", async function () {
      const { identity, other, operator } = await loadFixture(deployMSMEIdentityFixture);
      
      await expect(
        identity.connect(other).approveOperator(operator.address)
      ).to.be.revertedWithCustomError(identity, "OwnableUnauthorizedAccount");
    });

    it("Should revert when approving zero address as operator", async function () {
      const { identity, msme } = await loadFixture(deployMSMEIdentityFixture);
      
      await expect(
        identity.connect(msme).approveOperator(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid operator address");
    });
  });

  describe("Data Management", function () {
    it("Should allow owner to set data", async function () {
      const { identity, msme } = await loadFixture(deployMSMEIdentityFixture);
      
      const key = ethers.keccak256(ethers.toUtf8Bytes("gst-number"));
      const value = ethers.toUtf8Bytes("27AABCU9603R1ZM");
      
      await expect(identity.connect(msme).setData(key, value))
        .to.emit(identity, "DataChanged")
        .withArgs(key, value);
      
      expect(await identity.getData(key)).to.equal(ethers.hexlify(value));
    });

    it("Should allow approved operator to set data", async function () {
      const { identity, msme, operator } = await loadFixture(deployMSMEIdentityFixture);
      
      await identity.connect(msme).approveOperator(operator.address);
      
      const key = ethers.keccak256(ethers.toUtf8Bytes("revenue"));
      const value = ethers.toUtf8Bytes("10000000");
      
      await expect(identity.connect(operator).setData(key, value))
        .to.emit(identity, "DataChanged")
        .withArgs(key, value);
      
      expect(await identity.getData(key)).to.equal(ethers.hexlify(value));
    });

    it("Should not allow unauthorized address to set data", async function () {
      const { identity, other } = await loadFixture(deployMSMEIdentityFixture);
      
      const key = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const value = ethers.toUtf8Bytes("test-value");
      
      await expect(
        identity.connect(other).setData(key, value)
      ).to.be.revertedWith("Not authorized");
    });

    it("Should allow batch data setting", async function () {
      const { identity, msme } = await loadFixture(deployMSMEIdentityFixture);
      
      const keys = [
        ethers.keccak256(ethers.toUtf8Bytes("key1")),
        ethers.keccak256(ethers.toUtf8Bytes("key2")),
        ethers.keccak256(ethers.toUtf8Bytes("key3"))
      ];
      
      const values = [
        ethers.toUtf8Bytes("value1"),
        ethers.toUtf8Bytes("value2"),
        ethers.toUtf8Bytes("value3")
      ];
      
      await identity.connect(msme).setDataBatch(keys, values);
      
      for (let i = 0; i < keys.length; i++) {
        expect(await identity.getData(keys[i])).to.equal(ethers.hexlify(values[i]));
      }
    });

    it("Should revert batch setting with mismatched lengths", async function () {
      const { identity, msme } = await loadFixture(deployMSMEIdentityFixture);
      
      const keys = [ethers.keccak256(ethers.toUtf8Bytes("key1"))];
      const values = [
        ethers.toUtf8Bytes("value1"),
        ethers.toUtf8Bytes("value2")
      ];
      
      await expect(
        identity.connect(msme).setDataBatch(keys, values)
      ).to.be.revertedWith("Length mismatch");
    });

    it("Anyone should be able to read data", async function () {
      const { identity, msme, other } = await loadFixture(deployMSMEIdentityFixture);
      
      const key = ethers.keccak256(ethers.toUtf8Bytes("public-data"));
      const value = ethers.toUtf8Bytes("public-value");
      
      await identity.connect(msme).setData(key, value);
      
      expect(await identity.connect(other).getData(key)).to.equal(ethers.hexlify(value));
    });
  });
});
