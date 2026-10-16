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

    it("Should have EDITOR_ROLE constant", async function () {
      expect(await contract.EDITOR_ROLE()).to.equal(EDITOR_ROLE);
    });
  });

  describe("Role Management", function () {
    it("Should allow admin to grant roles", async function () {
      await expect(contract.grantRole(EDITOR_ROLE, user1.address))
        .to.emit(contract, "RoleGranted")
        .withArgs(EDITOR_ROLE, user1.address);

      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
    });

    it("Should allow admin to revoke roles", async function () {
      await contract.grantRole(EDITOR_ROLE, user1.address);
      await expect(contract.revokeRole(EDITOR_ROLE, user1.address))
        .to.emit(contract, "RoleRevoked")
        .withArgs(EDITOR_ROLE, user1.address);

      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
    });

    it("Should not allow non-admin to grant roles", async function () {
      await expect(contract.connect(user1).grantRole(EDITOR_ROLE, user2.address))
        .to.be.revertedWith("not admin");
    });

    it("Should not allow non-admin to revoke roles", async function () {
      await contract.grantRole(EDITOR_ROLE, user1.address);
      await expect(contract.connect(user1).revokeRole(EDITOR_ROLE, user1.address))
        .to.be.revertedWith("not admin");
    });

    it("Should correctly check role assignments", async function () {
      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.false;

      await contract.grantRole(EDITOR_ROLE, user1.address);
      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.true;

      await contract.revokeRole(EDITOR_ROLE, user1.address);
      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle role revocation for non-existent roles", async function () {
      await expect(contract.revokeRole(EDITOR_ROLE, user1.address))
        .to.not.emit(contract, "RoleRevoked");

      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
    });

    it("Should allow granting the same role multiple times", async function () {
      await contract.grantRole(EDITOR_ROLE, user1.address);
      await contract.grantRole(EDITOR_ROLE, user1.address);

      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
    });

    it("Should allow revoking the same role multiple times", async function () {
      await contract.grantRole(EDITOR_ROLE, user1.address);
      await contract.revokeRole(EDITOR_ROLE, user1.address);
      await contract.revokeRole(EDITOR_ROLE, user1.address);

      expect(await contract.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
    });
  });
});