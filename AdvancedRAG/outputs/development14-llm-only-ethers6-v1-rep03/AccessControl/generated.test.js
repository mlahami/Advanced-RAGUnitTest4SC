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
    accessControl = await AccessControl.connect(admin).deploy();
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

  describe("Role Management", function () {
    describe("grantRole", function () {
      it("Should allow admin to grant role", async function () {
        await expect(accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address))
          .to.emit(accessControl, "RoleGranted")
          .withArgs(EDITOR_ROLE, user1.address, admin.address);

        expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
      });

      it("Should revert when non-admin tries to grant role", async function () {
        await expect(accessControl.connect(user1).grantRole(EDITOR_ROLE, user2.address))
          .to.be.revertedWith("not admin");
      });

      it("Should allow granting role to the same account multiple times", async function () {
        await accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address);
        await expect(accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address))
          .to.emit(accessControl, "RoleGranted")
          .withArgs(EDITOR_ROLE, user1.address, admin.address);

        expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
      });
    });

    describe("revokeRole", function () {
      it("Should allow admin to revoke role", async function () {
        await accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address);
        await expect(accessControl.connect(admin).revokeRole(EDITOR_ROLE, user1.address))
          .to.emit(accessControl, "RoleRevoked")
          .withArgs(EDITOR_ROLE, user1.address, admin.address);

        expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
      });

      it("Should revert when non-admin tries to revoke role", async function () {
        await accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address);
        await expect(accessControl.connect(user1).revokeRole(EDITOR_ROLE, user1.address))
          .to.be.revertedWith("not admin");
      });

      it("Should allow revoking role from an account that doesn't have it", async function () {
        await expect(accessControl.connect(admin).revokeRole(EDITOR_ROLE, user1.address))
          .to.emit(accessControl, "RoleRevoked")
          .withArgs(EDITOR_ROLE, user1.address, admin.address);

        expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
      });
    });

    describe("hasRole", function () {
      it("Should return true for accounts with the role", async function () {
        await accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address);
        expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
      });

      it("Should return false for accounts without the role", async function () {
        expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
      });

      it("Should return false for the zero address", async function () {
        expect(await accessControl.hasRole(EDITOR_ROLE, ethers.ZeroAddress)).to.be.false;
      });
    });
  });

  describe("Role Management with Different Roles", function () {
    const TEST_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TEST_ROLE"));

    it("Should handle different roles independently", async function () {
      await accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address);
      await accessControl.connect(admin).grantRole(TEST_ROLE, user2.address);

      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
      expect(await accessControl.hasRole(TEST_ROLE, user2.address)).to.be.true;
      expect(await accessControl.hasRole(EDITOR_ROLE, user2.address)).to.be.false;
      expect(await accessControl.hasRole(TEST_ROLE, user1.address)).to.be.false;
    });

    it("Should allow revoking one role without affecting others", async function () {
      await accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address);
      await accessControl.connect(admin).grantRole(TEST_ROLE, user1.address);

      await accessControl.connect(admin).revokeRole(EDITOR_ROLE, user1.address);

      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
      expect(await accessControl.hasRole(TEST_ROLE, user1.address)).to.be.true;
    });
  });
});