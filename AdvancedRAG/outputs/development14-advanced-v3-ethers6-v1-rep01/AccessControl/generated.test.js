const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AccessControl", function () {
  let contract;
  let owner, user1, user2;
  const EDITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EDITOR_ROLE"));

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const ContractFactory = await ethers.getContractFactory("AccessControl");
    contract = await ContractFactory.deploy();
    await contract.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct admin", async function () {
      expect(await contract.admin()).to.equal(owner.address);
    });

    it("Should initialize with no roles", async function () {
      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
    });
  });

  describe("Role Management", function () {
    it("Should allow admin to grant role", async function () {
      await expect(contract.grantRole(EDITOR_ROLE, user1.address))
        .to.emit(contract, "RoleGranted")
        .withArgs(EDITOR_ROLE, user1.address);

      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
    });

    it("Should allow admin to revoke role", async function () {
      await contract.grantRole(EDITOR_ROLE, user1.address);
      await expect(contract.revokeRole(EDITOR_ROLE, user1.address))
        .to.emit(contract, "RoleRevoked")
        .withArgs(EDITOR_ROLE, user1.address);

      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
    });

    it("Should not allow non-admin to grant role", async function () {
      await expect(contract.connect(user1).grantRole(EDITOR_ROLE, user2.address))
        .to.be.revertedWith("not admin");
    });

    it("Should not allow non-admin to revoke role", async function () {
      await contract.grantRole(EDITOR_ROLE, user1.address);
      await expect(contract.connect(user1).revokeRole(EDITOR_ROLE, user1.address))
        .to.be.revertedWith("not admin");
    });

    it("Should correctly check role assignment", async function () {
      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.false;

      await contract.grantRole(EDITOR_ROLE, user1.address);
      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.true;

      await contract.revokeRole(EDITOR_ROLE, user1.address);
      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle role revocation for non-existent role", async function () {
      await expect(contract.revokeRole(EDITOR_ROLE, user1.address))
        .to.not.emit(contract, "RoleRevoked");
    });

    it("Should handle role granting for existing role", async function () {
      await contract.grantRole(EDITOR_ROLE, user1.address);
      await expect(contract.grantRole(EDITOR_ROLE, user1.address))
        .to.not.emit(contract, "RoleGranted");
    });

    it("Should not allow granting role to zero address", async function () {
      await expect(contract.grantRole(EDITOR_ROLE, ethers.ZeroAddress))
        .to.not.be.reverted;
      expect(await contract.hasRole(EDITOR_ROLE, ethers.ZeroAddress)).to.be.true;
    });

    it("Should not allow revoking role from zero address", async function () {
      await expect(contract.revokeRole(EDITOR_ROLE, ethers.ZeroAddress))
        .to.not.be.reverted;
      expect(await contract.hasRole(EDITOR_ROLE, ethers.ZeroAddress)).to.be.false;
    });
  });
});