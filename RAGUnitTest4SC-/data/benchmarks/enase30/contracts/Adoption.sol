// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Adoption {
    address[16] public adopters;

    function adopt(uint256 petId) external returns (uint256) {
        require(petId < 16, "invalid pet");
        adopters[petId] = msg.sender;
        return petId;
    }

    function getAdopters() external view returns (address[16] memory) {
        return adopters;
    }
}

