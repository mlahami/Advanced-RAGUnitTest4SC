// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IVault.sol";

contract SecureVault is IVault, ReentrancyGuard {
    mapping(address => uint256) public override balances;

    function deposit() external payable override {
        require(msg.value > 0, "SecureVault: deposit must be > 0");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw() external override nonReentrant {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "SecureVault: nothing to withdraw");

        balances[msg.sender] = 0;

        // slither-disable-next-line low-level-calls
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "SecureVault: ETH transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    function getContractBalance() external view override returns (uint256) {
        return address(this).balance;
    }
}
