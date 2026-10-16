const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AccessRegistry", function () {
  let accessRegistry;
  let admin, executor, jobOwner, other;

  beforeEach(async function () {
    [admin, executor, jobOwner, other] = await ethers.getSigners();

    const AccessRegistry = await ethers.getContractFactory("AccessRegistry");
    accessRegistry = await AccessRegistry.deploy(admin.address);
    await accessRegistry.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct admin", async function () {
      expect(await accessRegistry.isAdmin(admin.address)).to.be.true;
    });

    it("Should grant DEFAULT_ADMIN_ROLE to admin", async function () {
      const DEFAULT_ADMIN_ROLE = await accessRegistry.DEFAULT_ADMIN_ROLE();
      expect(await accessRegistry.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });
  });

  describe("Executor Role Management", function () {
    it("Should grant executor role", async function () {
      await accessRegistry.connect(admin).grantExecutorRole(executor.address);
      expect(await accessRegistry.isExecutor(executor.address)).to.be.true;
    });

    it("Should revoke executor role", async function () {
      await accessRegistry.connect(admin).grantExecutorRole(executor.address);
      await accessRegistry.connect(admin).revokeExecutorRole(executor.address);
      expect(await accessRegistry.isExecutor(executor.address)).to.be.false;
    });

    it("Should emit RoleGrantedExtended event", async function () {
      await expect(accessRegistry.connect(admin).grantExecutorRole(executor.address))
        .to.emit(accessRegistry, "RoleGrantedExtended");
    });

    it("Should fail if non-admin tries to grant executor role", async function () {
      await expect(
        accessRegistry.connect(other).grantExecutorRole(executor.address)
      ).to.be.reverted;
    });
  });

  describe("Job Owner Role Management", function () {
    it("Should grant job owner role", async function () {
      await accessRegistry.connect(admin).grantJobOwnerRole(jobOwner.address);
      expect(await accessRegistry.isJobOwner(jobOwner.address)).to.be.true;
    });

    it("Should revoke job owner role", async function () {
      await accessRegistry.connect(admin).grantJobOwnerRole(jobOwner.address);
      await accessRegistry.connect(admin).revokeJobOwnerRole(jobOwner.address);
      expect(await accessRegistry.isJobOwner(jobOwner.address)).to.be.false;
    });

    it("Should emit RoleGrantedExtended event", async function () {
      await expect(accessRegistry.connect(admin).grantJobOwnerRole(jobOwner.address))
        .to.emit(accessRegistry, "RoleGrantedExtended");
    });
  });

  describe("Role Queries", function () {
    beforeEach(async function () {
      await accessRegistry.connect(admin).grantExecutorRole(executor.address);
      await accessRegistry.connect(admin).grantJobOwnerRole(jobOwner.address);
    });

    it("Should correctly identify admin", async function () {
      expect(await accessRegistry.isAdmin(admin.address)).to.be.true;
      expect(await accessRegistry.isAdmin(other.address)).to.be.false;
    });

    it("Should correctly identify executor", async function () {
      expect(await accessRegistry.isExecutor(executor.address)).to.be.true;
      expect(await accessRegistry.isExecutor(other.address)).to.be.false;
    });

    it("Should correctly identify job owner", async function () {
      expect(await accessRegistry.isJobOwner(jobOwner.address)).to.be.true;
      expect(await accessRegistry.isJobOwner(other.address)).to.be.false;
    });
  });
});

