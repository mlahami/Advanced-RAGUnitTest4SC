// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PriceOracle
 * @notice Simple price oracle for the PolkaLend protocol.
 *         In production this would be replaced by a Chainlink / DIA feed.
 *         Prices are stored as USD value with 18 decimals (1e18 = $1).
 */
contract PriceOracle is Ownable {
    mapping(address => uint256) private _prices;

    event PriceUpdated(address indexed token, uint256 price);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Set the USD price for a token.
     */
    function setPrice(address token, uint256 price) external onlyOwner {
        require(price > 0, "Oracle: price must be > 0");
        _prices[token] = price;
        emit PriceUpdated(token, price);
    }

    /**
     * @notice Batch-set prices for multiple tokens.
     */
    function setPrices(
        address[] calldata tokens,
        uint256[] calldata prices
    ) external onlyOwner {
        require(tokens.length == prices.length, "Oracle: length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            require(prices[i] > 0, "Oracle: price must be > 0");
            _prices[tokens[i]] = prices[i];
            emit PriceUpdated(tokens[i], prices[i]);
        }
    }

    /**
     * @notice Get the USD price for a token.
     */
    function getPrice(address token) external view returns (uint256) {
        uint256 price = _prices[token];
        require(price > 0, "Oracle: price not set");
        return price;
    }
}
