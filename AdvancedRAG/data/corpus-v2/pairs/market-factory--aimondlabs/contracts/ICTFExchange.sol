// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IConditionalTokens.sol";

/**
 * @title CTF Exchange Interface
 * @notice Interface for the CTF Exchange contract
 * @dev Based on Polymarket CTF Exchange implementation
 */
interface ICTFExchange {
    /// @notice Registers a token pair for trading
    /// @param token - Token ID
    /// @param complement - Complement token ID
    /// @param conditionId - CTF condition ID
    function registerToken(
        uint256 token,
        uint256 complement,
        bytes32 conditionId
    ) external;

    /// @notice Fills an order
    /// @param order - The order to be filled
    /// @param fillAmount - The amount to fill (in maker amount terms)
    function fillOrder(
        Order memory order,
        uint256 fillAmount
    ) external;

    /// @notice Fills multiple orders
    /// @param orders - Orders to be filled
    /// @param fillAmounts - Fill amounts (in maker amount terms)
    function fillOrders(
        Order[] memory orders,
        uint256[] memory fillAmounts
    ) external;

    /// @notice Matches a taker order against maker orders
    /// @param takerOrder - Active order
    /// @param makerOrders - Passive orders to match against
    /// @param takerFillAmount - Amount to fill on taker
    /// @param makerFillAmounts - Amounts to fill on makers
    function matchOrders(
        Order memory takerOrder,
        Order[] memory makerOrders,
        uint256 takerFillAmount,
        uint256[] memory makerFillAmounts
    ) external;

    /// @notice Cancels an order
    /// @param order - The order to be cancelled
    function cancelOrder(Order memory order) external;

    /// @notice Cancels multiple orders
    /// @param orders - The orders to be cancelled
    function cancelOrders(Order[] memory orders) external;

    /// @notice Validates an order
    /// @param order - The order to be validated
    function validateOrder(Order memory order) external view;

    /// @notice Gets order status
    /// @param orderHash - The order hash
    function getOrderStatus(bytes32 orderHash) external view returns (OrderStatus memory);

    /// @notice Hashes an order
    /// @param order - The order to hash
    function hashOrder(Order memory order) external pure returns (bytes32);

    /// @notice Events
    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        uint256 makerAssetId,
        uint256 takerAssetId,
        uint256 makerAmountFilled,
        uint256 takerAmountFilled,
        uint256 fee
    );

    event OrdersMatched(
        bytes32 indexed takerOrderHash,
        address indexed takerOrderMaker,
        uint256 makerAssetId,
        uint256 takerAssetId,
        uint256 makerAmountFilled,
        uint256 takerAmountFilled
    );

    event OrderCancelled(bytes32 indexed orderHash);

    event FeeCharged(
        address indexed receiver,
        uint256 tokenId,
        uint256 amount
    );
}

// Order structures (simplified for interface)
struct Order {
    uint256 salt;
    address maker;
    address signer;
    address taker;
    uint256 tokenId;
    uint256 makerAmount;
    uint256 takerAmount;
    uint256 expiration;
    uint256 nonce;
    uint256 feeRateBps;
    Side side;
    SignatureType signatureType;
    bytes signature;
}

enum Side {
    BUY,
    SELL
}

enum SignatureType {
    EOA,
    POLY_PROXY,
    POLY_GNOSIS_SAFE
}

struct OrderStatus {
    bool isFilledOrCancelled;
    uint256 remaining;
}