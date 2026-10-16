// SPDX-License-Identifier: Apache-2.0 license
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract TestToken is ERC20, Ownable {
    constructor(
        uint256 _initialSupply,
        address _owner
    ) ERC20("TestToken", "TT") Ownable(_owner) {
        _mint(msg.sender, _initialSupply);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
