// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice A mock USDC token for testing and local development
 * @dev Mintable by owner, 6 decimals like real USDC
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private constant DECIMALS = 6;

    constructor() ERC20("USD Coin", "USDC") Ownable(msg.sender) {
        // Mint 1,000,000 USDC to deployer for testing
        _mint(msg.sender, 1_000_000 * 10 ** DECIMALS);
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /**
     * @notice Mint tokens to a specified address (owner only)
     * @param to Address to receive tokens
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Faucet function for testing - anyone can mint up to 10,000 USDC
     */
    function faucet() external {
        _mint(msg.sender, 10_000 * 10 ** DECIMALS);
    }
}
