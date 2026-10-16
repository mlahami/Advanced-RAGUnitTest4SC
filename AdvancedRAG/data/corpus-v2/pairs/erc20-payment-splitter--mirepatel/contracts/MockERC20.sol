// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC20
 * @dev A simple ERC20 Token for testing purposes
 */
contract MockERC20 is ERC20, Ownable {
    constructor(
        string memory name,
        string memory symbol,
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {}

    /**
     * @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     */
    function mint(address account, uint256 amount) external onlyOwner {
        _mint(account, amount);
    }
}
