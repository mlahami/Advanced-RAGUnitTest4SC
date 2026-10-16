// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RewardToken - Simple mintable ERC20 for vault rewards
/// @notice Owner can grant/revoke minter role to vaults; vaults mint rewards to users
contract RewardToken is ERC20, Ownable {
    mapping(address => bool) public isMinter;

    event MinterUpdated(address indexed account, bool allowed);

    constructor(string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {}

    modifier onlyMinter() {
        require(isMinter[msg.sender] || msg.sender == owner(), "Not minter");
        _;
    }

    function setMinter(address account, bool allowed) external onlyOwner {
        isMinter[account] = allowed;
        emit MinterUpdated(account, allowed);
    }

    function mint(address to, uint256 amount) external onlyMinter {
        require(to != address(0), "mint to zero address");
        require(amount > 0, "mint zero amount");
        _mint(to, amount);
    }
}
