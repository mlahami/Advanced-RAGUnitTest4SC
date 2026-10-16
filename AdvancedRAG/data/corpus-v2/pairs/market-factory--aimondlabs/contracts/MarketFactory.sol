// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IConditionalTokens.sol";
import "./ICTFExchange.sol";

/**
 * @title Market Factory
 * @notice Factory for creating prediction markets
 * @dev Based on Polymarket CTF Exchange implementation
 */
contract MarketFactory is Ownable, ReentrancyGuard {
    IConditionalTokens public immutable ctf;
    address public immutable collateralToken;
    address public exchange;
    address public oracle;

    // Market registry
    mapping(bytes32 => Market) public markets;
    mapping(uint256 => bytes32) public tokenToCondition;
    mapping(bytes32 => bool) public questionIds;

    struct Market {
        bytes32 conditionId;
        string question;
        string description;
        string category;
        uint256 outcomeSlotCount;
        uint256[] tokenIds;
        uint256 endTime;
        uint256 resolutionTime;
        MarketStatus status;
        address creator;
        uint256 createdAt;
    }

    enum MarketStatus {
        Active,
        Closed,
        Resolved,
        Canceled
    }

    event MarketCreated(
        bytes32 indexed conditionId,
        bytes32 indexed questionId,
        string question,
        uint256 outcomeSlotCount,
        uint256[] tokenIds,
        address creator
    );

    event MarketResolved(
        bytes32 indexed conditionId,
        uint256[] payouts
    );

    event MarketClosed(
        bytes32 indexed conditionId
    );

    event MarketCanceled(
        bytes32 indexed conditionId
    );

    error InvalidEndTime();
    error InvalidResolutionTime();
    error InvalidOutcomeCount();
    error QuestionIdAlreadyExists();
    error MarketNotActive();
    error NotAuthorized();
    error ExchangeNotSet();

    modifier onlyExchange() {
        if (msg.sender != exchange) revert NotAuthorized();
        _;
    }

    constructor(
        address _ctf,
        address _collateralToken,
        address _oracle
    ) Ownable(msg.sender) {
        ctf = IConditionalTokens(_ctf);
        collateralToken = _collateralToken;
        oracle = _oracle;
    }

    /// @notice Creates a new binary prediction market
    /// @param questionId - Unique identifier for the question
    /// @param question - The market question
    /// @param description - Market description
    /// @param category - Market category
    /// @param endTime - Market end time
    /// @param resolutionTime - Expected resolution time
    function createBinaryMarket(
        bytes32 questionId,
        string calldata question,
        string calldata description,
        string calldata category,
        uint256 endTime,
        uint256 resolutionTime
    ) external returns (bytes32 conditionId, uint256[] memory tokenIds) {
        if (endTime <= block.timestamp) revert InvalidEndTime();
        if (resolutionTime <= endTime) revert InvalidResolutionTime();
        if (questionIds[questionId]) revert QuestionIdAlreadyExists();

        // Mark question ID as used
        questionIds[questionId] = true;

        // Prepare condition in CTF
        ctf.prepareCondition(oracle, questionId, 2);

        // Calculate condition ID
        conditionId = ctf.getConditionId(oracle, questionId, 2);

        // Calculate token IDs for YES and NO outcomes
        tokenIds = new uint256[](2);

        // YES token (index 0)
        bytes32 collectionIdYes = ctf.getCollectionId(
            bytes32(0),
            conditionId,
            1 // indexSet for outcome 0
        );
        tokenIds[0] = ctf.getPositionId(IERC20(collateralToken), collectionIdYes);

        // NO token (index 1)
        bytes32 collectionIdNo = ctf.getCollectionId(
            bytes32(0),
            conditionId,
            2 // indexSet for outcome 1
        );
        tokenIds[1] = ctf.getPositionId(IERC20(collateralToken), collectionIdNo);

        // Store market
        markets[conditionId] = Market({
            conditionId: conditionId,
            question: question,
            description: description,
            category: category,
            outcomeSlotCount: 2,
            tokenIds: tokenIds,
            endTime: endTime,
            resolutionTime: resolutionTime,
            status: MarketStatus.Active,
            creator: msg.sender,
            createdAt: block.timestamp
        });

        // Register tokens
        tokenToCondition[tokenIds[0]] = conditionId;
        tokenToCondition[tokenIds[1]] = conditionId;

        // Register with exchange
        if (exchange != address(0)) {
            ICTFExchange(exchange).registerToken(
                tokenIds[0],
                tokenIds[1],
                conditionId
            );
        }

        emit MarketCreated(
            conditionId,
            questionId,
            question,
            2,
            tokenIds,
            msg.sender
        );
    }

    /// @notice Creates a multiple choice prediction market
    /// @param questionId - Unique identifier for the question
    /// @param question - The market question
    /// @param description - Market description
    /// @param category - Market category
    /// @param outcomeSlotCount - Number of outcomes
    /// @param endTime - Market end time
    /// @param resolutionTime - Expected resolution time
    function createMultipleChoiceMarket(
        bytes32 questionId,
        string calldata question,
        string calldata description,
        string calldata category,
        uint256 outcomeSlotCount,
        uint256 endTime,
        uint256 resolutionTime
    ) external returns (bytes32 conditionId, uint256[] memory tokenIds) {
        if (outcomeSlotCount < 3 || outcomeSlotCount > 256) revert InvalidOutcomeCount();
        if (endTime <= block.timestamp) revert InvalidEndTime();
        if (resolutionTime <= endTime) revert InvalidResolutionTime();
        if (questionIds[questionId]) revert QuestionIdAlreadyExists();

        // Mark question ID as used
        questionIds[questionId] = true;

        // Prepare condition
        ctf.prepareCondition(oracle, questionId, outcomeSlotCount);
        conditionId = ctf.getConditionId(oracle, questionId, outcomeSlotCount);

        // Calculate token IDs for all outcomes
        tokenIds = new uint256[](outcomeSlotCount);
        for (uint256 i = 0; i < outcomeSlotCount; i++) {
            bytes32 collectionId = ctf.getCollectionId(
                bytes32(0),
                conditionId,
                1 << i
            );
            tokenIds[i] = ctf.getPositionId(IERC20(collateralToken), collectionId);
            tokenToCondition[tokenIds[i]] = conditionId;
        }

        // Store market
        markets[conditionId] = Market({
            conditionId: conditionId,
            question: question,
            description: description,
            category: category,
            outcomeSlotCount: outcomeSlotCount,
            tokenIds: tokenIds,
            endTime: endTime,
            resolutionTime: resolutionTime,
            status: MarketStatus.Active,
            creator: msg.sender,
            createdAt: block.timestamp
        });

        emit MarketCreated(
            conditionId,
            questionId,
            question,
            outcomeSlotCount,
            tokenIds,
            msg.sender
        );
    }

    /// @notice Closes a market (no more orders)
    function closeMarket(bytes32 conditionId) external {
        Market storage market = markets[conditionId];
        if (msg.sender != market.creator && msg.sender != oracle) revert NotAuthorized();
        if (market.status != MarketStatus.Active) revert MarketNotActive();

        market.status = MarketStatus.Closed;
        emit MarketClosed(conditionId);
    }

    /// @notice Cancels a market
    function cancelMarket(bytes32 conditionId) external {
        Market storage market = markets[conditionId];
        if (msg.sender != market.creator && msg.sender != owner()) revert NotAuthorized();
        if (market.status != MarketStatus.Active) revert MarketNotActive();

        market.status = MarketStatus.Canceled;
        emit MarketCanceled(conditionId);
    }

    /// @notice Sets the exchange address
    function setExchange(address _exchange) external onlyOwner {
        exchange = _exchange;
    }

    /// @notice Sets the oracle address
    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }

    /// @notice Gets market info
    function getMarket(bytes32 conditionId) external view returns (Market memory) {
        return markets[conditionId];
    }

    /// @notice Gets all markets created by a user
    function getMarketsByCreator(address creator) external view returns (bytes32[] memory) {
        // This would require additional storage mapping in a real implementation
        // For now, return empty array
        return new bytes32[](0);
    }

    /// @notice Checks if a question ID is already used
    function isQuestionIdUsed(bytes32 questionId) external view returns (bool) {
        return questionIds[questionId];
    }
}