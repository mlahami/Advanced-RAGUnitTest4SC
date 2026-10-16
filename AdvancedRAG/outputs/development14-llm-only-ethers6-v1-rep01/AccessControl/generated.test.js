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

      it("Should revert when granting role to zero address", async function () {
        await expect(accessControl.connect(admin).grantRole(EDITOR_ROLE, ethers.ZeroAddress))
          .to.be.reverted;
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

      it("Should revert when revoking role from zero address", async function () {
        await expect(accessControl.connect(admin).revokeRole(EDITOR_ROLE, ethers.ZeroAddress))
          .to.be.reverted;
      });
    });

    describe("hasRole", function () {
      it("Should return true for granted role", async function () {
        await accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address);
        expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
      });

      it("Should return false for ungranted role", async function () {
        expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
      });

      it("Should return false for zero address", async function () {
        expect(await accessControl.hasRole(EDITOR_ROLE, ethers.ZeroAddress)).to.be.false;
      });
    });
  });

  describe("Access Control", function () {
    it("Should allow admin to perform admin-only operations", async function () {
      await expect(accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address))
        .to.not.be.reverted;
    });

    it("Should prevent non-admin from performing admin-only operations", async function () {
      await expect(accessControl.connect(user1).grantRole(EDITOR_ROLE, user2.address))
        .to.be.revertedWith("not admin");
    });
  });
});