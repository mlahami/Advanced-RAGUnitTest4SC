// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LeafToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("LeafToken", "LEAF") {
        _mint(msg.sender, initialSupply);
    }
}