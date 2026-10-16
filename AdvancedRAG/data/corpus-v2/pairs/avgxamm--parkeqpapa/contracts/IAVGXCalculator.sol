
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAVGXCalculator
 * @dev Interface for the AVGX index calculator contract
 */
interface IAVGXCalculator {
    struct Component {
        bytes32 assetId;
        uint256 weightBps;
        uint8 decimals;
    }

    event ComponentsUpdated(Component[] fiatComponents, Component[] cryptoComponents);
    event FiatComponentAdded(bytes32 indexed assetId, uint256 weightBps);
    event CryptoComponentAdded(bytes32 indexed assetId, uint256 weightBps);
    event ComponentRemoved(bytes32 indexed assetId, bool isFiat);

    error InvalidWeights();
    error ComponentNotFound();
    error DuplicateComponent();

    /**
     * @dev Calculates current AVGX index value
     * @return priceE18 Index value in 1e18 format
     */
    function currentIndex() external view returns (uint256 priceE18);

    /**
     * @dev Adds a fiat component to the index
     * @param assetId Asset identifier
     * @param weightBps Weight in basis points
     * @param decimals Price feed decimals
     */
    function addFiatComponent(bytes32 assetId, uint256 weightBps, uint8 decimals) external;

    /**
     * @dev Adds a crypto component to the index
     * @param assetId Asset identifier
     * @param weightBps Weight in basis points
     * @param decimals Price feed decimals
     */
    function addCryptoComponent(bytes32 assetId, uint256 weightBps, uint8 decimals) external;

    /**
     * @dev Removes a component from the index
     * @param assetId Asset identifier
     * @param isFiat Whether the component is fiat
     */
    function removeComponent(bytes32 assetId, bool isFiat) external;

    /**
     * @dev Updates component weight
     * @param assetId Asset identifier
     * @param weightBps New weight in basis points
     * @param isFiat Whether the component is fiat
     */
    function updateComponentWeight(bytes32 assetId, uint256 weightBps, bool isFiat) external;

    /**
     * @dev Gets all fiat components
     * @return components Array of fiat components
     */
    function getFiatComponents() external view returns (Component[] memory components);

    /**
     * @dev Gets all crypto components
     * @return components Array of crypto components
     */
    function getCryptoComponents() external view returns (Component[] memory components);

    /**
     * @dev Gets total weight for fiat components
     * @return totalWeight Total weight in basis points
     */
    function getTotalFiatWeight() external view returns (uint256 totalWeight);

    /**
     * @dev Gets total weight for crypto components
     * @return totalWeight Total weight in basis points
     */
    function getTotalCryptoWeight() external view returns (uint256 totalWeight);

    /**
     * @dev Pauses the calculator
     */
    function pause() external;

    /**
     * @dev Unpauses the calculator
     */
    function unpause() external;
}
