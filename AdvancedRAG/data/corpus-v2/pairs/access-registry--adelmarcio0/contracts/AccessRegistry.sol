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

