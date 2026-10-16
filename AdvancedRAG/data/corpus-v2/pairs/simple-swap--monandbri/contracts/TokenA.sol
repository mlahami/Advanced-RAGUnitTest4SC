// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TokenA - Simple ERC20 token with minting functionality
contract TokenA is ERC20 {
    
     /// @notice Constructor mints initial supply to deployer
    constructor() ERC20("TokenA", "TKA") {
        _mint(msg.sender, 100000);
    }

    /// @notice Mint new tokens to specified address
    /// @param to Address to receive minted tokens
    /// @param amount Amount of tokens to mint
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
}