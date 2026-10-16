// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Crowdfunding {
    address payable public immutable creator;
    uint256 public immutable goal;
    uint256 public immutable deadline;
    uint256 public totalRaised;
    mapping(address => uint256) public contributions;

    constructor(uint256 _goal, uint256 durationSeconds) {
        creator = payable(msg.sender);
        goal = _goal;
        deadline = block.timestamp + durationSeconds;
    }

    function contribute() external payable {
        require(block.timestamp < deadline, "campaign ended");
        require(msg.value > 0, "zero contribution");
        contributions[msg.sender] += msg.value;
        totalRaised += msg.value;
    }

    function withdraw() external {
        require(msg.sender == creator, "not creator");
        require(block.timestamp >= deadline, "too early");
        require(totalRaised >= goal, "goal not met");
        creator.transfer(address(this).balance);
    }

    function refund() external {
        require(block.timestamp >= deadline, "too early");
        require(totalRaised < goal, "goal met");
        uint256 amount = contributions[msg.sender];
        require(amount > 0, "nothing to refund");
        contributions[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
    }
}

