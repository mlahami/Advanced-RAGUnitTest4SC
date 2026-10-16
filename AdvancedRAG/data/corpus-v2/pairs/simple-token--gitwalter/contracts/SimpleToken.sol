// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleToken
 * @dev A basic ERC20 token for learning purposes
 * 
 * This is your first smart contract! It demonstrates:
 * - Inheriting from OpenZeppelin contracts
 * - Constructor with initial supply
 * - Basic minting functionality
 */
contract SimpleToken is ERC20, Ownable {
    
    /**
     * @dev Constructor that gives the deployer all initial tokens
     * @param name Token name (e.g., "My Token")
     * @param symbol Token symbol (e.g., "MTK")
     * @param initialSupply Initial token supply (in smallest units)
     */
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        // Mint initial supply to the deployer
        _mint(msg.sender, initialSupply);
    }

    /**
     * @dev Allows the owner to mint new tokens
     * @param to Address to receive the tokens
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
