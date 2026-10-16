//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ERC2771Context.sol";
import "hardhat/console.sol";

contract ExampleTarget is ERC2771Context {
    mapping(address => uint256) public points;

    event PointsAdded(address indexed user, uint256 amount, uint256 newTotal);

    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {}

    function addPoints(uint256 amount) public {
        address user = _msgSender();
        points[user] += amount;
        
        console.log("Adding %s points to %s", amount, user);
        
        emit PointsAdded(user, amount, points[user]);
    }

    function getPoints(address user) public view returns (uint256) {
        return points[user];
    }
}
