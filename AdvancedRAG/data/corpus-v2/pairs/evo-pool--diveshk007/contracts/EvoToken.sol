// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EvoToken
 * @notice Minimal ERC-20 for protocol coordination and testing.
 *         Used as one of the pair tokens in the demo EvoPool.
 */
contract EvoToken is ERC20, Ownable {
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        _mint(owner_, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
