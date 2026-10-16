// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IBudgetEnforcer.sol";

/// @title BudgetEnforcer
/// @author W3A-1 Team
/// @notice Authoritative, on-chain spending cap for an AI agent.
///
/// Security model
/// ==============
/// - Only `owner` can set budget / designate the agent.
/// - Only `agent` can call `authorize`.  The agent cannot modify its own
///   spending cap — it can only REQUEST authorization.
/// - Each `reqId` is a bytes32 one-time token.  Once used, it is permanently
///   marked — preventing replay / double-charge at the contract level.
/// - `totalSpent` is monotonically increasing; it is never decremented.
/// - If `totalSpent + amount` would exceed `maxBudget`, the call reverts and
///   ALL state changes are rolled back (including the reqId mark).
/// - The budget can only be increased by the owner (never decreased), so the
///   owner cannot retroactively invalidate already-recorded spend.
/// - Providers call the view function `verifyAuthorization` to confirm that a
///   reqId was authorized for exactly the right amount before delivering
///   content.  This is a cheap read-only call — no gas cost for providers.
///
/// Attack resistance
/// =================
/// - Agent attempting overspend → reverts (check before state change).
/// - Agent replaying an old reqId → reverts (usedRequests check first).
/// - Unauthorized address calling authorize → reverts (onlyAgent modifier).
/// - Reentrancy during authorize → blocked by ReentrancyGuard.
/// - Provider verifying an unrecognized reqId → returns false (no delivery).
/// - Owner trying to decrease budget below totalSpent → reverts.
///
contract BudgetEnforcer is IBudgetEnforcer, ReentrancyGuard {
    // State

    address public override owner;
    address public override agent;
    uint256 public override maxBudget;
    uint256 public override totalSpent;

    /// @dev reqId → true when this request has been authorized.
    ///      Set atomically inside `authorize` AFTER all checks pass.
    mapping(bytes32 => bool) private _usedRequests;

    /// @dev reqId → the amount that was authorized for this request.
    ///      Allows providers to verify the exact price they quoted.
    mapping(bytes32 => uint256) private _authorizedAmounts;
    // Modifiers

    modifier onlyOwner() {
        require(msg.sender == owner, "BudgetEnforcer: caller is not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "BudgetEnforcer: caller is not agent");
        _;
    }
    // Constructor

    /// @param _owner          Address that controls budget and agent assignment.
    /// @param _agent          Address of the AI agent wallet.
    /// @param _maxBudget      Initial hard spending ceiling (in budget units).
    constructor(address _owner, address _agent, uint256 _maxBudget) {
        require(_owner != address(0), "BudgetEnforcer: owner is zero address");
        require(_agent != address(0), "BudgetEnforcer: agent is zero address");
        require(_maxBudget > 0,       "BudgetEnforcer: budget must be > 0");

        owner     = _owner;
        agent     = _agent;
        maxBudget = _maxBudget;

        emit BudgetSet(_maxBudget);
        emit AgentSet(_agent);
    }
    // Admin functions

    /// @inheritdoc IBudgetEnforcer
    /// @dev Budget can only be increased to avoid retroactively invalidating
    ///      already-authorized spend.
    function setBudget(uint256 newMaxBudget) external override onlyOwner {
        require(
            newMaxBudget > maxBudget,
            "BudgetEnforcer: new budget must be greater than current"
        );
        maxBudget = newMaxBudget;
        emit BudgetSet(newMaxBudget);
    }

    /// @inheritdoc IBudgetEnforcer
    function setAgent(address newAgent) external override onlyOwner {
        require(newAgent != address(0), "BudgetEnforcer: agent is zero address");
        agent = newAgent;
        emit AgentSet(newAgent);
    }
    // Agent authorization

    /// @notice Atomically authorize spending for a unique service request.
    ///         Called by the AI agent BEFORE paying the provider.
    ///         Execution order: (1) caller check, (2) replay guard, (3) cap guard, (4) effects, (5) events.
    ///         ReentrancyGuard provides defense-in-depth even without external calls.
    /// @param reqId   Provider-generated unique request identifier.
    /// @param amount  Service cost in budget units.
    function authorize(bytes32 reqId, uint256 amount)
        external
        override
        onlyAgent
        nonReentrant
    {
        require(amount > 0, "BudgetEnforcer: amount must be > 0");

        // --- Replay protection (CHECKS) ---
        if (_usedRequests[reqId]) {
            emit ReplayRejected(reqId);
            revert("BudgetEnforcer: request ID already used");
        }

        // --- Budget cap (CHECKS) ---
        uint256 newTotal = totalSpent + amount;
        if (newTotal > maxBudget) {
            emit OverspendRejected(reqId, amount, maxBudget - totalSpent);
            revert("BudgetEnforcer: spending cap exceeded");
        }

        // --- State update (EFFECTS) ---
        _usedRequests[reqId]      = true;
        _authorizedAmounts[reqId] = amount;
        totalSpent                = newTotal;

        emit PaymentAuthorized(reqId, amount, totalSpent);
    }
    // View functions

    /// @inheritdoc IBudgetEnforcer
    function verifyAuthorization(bytes32 reqId, uint256 amount)
        external
        view
        override
        returns (bool)
    {
        return _usedRequests[reqId] && _authorizedAmounts[reqId] == amount;
    }

    /// @inheritdoc IBudgetEnforcer
    function remainingBudget() external view override returns (uint256) {
        return maxBudget - totalSpent;
    }

    /// @inheritdoc IBudgetEnforcer
    function authorizedAmount(bytes32 reqId)
        external
        view
        override
        returns (uint256)
    {
        return _authorizedAmounts[reqId];
    }
}
