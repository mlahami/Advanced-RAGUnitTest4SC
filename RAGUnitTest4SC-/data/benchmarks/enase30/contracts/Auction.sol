// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Auction {
    address payable public immutable seller;
    uint256 public immutable endTime;
    address public highestBidder;
    uint256 public highestBid;
    mapping(address => uint256) public refunds;
    bool public ended;

    constructor(uint256 durationSeconds) {
        seller = payable(msg.sender);
        endTime = block.timestamp + durationSeconds;
    }

    function bid() external payable {
        require(block.timestamp < endTime, "auction ended");
        require(msg.value > highestBid, "bid too low");
        if (highestBidder != address(0)) refunds[highestBidder] += highestBid;
        highestBidder = msg.sender;
        highestBid = msg.value;
    }

    function withdrawRefund() external {
        uint256 amount = refunds[msg.sender];
        require(amount > 0, "no refund");
        refunds[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
    }

    function finalize() external {
        require(block.timestamp >= endTime, "too early");
        require(!ended, "already ended");
        ended = true;
        seller.transfer(highestBid);
    }
}

