// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./IHypurrFiOracle.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockHypurrFiOracle
 * @notice Mock implementation of HypurrFi Oracle for testing
 * @dev Provides simple price feeds for testing purposes
 */
contract MockHypurrFiOracle is IHypurrFiOracle, Ownable {
    // Price data (scaled by 1e8, like Chainlink)
    mapping(address => uint256) private assetPrices;
    mapping(address => address) private assetSources;

    address public constant override BASE_CURRENCY = address(0); // USD
    uint256 public constant override BASE_CURRENCY_UNIT = 1e8; // 8 decimals

    event AssetPriceUpdated(address indexed asset, uint256 price, address source);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Set the price for an asset
     * @param asset Address of the asset
     * @param price Price of the asset (scaled by 1e8)
     */
    function setAssetPrice(address asset, uint256 price) external onlyOwner {
        assetPrices[asset] = price;
        emit AssetPriceUpdated(asset, price, msg.sender);
    }

    /**
     * @notice Set the price source for an asset
     * @param asset Address of the asset
     * @param source Address of the price source
     */
    function setAssetSource(address asset, address source) external onlyOwner {
        assetSources[asset] = source;
    }

    /**
     * @notice Get the price of an asset
     * @param asset Address of the asset
     * @return Price of the asset (scaled by 1e8)
     */
    function getAssetPrice(address asset) external view override returns (uint256) {
        require(assetPrices[asset] > 0, "Price not set");
        return assetPrices[asset];
    }

    /**
     * @notice Get prices for multiple assets
     * @param assets Array of asset addresses
     * @return prices Array of asset prices (scaled by 1e8)
     */
    function getAssetsPrices(address[] calldata assets)
        external
        view
        override
        returns (uint256[] memory prices)
    {
        prices = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            require(assetPrices[assets[i]] > 0, "Price not set");
            prices[i] = assetPrices[assets[i]];
        }
    }

    /**
     * @notice Get the price source for an asset
     * @param asset Address of the asset
     * @return Address of the price source
     */
    function getSourceOfAsset(address asset) external view override returns (address) {
        return assetSources[asset];
    }
}
