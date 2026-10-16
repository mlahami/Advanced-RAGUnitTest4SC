// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Conditional Tokens Interface
 * @notice ERC1155-based conditional tokens following Gnosis CTF standard
 * @dev Based on Polymarket CTF Exchange implementation
 */
interface IConditionalTokens {
    /// @notice Prepares a condition with a specific oracle and question ID
    /// @param oracle - Address that will report the outcome
    /// @param questionId - Unique identifier for the question
    /// @param outcomeSlotCount - Number of possible outcomes (usually 2 for binary)
    function prepareCondition(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external;

    /// @notice Splits collateral into outcome tokens
    /// @param collateralToken - The ERC20 collateral token
    /// @param parentCollectionId - Parent collection (usually bytes32(0))
    /// @param conditionId - The condition being split
    /// @param partition - Array of outcome indices [1, 2] for binary
    /// @param amount - Amount of collateral to split
    function splitPosition(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external;

    /// @notice Merges outcome tokens back into collateral
    /// @param collateralToken - The ERC20 collateral token
    /// @param parentCollectionId - Parent collection (usually bytes32(0))
    /// @param conditionId - The condition being merged
    /// @param partition - Array of outcome indices [1, 2] for binary
    /// @param amount - Amount to merge
    function mergePositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external;

    /// @notice Reports the outcome of a condition
    /// @param questionId - The question identifier
    /// @param payouts - Array of payouts for each outcome [0, 1] or [1, 0]
    function reportPayouts(
        bytes32 questionId,
        uint256[] calldata payouts
    ) external;

    /// @notice Redeems positions after resolution
    /// @param collateralToken - The ERC20 collateral token
    /// @param parentCollectionId - Parent collection
    /// @param conditionId - The resolved condition
    /// @param indexSets - Outcome index sets to redeem
    function redeemPositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external;

    /// @notice Gets the position ID (token ID) for a given collection and outcome
    function getPositionId(
        IERC20 collateralToken,
        bytes32 collectionId
    ) external pure returns (uint256);

    /// @notice Gets the collection ID for a condition and index set
    function getCollectionId(
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256 indexSet
    ) external view returns (bytes32);

    /// @notice Generates condition ID from oracle, question, and slot count
    function getConditionId(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external pure returns (bytes32);

    /// @notice Gets payout for a resolved condition
    function payoutDenominator(bytes32 conditionId) external view returns (uint256);

    /// @notice Gets outcome payout
    function payoutNumerators(
        bytes32 conditionId,
        uint256 index
    ) external view returns (uint256);

    /// @notice Events
    event ConditionPreparation(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount
    );

    event ConditionResolution(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount,
        uint256[] payoutNumerators
    );

    event PositionSplit(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    event PositionsMerge(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    event PayoutRedemption(
        address indexed redeemer,
        IERC20 indexed collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 conditionId,
        uint256[] indexSets,
        uint256 payout
    );
}