// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IConditionalTokens.sol";

/**
 * @title Resolution Oracle
 * @notice Resolves prediction market outcomes
 * @dev Based on Polymarket CTF Exchange implementation
 */
contract ResolutionOracle is Ownable, ReentrancyGuard {
    IConditionalTokens public immutable ctf;
    
    mapping(bytes32 => Resolution) public resolutions;
    mapping(address => bool) public resolvers;
    mapping(bytes32 => bool) public resolvedConditions;

    uint256 public constant DISPUTE_PERIOD = 1 days;
    uint256 public constant FINALIZATION_DELAY = 2 days;

    struct Resolution {
        bytes32 conditionId;
        bytes32 questionId;
        uint256[] payouts;
        uint256 timestamp;
        address resolver;
        ResolutionStatus status;
        uint256 disputePeriodEnd;
    }

    enum ResolutionStatus {
        Unresolved,
        Proposed,
        Disputed,
        Finalized
    }

    event ResolutionProposed(
        bytes32 indexed conditionId,
        bytes32 indexed questionId,
        uint256[] payouts,
        address resolver
    );

    event ResolutionDisputed(
        bytes32 indexed conditionId,
        address disputer
    );

    event ResolutionFinalized(
        bytes32 indexed conditionId,
        bytes32 indexed questionId,
        uint256[] payouts
    );

    event ResolverAdded(address indexed resolver);
    event ResolverRemoved(address indexed resolver);

    error AlreadyResolved();
    error InvalidPayoutsLength();
    error NotResolver();
    error NotProposed();
    error DisputePeriodActive();
    error ResolutionNotFound();
    error InvalidConditionId();

    modifier onlyResolver() {
        if (!resolvers[msg.sender]) revert NotResolver();
        _;
    }

    constructor(address _ctf) Ownable(msg.sender) {
        ctf = IConditionalTokens(_ctf);
        resolvers[msg.sender] = true;
    }

    /// @notice Proposes a resolution
    /// @param questionId - The question identifier
    /// @param outcomeSlotCount - Number of outcomes
    /// @param payouts - Array of payouts for each outcome
    function proposeResolution(
        bytes32 questionId,
        uint256 outcomeSlotCount,
        uint256[] calldata payouts
    ) external onlyResolver nonReentrant {
        if (payouts.length != outcomeSlotCount) revert InvalidPayoutsLength();

        bytes32 conditionId = ctf.getConditionId(
            address(this),
            questionId,
            outcomeSlotCount
        );

        if (resolvedConditions[conditionId]) revert AlreadyResolved();

        // Check if resolution already exists
        Resolution storage existingResolution = resolutions[conditionId];
        if (existingResolution.status != ResolutionStatus.Unresolved) {
            revert AlreadyResolved();
        }

        // Store proposed resolution
        resolutions[conditionId] = Resolution({
            conditionId: conditionId,
            questionId: questionId,
            payouts: payouts,
            timestamp: block.timestamp,
            resolver: msg.sender,
            status: ResolutionStatus.Proposed,
            disputePeriodEnd: block.timestamp + DISPUTE_PERIOD
        });

        emit ResolutionProposed(conditionId, questionId, payouts, msg.sender);
    }

    /// @notice Finalizes resolution after dispute period
    /// @param questionId - The question identifier
    /// @param outcomeSlotCount - Number of outcomes
    function finalizeResolution(
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external onlyResolver nonReentrant {
        bytes32 conditionId = ctf.getConditionId(
            address(this),
            questionId,
            outcomeSlotCount
        );

        Resolution storage resolution = resolutions[conditionId];
        if (resolution.status != ResolutionStatus.Proposed) revert NotProposed();
        if (block.timestamp < resolution.disputePeriodEnd) revert DisputePeriodActive();

        // Report to CTF
        ctf.reportPayouts(questionId, resolution.payouts);

        resolution.status = ResolutionStatus.Finalized;
        resolvedConditions[conditionId] = true;

        emit ResolutionFinalized(conditionId, questionId, resolution.payouts);
    }

    /// @notice Admin can immediately finalize (bypass dispute period)
    /// @param questionId - The question identifier
    /// @param outcomeSlotCount - Number of outcomes
    /// @param payouts - Array of payouts for each outcome
    function adminFinalizeResolution(
        bytes32 questionId,
        uint256 outcomeSlotCount,
        uint256[] calldata payouts
    ) external onlyOwner nonReentrant {
        if (payouts.length != outcomeSlotCount) revert InvalidPayoutsLength();

        bytes32 conditionId = ctf.getConditionId(
            address(this),
            questionId,
            outcomeSlotCount
        );

        if (resolvedConditions[conditionId]) revert AlreadyResolved();

        // Report to CTF
        ctf.reportPayouts(questionId, payouts);

        // Store resolution
        resolutions[conditionId] = Resolution({
            conditionId: conditionId,
            questionId: questionId,
            payouts: payouts,
            timestamp: block.timestamp,
            resolver: msg.sender,
            status: ResolutionStatus.Finalized,
            disputePeriodEnd: 0
        });

        resolvedConditions[conditionId] = true;

        emit ResolutionFinalized(conditionId, questionId, payouts);
    }

    /// @notice Disputes a proposed resolution
    /// @param questionId - The question identifier
    /// @param outcomeSlotCount - Number of outcomes
    function disputeResolution(
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external nonReentrant {
        bytes32 conditionId = ctf.getConditionId(
            address(this),
            questionId,
            outcomeSlotCount
        );

        Resolution storage resolution = resolutions[conditionId];
        if (resolution.status != ResolutionStatus.Proposed) revert ResolutionNotFound();
        if (block.timestamp >= resolution.disputePeriodEnd) revert DisputePeriodActive();

        resolution.status = ResolutionStatus.Disputed;

        emit ResolutionDisputed(conditionId, msg.sender);
    }

    /// @notice Adds a resolver
    /// @param resolver - Address to add as resolver
    function addResolver(address resolver) external onlyOwner {
        resolvers[resolver] = true;
        emit ResolverAdded(resolver);
    }

    /// @notice Removes a resolver
    /// @param resolver - Address to remove as resolver
    function removeResolver(address resolver) external onlyOwner {
        resolvers[resolver] = false;
        emit ResolverRemoved(resolver);
    }

    /// @notice Gets resolution info
    /// @param conditionId - The condition ID
    function getResolution(bytes32 conditionId) external view returns (Resolution memory) {
        return resolutions[conditionId];
    }

    /// @notice Checks if a condition is resolved
    /// @param conditionId - The condition ID
    function isResolved(bytes32 conditionId) external view returns (bool) {
        return resolvedConditions[conditionId];
    }

    /// @notice Checks if a resolution can be disputed
    /// @param conditionId - The condition ID
    function canDispute(bytes32 conditionId) external view returns (bool) {
        Resolution memory resolution = resolutions[conditionId];
        return resolution.status == ResolutionStatus.Proposed && 
               block.timestamp < resolution.disputePeriodEnd;
    }
}
