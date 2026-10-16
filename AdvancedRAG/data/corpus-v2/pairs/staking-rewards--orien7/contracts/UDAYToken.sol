// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title UDAYToken — ERC-20 with capped supply
/// @author Uday Kumar BS
/// @notice Portfolio demonstration token for staking integration
contract UDAYToken is ERC20, ERC20Burnable, Ownable2Step {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 18; // 1M tokens

    event TokensMinted(address indexed to, uint256 amount);

    error ExceedsMaxSupply(uint256 requested, uint256 available);

    constructor(address initialOwner)
        ERC20("UDAY Token", "UDAY")
        Ownable(initialOwner)
    {
        // Mint 500k to deployer; reserve 500k for staking rewards
        _mint(initialOwner, 500_000 * 10 ** 18);
    }

    /// @notice Owner mints additional tokens up to MAX_SUPPLY
    function mint(address to, uint256 amount) external onlyOwner {
        uint256 available = MAX_SUPPLY - totalSupply();
        if (amount > available) revert ExceedsMaxSupply(amount, available);
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }
}
