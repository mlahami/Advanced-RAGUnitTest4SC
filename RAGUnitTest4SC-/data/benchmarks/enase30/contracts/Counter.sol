// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public count;
    address public immutable owner;

    constructor() { owner = msg.sender; }

    function increment() external { count += 1; }
    function decrement() external {
        require(count > 0, "underflow");
        count -= 1;
    }
    function reset() external {
        require(msg.sender == owner, "not owner");
        count = 0;
    }
}

