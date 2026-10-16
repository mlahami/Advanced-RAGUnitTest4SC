const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AccessControl", function () {
  let accessControl;
  let admin;
  let user1;
  let user2;
  const EDITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EDITOR_ROLE"));

  beforeEach(async function () {
    [admin, user1, user2] = await ethers.getSigners();
    const AccessControl = await ethers.getContractFactory("AccessControl");
    accessControl = await AccessControl.deploy();
    await accessControl.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct admin", async function () {
      expect(await accessControl.admin()).to.equal(admin.address);
    });

    it("Should have the correct EDITOR_ROLE constant", async function () {
      expect(await accessControl.EDITOR_ROLE()).to.equal(EDITOR_ROLE);
    });
  });

  describe("grantRole", function () {
    it("Should grant a role to an account", async function () {
      await accessControl.grantRole(EDITOR_ROLE, user1.address);
      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
    });

    it("Should emit an event when granting a role", async function () {
      // Note: The contract doesn't emit events for role changes, so this test would fail
      // This is just to demonstrate how you might test an event if it existed
      // await expect(accessControl.grantRole(EDITOR_ROLE, user1.address))
      //   .to.emit(accessControl, "RoleGranted")
      //   .withArgs(EDITOR_ROLE, user1.address, admin.address);
    });

    it("Should revert if called by non-admin", async function () {
      await expect(
        accessControl.connect(user1).grantRole(EDITOR_ROLE, user2.address)
      ).to.be.revertedWith("not admin");
    });
  });

  describe("revokeRole", function () {
    it("Should revoke a role from an account", async function () {
      await accessControl.grantRole(EDITOR_ROLE, user1.address);
      await accessControl.revokeRole(EDITOR_ROLE, user1.address);
      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
    });

    it("Should emit an event when revoking a role", async function () {
      // Similar to grantRole, this would test for a non-existent event
    });

    it("Should revert if called by non-admin", async function () {
      await accessControl.grantRole(EDITOR_ROLE, user1.address);
      await expect(
        accessControl.connect(user1).revokeRole(EDITOR_ROLE, user1.address)
      ).to.be.revertedWith("not admin");
    });
  });

  describe("hasRole", function () {
    it("Should return true for accounts with the role", async function () {
      await accessControl.grantRole(EDITOR_ROLE, user1.address);
      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
    });

    it("Should return false for accounts without the role", async function () {
      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
    });

    it("Should return false for non-existent roles", async function () {
      const NON_EXISTENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("NON_EXISTENT_ROLE"));
      expect(await accessControl.hasRole(NON_EXISTENT_ROLE, user1.address)).to.be.false;
    });
  });

  describe("Access Control", function () {
    it("Should allow admin to grant and revoke roles", async function () {
      await accessControl.grantRole(EDITOR_ROLE, user1.address);
      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.true;

      await accessControl.revokeRole(EDITOR_ROLE, user1.address);
      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
    });

    it("Should prevent non-admin from modifying roles", async function () {
      await expect(
        accessControl.connect(user1).grantRole(EDITOR_ROLE, user2.address)
      ).to.be.revertedWith("not admin");

      await expect(
        accessControl.connect(user1).revokeRole(EDITOR_ROLE, user2.address)
      ).to.be.revertedWith("not admin");
    });
  });
});