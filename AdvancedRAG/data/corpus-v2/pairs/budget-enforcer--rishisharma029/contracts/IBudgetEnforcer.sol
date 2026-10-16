// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IBudgetEnforcer
/// @notice Interface for the W3A-1 budget enforcement contract.
///         The contract is the single authoritative source of truth for
///         whether an AI agent is allowed to spend a given amount.
interface IBudgetEnforcer {
    // Events

    /// @notice Emitted when the owner sets or updates the maximum budget.
    event BudgetSet(uint256 maxBudget);

    /// @notice Emitted when the owner designates a new agent address.
    event AgentSet(address indexed agent);

    /// @notice Emitted when a payment is successfully authorized.
    /// @param reqId       Unique request identifier supplied by the provider.
    /// @param amount      Amount authorized for this request.
    /// @param totalSpent  Running total of all authorized spend after this call.
    event PaymentAuthorized(
        bytes32 indexed reqId,
        uint256 amount,
        uint256 totalSpent
    );

    /// @notice Emitted when a payment attempt is rejected because it would
    ///         exceed the remaining budget.  No state is changed.
    /// @param reqId      The request ID that was rejected.
    /// @param attempted  The amount the agent tried to spend.
    /// @param remaining  Remaining budget at the time of rejection.
    event OverspendRejected(
        bytes32 indexed reqId,
        uint256 attempted,
        uint256 remaining
    );

    /// @notice Emitted when the same request ID is submitted a second time.
    ///         No state is changed.
    event ReplayRejected(bytes32 indexed reqId);
    // Admin functions (owner only)

    /// @notice Set the hard spending ceiling.
    ///         Can only be increased, never decreased, to prevent
    ///         owner from retroactively invalidating recorded spend.
    function setBudget(uint256 maxBudget) external;

    /// @notice Designate which address is allowed to call `authorize`.
    function setAgent(address agent) external;
    // Agent function

    /// @notice Atomically authorize spending for a unique service request.
    ///         Called by the AI agent BEFORE paying the provider.
    ///
    ///         Guarantees:
    ///         - Only the designated agent address can call this.
    ///         - `reqId` must never have been used before (replay protection).
    ///         - `totalSpent + amount` must not exceed `maxBudget`.
    ///         - On any violation the call reverts and state is unchanged.
    ///
    /// @param reqId   Provider-generated unique request identifier.
    /// @param amount  Service cost in budget units.
    function authorize(bytes32 reqId, uint256 amount) external;
    // View functions

    /// @notice Returns true if `reqId` has been successfully authorized.
    ///         Providers call this to verify payment before delivering content.
    /// @param reqId    The request identifier to check.
    /// @param amount   The expected authorized amount (must match exactly).
    function verifyAuthorization(bytes32 reqId, uint256 amount)
        external
        view
        returns (bool);

    /// @notice Remaining budget = maxBudget - totalSpent.
    function remainingBudget() external view returns (uint256);

    /// @notice Returns the amount authorized for a specific request ID.
    ///         Returns 0 if the request has not been authorized.
    function authorizedAmount(bytes32 reqId) external view returns (uint256);
    // State getters (auto-generated, listed here for documentation)

    function owner() external view returns (address);
    function agent() external view returns (address);
    function maxBudget() external view returns (uint256);
    function totalSpent() external view returns (uint256);
}
