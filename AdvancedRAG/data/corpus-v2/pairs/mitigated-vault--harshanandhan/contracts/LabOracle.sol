// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LabOracle — intentionally manipulable single-spot price feed (lab only)
/// @notice Models an unsecured / single-source price that can move in one block.
contract LabOracle {
    uint256 public spotPrice; // 1e18 = $1
    address public labController;

    event SpotUpdated(uint256 oldPrice, uint256 newPrice, address indexed by);

    constructor(uint256 initialPrice) {
        spotPrice = initialPrice;
        labController = msg.sender;
    }

    /// @notice Anyone can set the lab spot — simulates thin DEX / single-block manipulation
    function setSpotPrice(uint256 newPrice) external {
        require(newPrice > 0, "LabOracle: zero");
        uint256 old = spotPrice;
        spotPrice = newPrice;
        emit SpotUpdated(old, newPrice, msg.sender);
    }

    function latestPrice() external view returns (uint256) {
        return spotPrice;
    }
}
