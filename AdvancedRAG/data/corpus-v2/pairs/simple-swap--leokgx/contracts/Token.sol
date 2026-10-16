// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Token is ERC20 {
    constructor(string memory name, string memory symbol, address recipient) ERC20(name, symbol) {
        _mint(recipient, 100000 * 10 ** decimals());
    }
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}