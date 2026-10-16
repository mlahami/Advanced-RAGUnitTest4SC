// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SimpleStorage {
    uint256 private storedData;

    function set(uint256 value) external {
        storedData = value;
    }

    function get() external view returns (uint256) {
        return storedData;
    }
}

