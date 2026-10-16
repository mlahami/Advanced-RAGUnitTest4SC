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

