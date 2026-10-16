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

