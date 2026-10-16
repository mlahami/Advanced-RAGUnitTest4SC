// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library ConvertLib {
    function convert(uint256 amount, uint256 rate) internal pure returns (uint256) {
        return amount * rate;
    }
}

contract MetaCoin {
    mapping(address => uint256) private balances;
    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor() {
        balances[msg.sender] = 10000;
    }

    function sendCoin(address receiver, uint256 amount) external returns (bool) {
        if (balances[msg.sender] < amount) return false;
        balances[msg.sender] -= amount;
        balances[receiver] += amount;
        emit Transfer(msg.sender, receiver, amount);
        return true;
    }

    function getBalance(address account) external view returns (uint256) {
        return balances[account];
    }

    function getBalanceInEth(address account) external view returns (uint256) {
        return ConvertLib.convert(balances[account], 2);
    }
}

