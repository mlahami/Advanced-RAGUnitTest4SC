// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title StakingRewards — Non-custodial ERC-20 staking with APY rewards
/// @author Uday Kumar BS
/// @notice Users stake UDAY tokens and earn rewards proportional to time staked
contract StakingRewards is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ── State ──────────────────────────────────────────────────────────────
    IERC20 public immutable stakingToken;

    uint256 public rewardRateBPS;        // basis points per year (1000 = 10% APY)
    uint256 public lockPeriod;           // seconds before penalty-free unstake
    uint256 public emergencyPenaltyBPS;  // penalty BPS on early exit (500 = 5%)
    uint256 public minimumStake;         // minimum tokens to stake

    struct StakeInfo {
        uint256 amount;          // tokens staked
        uint256 stakedAt;        // timestamp of stake
        uint256 rewardDebt;      // rewards already claimed
        uint256 lastUpdate;      // last reward calculation timestamp
    }

    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;

    // ── Events ─────────────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount, uint256 penalty);
    event RewardsClaimed(address indexed user, uint256 reward);
    event EmergencyWithdraw(address indexed user, uint256 amount, uint256 penalty);
    event ParametersUpdated(uint256 rewardRateBPS, uint256 lockPeriod);

    // ── Errors ─────────────────────────────────────────────────────────────
    error BelowMinimumStake(uint256 amount, uint256 minimum);
    error NothingStaked();
    error InsufficientContractBalance();
    error ZeroAmount();

    // ── Constructor ────────────────────────────────────────────────────────
    constructor(
        address _stakingToken,
        address initialOwner,
        uint256 _rewardRateBPS,   // e.g. 1000 = 10% APY
        uint256 _lockPeriodDays
    ) Ownable(initialOwner) {
        stakingToken = IERC20(_stakingToken);
        rewardRateBPS = _rewardRateBPS;
        lockPeriod = _lockPeriodDays * 1 days;
        emergencyPenaltyBPS = 500; // 5%
        minimumStake = 100 * 10 ** 18; // 100 tokens
    }

    // ── Core functions ─────────────────────────────────────────────────────

    /// @notice Stake tokens to earn rewards
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount < minimumStake) revert BelowMinimumStake(amount, minimumStake);

        StakeInfo storage info = stakes[msg.sender];

        // Claim pending rewards before updating stake
        if (info.amount > 0) {
            _claimRewards(msg.sender);
        }

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        info.amount += amount;
        info.stakedAt = block.timestamp;
        info.lastUpdate = block.timestamp;
        totalStaked += amount;

        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake tokens — penalty applies if before lock period
    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        if (info.amount == 0) revert NothingStaked();
        if (amount == 0) revert ZeroAmount();
        if (amount > info.amount) amount = info.amount;

        // Claim pending rewards first
        _claimRewards(msg.sender);

        uint256 penalty = 0;
        if (block.timestamp < info.stakedAt + lockPeriod) {
            penalty = (amount * emergencyPenaltyBPS) / 10_000;
        }

        info.amount -= amount;
        totalStaked -= amount;
        info.lastUpdate = block.timestamp;

        uint256 amountOut = amount - penalty;
        stakingToken.safeTransfer(msg.sender, amountOut);

        emit Unstaked(msg.sender, amountOut, penalty);
    }

    /// @notice Claim accrued rewards without unstaking
    function claimRewards() external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        if (info.amount == 0) revert NothingStaked();
        _claimRewards(msg.sender);
    }

    /// @notice Emergency exit — always incurs penalty regardless of lock period
    function emergencyWithdraw() external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        if (info.amount == 0) revert NothingStaked();

        uint256 amount = info.amount;
        uint256 penalty = (amount * emergencyPenaltyBPS) / 10_000;
        uint256 amountOut = amount - penalty;

        totalStaked -= amount;
        delete stakes[msg.sender];

        stakingToken.safeTransfer(msg.sender, amountOut);

        emit EmergencyWithdraw(msg.sender, amountOut, penalty);
    }

    // ── View functions ─────────────────────────────────────────────────────

    /// @notice Calculate pending rewards for an address
    function earned(address user) public view returns (uint256) {
        StakeInfo storage info = stakes[user];
        if (info.amount == 0) return 0;

        uint256 timeElapsed = block.timestamp - info.lastUpdate;
        // reward = amount * rate * time / (10000 * 365 days)
        uint256 reward = (info.amount * rewardRateBPS * timeElapsed) / (10_000 * 365 days);
        return reward;
    }

    /// @notice Returns full stake info for a user
    function getStakeInfo(address user) external view returns (
        uint256 amount,
        uint256 stakedAt,
        uint256 pendingReward,
        bool isLocked,
        uint256 unlockTime
    ) {
        StakeInfo storage info = stakes[user];
        amount = info.amount;
        stakedAt = info.stakedAt;
        pendingReward = earned(user);
        unlockTime = info.stakedAt + lockPeriod;
        isLocked = block.timestamp < unlockTime;
    }

    // ── Internal ───────────────────────────────────────────────────────────

    function _claimRewards(address user) internal {
        uint256 reward = earned(user);
        if (reward == 0) return;

        if (stakingToken.balanceOf(address(this)) < totalStaked + reward) {
            revert InsufficientContractBalance();
        }

        stakes[user].rewardDebt += reward;
        stakes[user].lastUpdate = block.timestamp;

        stakingToken.safeTransfer(user, reward);
        emit RewardsClaimed(user, reward);
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    function setRewardRate(uint256 _rewardRateBPS) external onlyOwner {
        rewardRateBPS = _rewardRateBPS;
        emit ParametersUpdated(_rewardRateBPS, lockPeriod);
    }

    function setLockPeriod(uint256 _days) external onlyOwner {
        lockPeriod = _days * 1 days;
        emit ParametersUpdated(rewardRateBPS, lockPeriod);
    }

    function fundRewards(uint256 amount) external onlyOwner {
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
    }
}
