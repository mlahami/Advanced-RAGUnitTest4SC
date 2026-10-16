// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Vault
/// @notice A minimal, secure ETH vault. Each address can deposit ETH into the
///         vault and later withdraw up to the amount it has deposited. Balances
///         are tracked per-address; users can never touch another user's funds.
/// @dev Demonstrates the checks-effects-interactions pattern together with
///      OpenZeppelin's ReentrancyGuard. This is a local/testnet portfolio demo,
///      not audited production code.
contract Vault is ReentrancyGuard {
    /// @notice ETH balance held in the vault for each account (in wei).
    mapping(address => uint256) private _balances;

    /// @notice Total ETH held by the vault across all accounts (in wei).
    uint256 public totalDeposited;

    /// @notice Emitted when `account` deposits `amount` wei into the vault.
    event Deposit(address indexed account, uint256 amount, uint256 newBalance);

    /// @notice Emitted when `account` withdraws `amount` wei from the vault.
    event Withdraw(address indexed account, uint256 amount, uint256 newBalance);

    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);
    error TransferFailed();

    /// @notice Deposit ETH into the caller's vault balance.
    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();

        // Effects
        _balances[msg.sender] += msg.value;
        totalDeposited += msg.value;

        emit Deposit(msg.sender, msg.value, _balances[msg.sender]);
    }

    /// @notice Withdraw `amount` wei from the caller's vault balance.
    /// @param amount The amount of wei to withdraw. Must be > 0 and <= balance.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 balance = _balances[msg.sender];
        if (amount > balance) revert InsufficientBalance(amount, balance);

        // Effects (state updated before the external call)
        uint256 newBalance = balance - amount;
        _balances[msg.sender] = newBalance;
        totalDeposited -= amount;

        emit Withdraw(msg.sender, amount, newBalance);

        // Interaction (last)
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Withdraw the caller's entire vault balance.
    function withdrawAll() external nonReentrant {
        uint256 balance = _balances[msg.sender];
        if (balance == 0) revert ZeroAmount();

        // Effects
        _balances[msg.sender] = 0;
        totalDeposited -= balance;

        emit Withdraw(msg.sender, balance, 0);

        // Interaction
        (bool ok, ) = payable(msg.sender).call{value: balance}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Return the vault balance for `account`.
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /// @notice Convenience accessor for the caller's own balance.
    function myBalance() external view returns (uint256) {
        return _balances[msg.sender];
    }
}
