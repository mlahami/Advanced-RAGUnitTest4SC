// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IWealthVault
 * @notice W-Yield vault interface
 */
interface IWealthVault {
    event Deposit(address indexed user, uint256 usdcAmount, uint256 shares);
    event Withdraw(address indexed user, uint256 shares, uint256 usdcAmount);
    
    function deposit(uint256 amount) external returns (uint256 shares);
    function withdraw(uint256 shares) external returns (uint256 amount);
}
