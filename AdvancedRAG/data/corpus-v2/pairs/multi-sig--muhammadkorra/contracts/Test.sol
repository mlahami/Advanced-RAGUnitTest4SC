// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract Test {
    int256 public counter;

    constructor() {
        counter = 0;
    }

    function increment() external returns(int256 newValue) {
        counter += 1;
        return counter;
    }

    function decrement() external returns(int256 newValue) {
        counter -= 1;
        return counter;
    }
}
