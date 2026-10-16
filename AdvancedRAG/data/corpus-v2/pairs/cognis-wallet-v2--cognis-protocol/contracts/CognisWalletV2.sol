// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title CognisWalletV2
 * @notice Spending wallet for an autonomous agent (the owner's "digital twin").
 *
 * The agent spends $CGOX on its own up to a rolling daily limit. Anything above
 * the limit needs an explicit approval from the owner, which is the on-chain
 * half of a human-in-the-loop confirmation in the client.
 *
 * The limit logic is unchanged from v1. What changed:
 *   - transfers go through {SafeERC20}, so tokens that return no value or
 *     return false are handled correctly instead of silently succeeding;
 *   - ownership is {Ownable2Step}, so a typo in a hand-over cannot brick the
 *     wallet, and the owner is set explicitly at deployment instead of being
 *     whoever sent the deployment transaction;
 *   - every state change emits an event (including owner withdrawals), and
 *     approvals can be revoked;
 *   - reverts use custom errors.
 *
 * Over-limit approvals (v2 hardening). v1 keyed an approval by
 * `keccak256(to, amount)` alone and stored it as a boolean with no expiry. Two
 * consequences: an approval the owner forgot about stayed armed indefinitely,
 * and re-approving the same pair was indistinguishable from the first approval,
 * so a stale confirmation could authorise a much later payment. Here every
 * approval gets its own `nonce` (part of the key) and expires after
 * {APPROVAL_VALIDITY}. It is consumed on first use through
 * {agentSpendApproved}, which names the nonce explicitly, so an approval can
 * never be reused, guessed or confused with another one.
 *
 * Note on the daily window: `dayStart` is reset to the timestamp of the first
 * spend after 24h have elapsed, so the window rolls with usage rather than
 * being aligned to calendar days. This matches v1 behaviour exactly.
 */
contract CognisWalletV2 is Ownable2Step {
    using SafeERC20 for IERC20;

    /// @notice How long an over-limit approval stays usable after it is issued.
    uint256 public constant APPROVAL_VALIDITY = 1 hours;

    /// @notice Asset the agent is allowed to spend.
    IERC20 public immutable token;

    /// @notice Address the digital twin signs with.
    address public agent;
    /// @notice Amount the agent may spend per 24h window without approval.
    uint256 public dailyLimit;
    /// @notice Amount already spent inside the current window.
    uint256 public spentToday;
    /// @notice Start of the current 24h window.
    uint256 public dayStart;
    /// @notice Number of over-limit approvals ever issued; the last one's nonce.
    uint256 public approvalNonce;

    /// @notice Expiry of a single-use owner approval: keccak256(to, amount, nonce) => unix time (0 = none).
    mapping(bytes32 approvalKey => uint256 expiresAt) public approvedOverLimit;

    error ZeroAddress();
    error InvalidAmount();
    error NotAuthorized();
    error OverDailyLimit();
    error UnknownApproval();
    error ApprovalExpired();

    event AgentSpent(address indexed to, uint256 amount, bool overLimit);
    event AgentChanged(address indexed previousAgent, address indexed newAgent);
    event LimitChanged(uint256 previousLimit, uint256 newLimit);
    event OverLimitApproved(
        bytes32 indexed approvalKey, address indexed to, uint256 amount, uint256 nonce, uint256 expiresAt
    );
    event OverLimitRevoked(bytes32 indexed approvalKey, address indexed to, uint256 amount, uint256 nonce);
    event OverLimitConsumed(bytes32 indexed approvalKey, address indexed to, uint256 amount, uint256 nonce);
    event OwnerWithdrawal(address indexed to, uint256 amount);

    constructor(address token_, address agent_, uint256 dailyLimit_, address initialOwner) Ownable(initialOwner) {
        if (token_ == address(0) || agent_ == address(0) || initialOwner == address(0)) revert ZeroAddress();
        token = IERC20(token_);
        agent = agent_;
        dailyLimit = dailyLimit_;
        dayStart = block.timestamp;

        emit AgentChanged(address(0), agent_);
        emit LimitChanged(0, dailyLimit_);
    }

    modifier onlyAgentOrOwner() {
        if (msg.sender != agent && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    /// @notice Key used to record and look up one over-limit approval.
    function approvalKey(address to, uint256 amount, uint256 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode(to, amount, nonce));
    }

    function setDailyLimit(uint256 newLimit) external onlyOwner {
        emit LimitChanged(dailyLimit, newLimit);
        dailyLimit = newLimit;
    }

    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        emit AgentChanged(agent, newAgent);
        agent = newAgent;
    }

    /**
     * @notice Approve one spend above the daily limit.
     * @dev Consumed on first use and valid for {APPROVAL_VALIDITY}. The returned
     *      nonce is also readable as {approvalNonce} and is carried by the
     *      {OverLimitApproved} event; the agent must quote it in
     *      {agentSpendApproved}.
     */
    function approveOverLimit(address to, uint256 amount)
        external
        onlyOwner
        returns (bytes32 key, uint256 nonce, uint256 expiresAt)
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        nonce = ++approvalNonce;
        expiresAt = block.timestamp + APPROVAL_VALIDITY;
        key = approvalKey(to, amount, nonce);
        approvedOverLimit[key] = expiresAt;

        emit OverLimitApproved(key, to, amount, nonce, expiresAt);
    }

    /// @notice Withdraw an unused over-limit approval before it is spent.
    function revokeOverLimit(address to, uint256 amount, uint256 nonce) external onlyOwner {
        bytes32 key = approvalKey(to, amount, nonce);
        if (approvedOverLimit[key] == 0) revert UnknownApproval();
        delete approvedOverLimit[key];
        emit OverLimitRevoked(key, to, amount, nonce);
    }

    /**
     * @notice Autonomous spend by the agent, inside the daily limit.
     * @dev Unattended. Anything that does not fit in the remaining allowance is
     *      rejected; use {agentSpendApproved} with an owner approval instead.
     */
    function agentSpend(address to, uint256 amount) external onlyAgentOrOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        _rollDay();
        if (spentToday + amount > dailyLimit) revert OverDailyLimit();

        _spend(to, amount, false);
    }

    /**
     * @notice Spend against a specific owner approval, above the daily limit.
     * @dev The approval is single use and expires; the amount still counts
     *      towards the day's total so it cannot be used to reset the window.
     */
    function agentSpendApproved(address to, uint256 amount, uint256 nonce) external onlyAgentOrOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        bytes32 key = approvalKey(to, amount, nonce);
        uint256 expiresAt = approvedOverLimit[key];
        if (expiresAt == 0) revert UnknownApproval();
        if (block.timestamp > expiresAt) revert ApprovalExpired();
        delete approvedOverLimit[key]; // single use

        _rollDay();
        _spend(to, amount, true);

        emit OverLimitConsumed(key, to, amount, nonce);
    }

    /// @notice The owner can always move funds out, with no limit.
    function ownerWithdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit OwnerWithdrawal(to, amount);
    }

    /// @notice How much the agent may still spend unattended in this window.
    function remainingToday() external view returns (uint256) {
        if (block.timestamp >= dayStart + 1 days) return dailyLimit;
        return spentToday >= dailyLimit ? 0 : dailyLimit - spentToday;
    }

    /// @notice Seconds left on an approval, or 0 if it is unknown, spent or expired.
    function approvalTimeLeft(address to, uint256 amount, uint256 nonce) external view returns (uint256) {
        uint256 expiresAt = approvedOverLimit[approvalKey(to, amount, nonce)];
        if (expiresAt <= block.timestamp) return 0;
        return expiresAt - block.timestamp;
    }

    function _spend(address to, uint256 amount, bool overLimit) private {
        spentToday += amount;
        token.safeTransfer(to, amount);
        emit AgentSpent(to, amount, overLimit);
    }

    function _rollDay() private {
        if (block.timestamp >= dayStart + 1 days) {
            dayStart = block.timestamp;
            spentToday = 0;
        }
    }
}
