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

