
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Roles
 * @dev Library containing role constants and utility functions for AVGX protocol
 */
library Roles {
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant BPS = 10_000;
    uint256 public constant ONE = 1e18;
    
    // Default parameters
    uint256 public constant DEFAULT_MAX_AGE = 1 hours;
    uint256 public constant DEFAULT_FEE_BPS = 30; // 0.30%
    uint256 public constant DEFAULT_SPREAD_BPS = 10; // 0.10%

    /**
     * @dev Validates that basis points don't exceed 10,000
     * @param bps Basis points to validate
     */
    function validateBPS(uint256 bps) internal pure {
        require(bps <= BPS, "Roles: Invalid BPS");
    }

    /**
     * @dev Validates that an address is not zero
     * @param addr Address to validate
     */
    function validateAddress(address addr) internal pure {
        require(addr != address(0), "Roles: Zero address");
    }
}
