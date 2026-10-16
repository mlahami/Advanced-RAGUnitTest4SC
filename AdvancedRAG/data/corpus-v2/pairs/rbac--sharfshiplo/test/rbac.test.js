const { expect } = require("chai");
const { ethers } = require("hardhat");

// Constants matching contracts/utils/Constants.sol
const Constants = {
  ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")),
  MANAGER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("MANAGER_ROLE")),
  USER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("USER_ROLE")),
  MINTER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")),
  BURNER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE")),
};

describe("RBAC", function () {
  let rbac;
  let owner, admin, manager, user;
  let signer;

  beforeEach(async function () {
    [owner, admin, manager, user, signer] = await ethers.getSigners();

    const RBAC = await ethers.getContractFactory("RBAC");
    rbac = await RBAC.deploy();
    await rbac.waitForDeployment();

    // Grant roles for testing
    await rbac.grantRole(Constants.ADMIN_ROLE, admin.address);
    await rbac.grantRole(Constants.MANAGER_ROLE, manager.address);
    await rbac.grantRole(Constants.USER_ROLE, user.address);
  });

  describe("Role Hierarchy", function () {
    it("Should grant ADMIN role to deployer", async function () {
      expect(await rbac.hasRole(Constants.ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should check role hierarchy: ADMIN > MANAGER > USER", async function () {
      // ADMIN should have all roles
      expect(await rbac.hasRole(Constants.ADMIN_ROLE, admin.address)).to.be.true;
      expect(await rbac.hasRole(Constants.MANAGER_ROLE, admin.address)).to.be.true; // Through hierarchy
      expect(await rbac.hasRole(Constants.USER_ROLE, admin.address)).to.be.true; // Through hierarchy

      // MANAGER should have MANAGER and USER
      expect(await rbac.hasRole(Constants.MANAGER_ROLE, manager.address)).to.be.true;
      expect(await rbac.hasRole(Constants.USER_ROLE, manager.address)).to.be.true; // Through hierarchy
      expect(await rbac.hasRole(Constants.ADMIN_ROLE, manager.address)).to.be.false;

      // USER should only have USER
      expect(await rbac.hasRole(Constants.USER_ROLE, user.address)).to.be.true;
      expect(await rbac.hasRole(Constants.MANAGER_ROLE, user.address)).to.be.false;
      expect(await rbac.hasRole(Constants.ADMIN_ROLE, user.address)).to.be.false;
    });
  });

  describe("Role Granting", function () {
    it("Should allow ADMIN to grant MANAGER role", async function () {
      const newManager = (await ethers.getSigners())[5];
      await rbac.connect(admin).grantRole(Constants.MANAGER_ROLE, newManager.address);
      expect(await rbac.hasRole(Constants.MANAGER_ROLE, newManager.address)).to.be.true;
    });

    it("Should allow MANAGER to grant USER role", async function () {
      const newUser = (await ethers.getSigners())[6];
      await rbac.connect(manager).grantRole(Constants.USER_ROLE, newUser.address);
      expect(await rbac.hasRole(Constants.USER_ROLE, newUser.address)).to.be.true;
    });

    it("Should revert if non-admin tries to grant ADMIN role", async function () {
      const newAdmin = (await ethers.getSigners())[7];
      await expect(
        rbac.connect(manager).grantRole(Constants.ADMIN_ROLE, newAdmin.address)
      ).to.be.revertedWithCustomError(rbac, "UnauthorizedRole");
    });

    it("Should revert if role already granted", async function () {
      await expect(
        rbac.connect(admin).grantRole(Constants.MANAGER_ROLE, manager.address)
      ).to.be.revertedWithCustomError(rbac, "RoleAlreadyGranted");
    });
  });

  describe("Role Revocation", function () {
    it("Should allow ADMIN to revoke MANAGER role", async function () {
      await rbac.connect(admin).revokeRole(Constants.MANAGER_ROLE, manager.address);
      expect(await rbac.hasRole(Constants.MANAGER_ROLE, manager.address)).to.be.false;
    });

    it("Should revert if revoking non-existent role", async function () {
      const randomUser = (await ethers.getSigners())[8];
      await expect(
        rbac.connect(admin).revokeRole(Constants.MANAGER_ROLE, randomUser.address)
      ).to.be.revertedWithCustomError(rbac, "RoleNotGranted");
    });
  });

  describe("Batch Operations", function () {
    it("Should grant roles to multiple accounts", async function () {
      const accounts = (await ethers.getSigners()).slice(9, 12);
      const addresses = accounts.map((acc) => acc.address);

      await rbac.connect(admin).grantRoleBatch(Constants.MANAGER_ROLE, addresses);

      for (const account of accounts) {
        expect(await rbac.hasRole(Constants.MANAGER_ROLE, account.address)).to.be.true;
      }
    });
  });

  describe("EIP-712 Signature", function () {
    it("Should grant role with valid signature", async function () {
      const domain = {
        name: "RBAC",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await rbac.getAddress(),
      };

      const types = {
        Permission: [
          { name: "account", type: "address" },
          { name: "role", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const newUser = (await ethers.getSigners())[13];
      const nonce = await rbac.nonces(newUser.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      const value = {
        account: newUser.address,
        role: Constants.USER_ROLE,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await signer.signTypedData(domain, types, value);
      const sig = ethers.Signature.from(signature);

      // Grant signer the MANAGER role so they can grant USER role
      await rbac.connect(admin).grantRole(Constants.MANAGER_ROLE, signer.address);

      await rbac
        .connect(newUser)
        .grantRoleWithSignature(
          newUser.address,
          Constants.USER_ROLE,
          deadline,
          sig.v,
          sig.r,
          sig.s
        );

      expect(await rbac.hasRole(Constants.USER_ROLE, newUser.address)).to.be.true;
    });

    it("Should revert with expired signature", async function () {
      const domain = {
        name: "RBAC",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await rbac.getAddress(),
      };

      const types = {
        Permission: [
          { name: "account", type: "address" },
          { name: "role", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const newUser = (await ethers.getSigners())[14];
      const nonce = await rbac.nonces(newUser.address);
      const deadline = Math.floor(Date.now() / 1000) - 100; // Expired

      const value = {
        account: newUser.address,
        role: Constants.USER_ROLE,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await signer.signTypedData(domain, types, value);
      const sig = ethers.Signature.from(signature);

      await rbac.connect(admin).grantRole(Constants.MANAGER_ROLE, signer.address);

      await expect(
        rbac
          .connect(newUser)
          .grantRoleWithSignature(
            newUser.address,
            Constants.USER_ROLE,
            deadline,
            sig.v,
            sig.r,
            sig.s
          )
      ).to.be.revertedWithCustomError(rbac, "SignatureExpired");
    });
  });

  describe("Role Hierarchy Management", function () {
    it("Should allow owner to set role hierarchy", async function () {
      const newRole = ethers.keccak256(ethers.toUtf8Bytes("NEW_ROLE"));
      await rbac.connect(owner).setRoleHierarchy(newRole, Constants.MANAGER_ROLE);
      // Verify hierarchy was set (would need getter function to fully test)
    });
  });
});

