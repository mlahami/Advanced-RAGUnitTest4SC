# rbac--sharfshiplo

- domain: access-control (access-control)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/SharfShiplo/solidity-advanced-kit @ aaf5aef121634780d1140d447cff5ca4f4b41d21
- license: MIT
- targets: RBAC.sol, Constants.sol, Errors.sol
- validation: 12 passing tests, 0 failing; statement coverage RBAC.sol 100.0 %, Constants.sol 100.0 %, Errors.sol 100.0 %

## Contract: Constants.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title Constants
 * @notice Centralized constant definitions
 */
library Constants {
    // Role definitions (using keccak256 for gas efficiency)
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant USER_ROLE = keccak256("USER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    // EIP-712 Domain Separator
    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant PERMISSION_TYPEHASH =
        keccak256("Permission(address account,bytes32 role,uint256 nonce,uint256 deadline)");

    // Time constants
    uint256 public constant ONE_DAY = 86400;
    uint256 public constant ONE_WEEK = 604800;
    uint256 public constant ONE_MONTH = 2592000;

    // Token constants
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1 billion tokens
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 10**18; // 100 million tokens
}
```

## Contract: Errors.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title Errors
 * @notice Custom error definitions for gas-efficient error handling
 * @dev Using custom errors saves gas compared to require strings
 */
library Errors {
    // RBAC Errors
    error UnauthorizedRole(bytes32 role);
    error RoleAlreadyGranted(address account, bytes32 role);
    error RoleNotGranted(address account, bytes32 role);
    error InvalidRoleHierarchy(bytes32 role, bytes32 parent);
    error InvalidSignature();
    error SignatureExpired();

    // ERC20 Errors
    error InsufficientBalance(address account, uint256 required, uint256 available);
    error InsufficientAllowance(address owner, address spender, uint256 required, uint256 available);
    error ZeroAddress();
    error ZeroAmount();
    error MintLimitExceeded(uint256 requested, uint256 limit);

    // Vault Errors
    error InsufficientVaultBalance(uint256 requested, uint256 available);
    error WithdrawalFailed();
    error InvalidUpgrade();

    // Merkle Airdrop Errors
    error InvalidProof();
    error AlreadyClaimed(address account);
    error InvalidMerkleRoot();
    error ClaimPeriodEnded();
    error ClaimPeriodNotStarted();
}
```

## Contract: RBAC.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {Errors} from "./Errors.sol";
import {Constants} from "./Constants.sol";

/**
 * @title RBAC
 * @notice Role-Based Access Control with hierarchical roles and EIP-712 signature support
 * @dev Implements hierarchical role system: ADMIN > MANAGER > USER
 *      Supports off-chain signature-based role granting for gas efficiency
 */
contract RBAC is Ownable, EIP712, Nonces {
    // Role hierarchy mapping: role => parent role
    mapping(bytes32 => bytes32) private _roleHierarchy;

    // Role members: role => account => hasRole
    mapping(bytes32 => mapping(address => bool)) private _hasRole;

    // Role admin: role => admin role (who can grant this role)
    mapping(bytes32 => bytes32) private _roleAdmin;

    // Events
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleHierarchySet(bytes32 indexed role, bytes32 indexed parent);

    /**
     * @notice Constructor sets up EIP-712 domain and initial role hierarchy
     */
    constructor() Ownable(msg.sender) EIP712("RBAC", "1") {
        // Set up role hierarchy: ADMIN > MANAGER > USER
        _roleHierarchy[Constants.MANAGER_ROLE] = Constants.ADMIN_ROLE;
        _roleHierarchy[Constants.USER_ROLE] = Constants.MANAGER_ROLE;

        // Set role admins
        _roleAdmin[Constants.ADMIN_ROLE] = Constants.ADMIN_ROLE; // Self-administered
        _roleAdmin[Constants.MANAGER_ROLE] = Constants.ADMIN_ROLE;
        _roleAdmin[Constants.USER_ROLE] = Constants.MANAGER_ROLE;
        _roleAdmin[Constants.MINTER_ROLE] = Constants.ADMIN_ROLE;
        _roleAdmin[Constants.BURNER_ROLE] = Constants.ADMIN_ROLE;

        // Grant deployer admin role
        _grantRole(Constants.ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Check if an account has a specific role
     * @param role The role to check
     * @param account The account to check
     * @return Whether the account has the role (or a parent role)
     */
    function hasRole(bytes32 role, address account) public view returns (bool) {
        if (_hasRole[role][account]) {
            return true;
        }

        // Check parent roles recursively
        bytes32 parent = _roleHierarchy[role];
        while (parent != bytes32(0)) {
            if (_hasRole[parent][account]) {
                return true;
            }
            parent = _roleHierarchy[parent];
        }

        return false;
    }

    /**
     * @notice Grant a role to an account (requires appropriate admin role)
     * @param role The role to grant
     * @param account The account to grant the role to
     */
    function grantRole(bytes32 role, address account) public {
        _checkRole(_roleAdmin[role], msg.sender);
        _grantRole(role, account);
    }

    /**
     * @notice Revoke a role from an account (requires appropriate admin role)
     * @param role The role to revoke
     * @param account The account to revoke the role from
     */
    function revokeRole(bytes32 role, address account) public {
        _checkRole(_roleAdmin[role], msg.sender);
        _revokeRole(role, account);
    }

    /**
     * @notice Grant a role using an EIP-712 signed permission
     * @param account The account to grant the role to
     * @param role The role to grant
     * @param deadline The deadline for the signature
     * @param v The recovery byte of the signature
     * @param r The r component of the signature
     * @param s The s component of the signature
     */
    function grantRoleWithSignature(
        address account,
        bytes32 role,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        if (block.timestamp > deadline) {
            revert Errors.SignatureExpired();
        }

        bytes32 structHash = keccak256(
            abi.encode(Constants.PERMISSION_TYPEHASH, account, role, _useNonce(account), deadline)
        );
        bytes32 hash = _hashTypedDataV4(structHash);

        address signer = ECDSA.recover(hash, v, r, s);
        _checkRole(_roleAdmin[role], signer);

        _grantRole(role, account);
    }

    /**
     * @notice Batch grant roles to multiple accounts
     * @param role The role to grant
     * @param accounts Array of accounts to grant the role to
     */
    function grantRoleBatch(bytes32 role, address[] calldata accounts) public {
        _checkRole(_roleAdmin[role], msg.sender);
        uint256 length = accounts.length;
        for (uint256 i = 0; i < length; ) {
            _grantRole(role, accounts[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Set role hierarchy (only owner)
     * @param role The role to set hierarchy for
     * @param parent The parent role
     */
    function setRoleHierarchy(bytes32 role, bytes32 parent) public onlyOwner {
        // Validate that parent exists or is zero
        if (parent != bytes32(0) && _roleAdmin[parent] == bytes32(0)) {
            revert Errors.InvalidRoleHierarchy(role, parent);
        }
        _roleHierarchy[role] = parent;
        emit RoleHierarchySet(role, parent);
    }

    /**
     * @notice Internal function to grant a role
     */
    function _grantRole(bytes32 role, address account) internal {
        if (_hasRole[role][account]) {
            revert Errors.RoleAlreadyGranted(account, role);
        }
        _hasRole[role][account] = true;
        emit RoleGranted(role, account, msg.sender);
    }

    /**
     * @notice Internal function to revoke a role
     */
    function _revokeRole(bytes32 role, address account) internal {
        if (!_hasRole[role][account]) {
            revert Errors.RoleNotGranted(account, role);
        }
        _hasRole[role][account] = false;
        emit RoleRevoked(role, account, msg.sender);
    }

    /**
     * @notice Check if account has role, revert if not
     */
    function _checkRole(bytes32 role, address account) internal view {
        if (!hasRole(role, account)) {
            revert Errors.UnauthorizedRole(role);
        }
    }
}
```

## Tests: rbac.test.js

```javascript
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
```
