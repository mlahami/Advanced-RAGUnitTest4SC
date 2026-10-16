// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TimelockVault {
    address payable public immutable owner;
    uint256 public immutable unlockTime;

    constructor(uint256 delaySeconds) payable {
        owner = payable(msg.sender);
        unlockTime = block.timestamp + delaySeconds;
    }

    receive() external payable {}

    function withdraw() external {
        require(msg.sender == owner, "not owner");
        require(block.timestamp >= unlockTime, "locked");
        owner.transfer(address(this).balance);
    }
}

