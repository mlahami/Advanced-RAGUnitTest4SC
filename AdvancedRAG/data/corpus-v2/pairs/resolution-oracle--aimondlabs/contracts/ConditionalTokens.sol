// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Mock Conditional Tokens
 * @notice Simplified mock implementation of Conditional Tokens Framework
 * @dev For testing purposes only
 */
contract ConditionalTokens is ERC1155, Ownable {
    struct Condition {
        address oracle;
        bytes32 questionId;
        uint256 outcomeSlotCount;
        bool isResolved;
        uint256[] payouts;
    }

    mapping(bytes32 => Condition) public conditions;
    mapping(bytes32 => bool) public preparedConditions;
    mapping(uint256 => bytes32) public tokenToCondition;

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
    
    event DebugReportPayouts(
        bytes32 indexed conditionId,
        uint256[] payouts
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

    constructor() ERC1155("") Ownable(msg.sender) {}

    function prepareCondition(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external {
        bytes32 conditionId = getConditionId(oracle, questionId, outcomeSlotCount);
        require(!preparedConditions[conditionId], "Condition already prepared");

        conditions[conditionId] = Condition({
            oracle: oracle,
            questionId: questionId,
            outcomeSlotCount: outcomeSlotCount,
            isResolved: false,
            payouts: new uint256[](outcomeSlotCount)
        });

        preparedConditions[conditionId] = true;

        emit ConditionPreparation(conditionId, oracle, questionId, outcomeSlotCount);
    }

    function splitPosition(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external {
        require(preparedConditions[conditionId], "Condition not prepared");
        require(collateralToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // Mint outcome tokens
        for (uint256 i = 0; i < partition.length; i++) {
            uint256 tokenId = getPositionId(collateralToken, getCollectionId(parentCollectionId, conditionId, partition[i]));
            _mint(msg.sender, tokenId, amount, "");
            tokenToCondition[tokenId] = conditionId;
        }

        emit PositionSplit(msg.sender, collateralToken, parentCollectionId, conditionId, partition, amount);
    }

    function mergePositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external {
        require(preparedConditions[conditionId], "Condition not prepared");

        // Burn outcome tokens
        for (uint256 i = 0; i < partition.length; i++) {
            uint256 tokenId = getPositionId(collateralToken, getCollectionId(parentCollectionId, conditionId, partition[i]));
            _burn(msg.sender, tokenId, amount);
        }

        // Transfer collateral back
        require(collateralToken.transfer(msg.sender, amount), "Transfer failed");

        emit PositionsMerge(msg.sender, collateralToken, parentCollectionId, conditionId, partition, amount);
    }

    function reportPayouts(
        bytes32 questionId,
        uint256[] calldata payouts
    ) external {
        // Find condition by questionId using the same calculation as getConditionId
        bytes32 conditionId = getConditionId(msg.sender, questionId, payouts.length);
        // Debug: Log the conditionId being used
        emit DebugReportPayouts(conditionId, payouts);
        // Debug: Check if condition exists
        require(preparedConditions[conditionId], "Condition not found");

        Condition storage condition = conditions[conditionId];
        require(!condition.isResolved, "Already resolved");
        require(payouts.length == condition.outcomeSlotCount, "Invalid payouts length");

        condition.isResolved = true;
        // Copy the payouts array
        condition.payouts = new uint256[](payouts.length);
        for (uint256 i = 0; i < payouts.length; i++) {
            condition.payouts[i] = payouts[i];
        }
        
        emit ConditionResolution(conditionId, condition.oracle, questionId, condition.outcomeSlotCount, payouts);
    }

    function redeemPositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external {
        Condition storage condition = conditions[conditionId];
        require(condition.isResolved, "Not resolved");

        uint256 totalPayout = 0;
        for (uint256 i = 0; i < indexSets.length; i++) {
            uint256 tokenId = getPositionId(collateralToken, getCollectionId(parentCollectionId, conditionId, indexSets[i]));
            uint256 balance = balanceOf(msg.sender, tokenId);
            if (balance > 0) {
                // Calculate the outcome index from the indexSet
                // For binary market: indexSet 1 = outcome 0, indexSet 2 = outcome 1
                uint256 outcomeIndex = 0;
                uint256 temp = indexSets[i];
                while (temp > 1) {
                    temp = temp >> 1;
                    outcomeIndex++;
                }
                
                require(condition.payouts.length > outcomeIndex, "Payout not set");
                uint256 payout = (balance * condition.payouts[outcomeIndex]) / 100;
                totalPayout += payout;
                _burn(msg.sender, tokenId, balance);
            }
        }
        
        // Debug: Log the total payout
        emit DebugReportPayouts(conditionId, new uint256[](0)); // Use empty array to avoid issues

        if (totalPayout > 0) {
            require(collateralToken.transfer(msg.sender, totalPayout), "Transfer failed");
        }
    }

    function getPositionId(
        IERC20 collateralToken,
        bytes32 collectionId
    ) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(collateralToken, collectionId)));
    }

    function getCollectionId(
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256 indexSet
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(parentCollectionId, conditionId, indexSet));
    }

    function getConditionId(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount));
    }

    function payoutDenominator(bytes32 conditionId) external view returns (uint256) {
        return 100; // Simplified: always 100
    }

    function payoutNumerators(
        bytes32 conditionId,
        uint256 index
    ) external view returns (uint256) {
        return conditions[conditionId].payouts[index];
    }
}