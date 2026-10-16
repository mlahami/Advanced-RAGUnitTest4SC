// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IVault — Common interface for all vault implementations in this lab
interface IVault {
    /// @notice Deposit ETH into the vault
    function deposit() external payable;

    /// @notice Withdraw the caller's full balance from the vault
    function withdraw() external;

    /// @notice Return the ETH balance locked in the vault contract
    function getContractBalance() external view returns (uint256);

    /// @notice Return the recorded balance for a specific depositor
    function balances(address user) external view returns (uint256);

    // Events
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
}