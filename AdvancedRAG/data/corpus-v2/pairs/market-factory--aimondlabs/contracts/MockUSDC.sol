// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Mock USDC
 * @notice Mock USDC token for testing purposes
 * @dev 6 decimals like real USDC
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private constant _DECIMALS = 6;
    
    constructor() ERC20("Mock USD Coin", "mUSDC") Ownable(msg.sender) {
        // Mint 1,000,000 USDC to deployer
        _mint(msg.sender, 1_000_000_000 * 10**_DECIMALS);
    }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Mint tokens to any address (for testing)
    /// @param to - Address to mint to
    /// @param amount - Amount to mint
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Mint tokens to any address (for testing) - anyone can call
    /// @param to - Address to mint to
    /// @param amount - Amount to mint
    function mintForTesting(address to, uint256 amount) external {
        _mint(to, amount);
    }
}