# access-registry--adelmarcio0

- domain: access-control (access-control)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/adelmarcio0/ChronaLink @ 9d4dd56e2524bf44ff0a6bb58e330137da3ed104
- license: MIT
- targets: AccessRegistry.sol
- validation: 12 passing tests, 0 failing; statement coverage AccessRegistry.sol 100.0 %

## Contract: AccessRegistry.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AccessRegistry
 * @notice Manages role-based access control for the ChronaLink protocol
 * @dev Implements hierarchical role management for admin, executor, and owner roles
 * @author ChronaLink Team
 * @custom:security-contact adelmarcio0@gmail.com
 */
contract AccessRegistry is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant JOB_OWNER_ROLE = keccak256("JOB_OWNER_ROLE");

    event RoleGrantedExtended(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevokedExtended(bytes32 indexed role, address indexed account, address indexed sender);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    /**
     * @notice Grants executor role to an address
     * @param executor Address to grant executor role
     */
    function grantExecutorRole(address executor) external onlyRole(ADMIN_ROLE) {
        _grantRole(EXECUTOR_ROLE, executor);
        emit RoleGrantedExtended(EXECUTOR_ROLE, executor, msg.sender);
    }

    /**
     * @notice Revokes executor role from an address
     * @param executor Address to revoke executor role
     */
    function revokeExecutorRole(address executor) external onlyRole(ADMIN_ROLE) {
        _revokeRole(EXECUTOR_ROLE, executor);
        emit RoleRevokedExtended(EXECUTOR_ROLE, executor, msg.sender);
    }

    /**
     * @notice Grants job owner role to an address
     * @param owner Address to grant job owner role
     */
    function grantJobOwnerRole(address owner) external onlyRole(ADMIN_ROLE) {
        _grantRole(JOB_OWNER_ROLE, owner);
        emit RoleGrantedExtended(JOB_OWNER_ROLE, owner, msg.sender);
    }

    /**
     * @notice Revokes job owner role from an address
     * @param owner Address to revoke job owner role
     */
    function revokeJobOwnerRole(address owner) external onlyRole(ADMIN_ROLE) {
        _revokeRole(JOB_OWNER_ROLE, owner);
        emit RoleRevokedExtended(JOB_OWNER_ROLE, owner, msg.sender);
    }

    /**
     * @notice Checks if an address has executor role
     * @param account Address to check
     * @return bool True if address has executor role
     */
    function isExecutor(address account) external view returns (bool) {
        return hasRole(EXECUTOR_ROLE, account);
    }

    /**
     * @notice Checks if an address has job owner role
     * @param account Address to check
     * @return bool True if address has job owner role
     */
    function isJobOwner(address account) external view returns (bool) {
        return hasRole(JOB_OWNER_ROLE, account);
    }

    /**
     * @notice Checks if an address has admin role
     * @param account Address to check
     * @return bool True if address has admin role
     */
    function isAdmin(address account) external view returns (bool) {
        return hasRole(ADMIN_ROLE, account);
    }
}
```

## Tests: AccessRegistry.test.js

```javascript
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
```
