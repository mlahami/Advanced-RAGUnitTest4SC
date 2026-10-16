const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AccessControl", function () {
  let accessControl;
  let admin, user1, user2;
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
  });

  describe("Role Management", function () {
    it("Should allow admin to grant role", async function () {
      await accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address);
      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
    });

    it("Should allow admin to revoke role", async function () {
      await accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address);
      await accessControl.connect(admin).revokeRole(EDITOR_ROLE, user1.address);
      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
    });

    it("Should not allow non-admin to grant role", async function () {
      await expect(
        accessControl.connect(user1).grantRole(EDITOR_ROLE, user2.address)
      ).to.be.revertedWith("not admin");
    });

    it("Should not allow non-admin to revoke role", async function () {
      await accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address);
      await expect(
        accessControl.connect(user1).revokeRole(EDITOR_ROLE, user1.address)
      ).to.be.revertedWith("not admin");
    });

    it("Should correctly check role assignment", async function () {
      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.false;
      await accessControl.connect(admin).grantRole(EDITOR_ROLE, user1.address);
      expect(await accessControl.hasRole(EDITOR_ROLE, user1.address)).to.be.true;
    });
  });
});