// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Test/lab ERC-20. Owner can mint. Not a mainnet token.
contract StakeToken is ERC20, Ownable {
    constructor() ERC20("Stake Token", "STK") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
