// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IHypurrFiOracle
 * @notice Interface for the HypurrFi price oracle
 * @dev Provides price feeds for asset valuation and health factor calculations
 */
interface IHypurrFiOracle {
    /**
     * @notice Returns the latest price for an asset
     * @param asset The address of the asset
     * @return The price of the asset in the base currency (typically USD with 8 decimals)
     */
    function getAssetPrice(address asset) external view returns (uint256);

    /**
     * @notice Returns the prices for multiple assets
     * @param assets The addresses of the assets
     * @return An array of prices for the assets in the base currency
     */
    function getAssetsPrices(address[] calldata assets) external view returns (uint256[] memory);

    /**
     * @notice Returns the address of the source for an asset
     * @param asset The address of the asset
     * @return The address of the price source
     */
    function getSourceOfAsset(address asset) external view returns (address);

    /**
     * @notice Returns the base currency used by the oracle (e.g., USD)
     * @return The address of the base currency (address(0) for USD)
     */
    function BASE_CURRENCY() external view returns (address);

    /**
     * @notice Returns the base currency unit (decimals used for prices)
     * @return The number of decimals for the base currency unit (typically 8 for USD)
     */
    function BASE_CURRENCY_UNIT() external view returns (uint256);
}
