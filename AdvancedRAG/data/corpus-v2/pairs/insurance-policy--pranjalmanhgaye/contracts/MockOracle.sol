// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockOracle — simulates Chainlink rainfall feed for local/testnet demos
contract MockOracle {
    uint256 private _rainfallMm;
    uint256 private _updatedAt;

    event RainfallUpdated(uint256 rainfallMm);

    constructor(uint256 initialRainfallMm) {
        _rainfallMm = initialRainfallMm;
        _updatedAt = block.timestamp;
    }

    function getRainfallMm() external view returns (uint256) {
        return _rainfallMm;
    }

    function lastUpdated() external view returns (uint256) {
        return _updatedAt;
    }

    function setRainfallMm(uint256 rainfallMm) external {
        _rainfallMm = rainfallMm;
        _updatedAt = block.timestamp;
        emit RainfallUpdated(rainfallMm);
    }
}
