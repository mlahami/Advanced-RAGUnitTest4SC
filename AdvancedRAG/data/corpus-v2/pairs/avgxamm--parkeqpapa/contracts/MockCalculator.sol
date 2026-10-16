
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IAVGXCalculator.sol";

/**
 * @title MockCalculator
 * @dev Mock calculator for testing
 */
contract MockCalculator is IAVGXCalculator {
    uint256 private _price;

    function currentIndex() external view returns (uint256 priceE18) {
        return _price;
    }

    function setPrice(uint256 price) external {
        _price = price;
    }

    // Dummy implementations for the rest of the interface
    function addFiatComponent(bytes32, uint256, uint8) external {}
    function addCryptoComponent(bytes32, uint256, uint8) external {}
    function removeComponent(bytes32, bool) external {}
    function updateComponentWeight(bytes32, uint256, bool) external {}
    function getFiatComponents() external view returns (Component[] memory) {
        Component[] memory c = new Component[](0);
        return c;
    }
    function getCryptoComponents() external view returns (Component[] memory) {
        Component[] memory c = new Component[](0);
        return c;
    }
    function getTotalFiatWeight() external view returns (uint256) {
        return 10000;
    }
    function getTotalCryptoWeight() external view returns (uint256) {
        return 10000;
    }
    function pause() external {}
    function unpause() external {}
}
