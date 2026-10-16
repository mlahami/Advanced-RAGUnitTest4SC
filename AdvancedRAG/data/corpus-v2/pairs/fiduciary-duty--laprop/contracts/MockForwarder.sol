// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockForwarder {
    function isTrustedForwarder(address) external pure returns (bool) {
        return true;
    }
} 