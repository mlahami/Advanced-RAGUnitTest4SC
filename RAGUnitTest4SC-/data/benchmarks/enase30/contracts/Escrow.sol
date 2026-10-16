// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Escrow {
    address payable public immutable seller;
    address public immutable buyer;
    address public immutable arbiter;
    bool public funded;
    bool public closed;

    constructor(address payable _seller, address _arbiter) {
        buyer = msg.sender;
        seller = _seller;
        arbiter = _arbiter;
    }

    function fund() external payable {
        require(msg.sender == buyer, "only buyer");
        require(!funded && msg.value > 0, "invalid funding");
        funded = true;
    }

    function release() external {
        require(msg.sender == buyer || msg.sender == arbiter, "not authorized");
        require(funded && !closed, "not releasable");
        closed = true;
        seller.transfer(address(this).balance);
    }

    function refund() external {
        require(msg.sender == seller || msg.sender == arbiter, "not authorized");
        require(funded && !closed, "not refundable");
        closed = true;
        payable(buyer).transfer(address(this).balance);
    }
}

