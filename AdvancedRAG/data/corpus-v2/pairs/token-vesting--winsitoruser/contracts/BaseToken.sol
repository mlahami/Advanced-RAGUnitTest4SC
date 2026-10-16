// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BaseToken
 * @dev ERC20 Token deployed on Base Chain L2
 * Features:
 * - Burnable tokens
 * - ERC20Permit for gasless approvals
 * - Ownable for controlled minting
 */
contract BaseToken is ERC20, ERC20Burnable, ERC20Permit, Ownable {
    uint8 private _decimals;
    
    /**
     * @dev Constructor that gives msg.sender all of initial supply.
     * @param name Token name
     * @param symbol Token symbol
     * @param initialSupply Initial token supply (will be multiplied by 10^decimals)
     * @param decimals_ Token decimals
     */
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        uint8 decimals_
    ) ERC20(name, symbol) ERC20Permit(name) Ownable(msg.sender) {
        _decimals = decimals_;
        _mint(msg.sender, initialSupply * 10 ** decimals_);
    }

    /**
     * @dev Returns the number of decimals used for token amounts.
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Mint new tokens (only owner)
     * @param to Address to receive tokens
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Batch transfer tokens to multiple addresses
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to send
     */
    function batchTransfer(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) public returns (bool) {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        require(recipients.length > 0, "Empty arrays");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            transfer(recipients[i], amounts[i]);
        }
        
        return true;
    }
}
