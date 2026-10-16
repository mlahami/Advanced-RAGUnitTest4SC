// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Liminal Staking Pool (Shared Emissions, No Fees)
/// @notice Emission starts at 380,000 LIM/day, decaying linearly to 100,000 over 30 days
contract LiminalStakingPool is Ownable, AccessControl, ReentrancyGuard {
    bytes32 public constant POOL_LOADER_ROLE = keccak256("POOL_LOADER_ROLE");
    IERC20 public immutable limToken;

    // Emission parameters
    uint256 public constant EMISSION_START = 4398148148148148148; // 380k/day
    uint256 public constant EMISSION_END = 1157407407407407407;   // 100k/day
    uint256 public constant EMISSION_DURATION = 30 days;

    uint256 public immutable startTimestamp;
    uint256 public lastRewardTime;     // last timestamp the pool was updated
    uint256 public accRewardPerShare;  // accumulated reward-per-share, scaled by 1e12

    // Pool state
    uint256 public totalStaked;        // total tokens staked
    uint256 public rewardPool;         // funded rewards available

    struct StakeInfo {
        uint256 amount;       // how many tokens the user has staked
        uint256 rewardDebt;   // user.amount * accRewardPerShare
    }

    mapping(address => StakeInfo) public stakes;

    event RewardLoaded(uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 reward);

    /// @param _limToken Address of the LIM token
    constructor(address _limToken) Ownable(msg.sender) {
        require(_limToken != address(0), "Invalid token");
        limToken = IERC20(_limToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        startTimestamp = block.timestamp;
        lastRewardTime  = block.timestamp;
    }

    /// @notice Loader deposits reward tokens into the pool
    function receiveRewardTokens(uint256 amount) external onlyRole(POOL_LOADER_ROLE) {
        require(amount > 0, "Zero amount");
        limToken.transferFrom(msg.sender, address(this), amount);
        rewardPool += amount;
        emit RewardLoaded(amount);
    }

    /// @notice Stake tokens to start earning
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Invalid amount");
        _updatePool();

        StakeInfo storage s = stakes[msg.sender];
        if (s.amount > 0) {
            uint256 pending = (s.amount * accRewardPerShare) / 1e12 - s.rewardDebt;
            if (pending > 0) {
                limToken.transfer(msg.sender, pending);
                emit Claimed(msg.sender, pending);
            }
        }

        limToken.transferFrom(msg.sender, address(this), amount);
        s.amount += amount;
        totalStaked += amount;
        s.rewardDebt = (s.amount * accRewardPerShare) / 1e12;
        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake tokens and claim rewards
    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        StakeInfo storage s = stakes[msg.sender];
        require(amount > 0 && s.amount >= amount, "Invalid unstake");

        _updatePool();
        uint256 pending = (s.amount * accRewardPerShare) / 1e12 - s.rewardDebt;
        if (pending > 0) {
            limToken.transfer(msg.sender, pending);
            emit Claimed(msg.sender, pending);
        }

        s.amount       -= amount;
        totalStaked    -= amount;
        s.rewardDebt    = (s.amount * accRewardPerShare) / 1e12;

        limToken.transfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim only rewards without unstaking
    function claim() external nonReentrant {
        _updatePool();
        StakeInfo storage s = stakes[msg.sender];
        uint256 pending = (s.amount * accRewardPerShare) / 1e12 - s.rewardDebt;
        require(pending > 0, "No reward");

        s.rewardDebt = (s.amount * accRewardPerShare) / 1e12;
        limToken.transfer(msg.sender, pending);
        emit Claimed(msg.sender, pending);
    }

    /// @dev Update pool accounting and distribute rewards
    function _updatePool() internal {
        if (block.timestamp <= lastRewardTime) return;
        uint256 elapsed = block.timestamp - lastRewardTime;
        if (totalStaked > 0) {
            uint256 reward = elapsed * currentRewardPerSecond();
            if (reward > rewardPool) {
                reward = rewardPool;
            }
            rewardPool -= reward;
            accRewardPerShare += (reward * 1e12) / totalStaked;
        }
        lastRewardTime = block.timestamp;
    }

    /// @notice View pending rewards for a user
    function pendingReward(address user) external view returns (uint256) {
        StakeInfo storage s = stakes[user];
        uint256 _acc = accRewardPerShare;
        if (block.timestamp > lastRewardTime && totalStaked > 0) {
            uint256 elapsed = block.timestamp - lastRewardTime;
            uint256 reward = elapsed * currentRewardPerSecond();
            if (reward > rewardPool) reward = rewardPool;
            _acc += (reward * 1e12) / totalStaked;
        }
        return (s.amount * _acc) / 1e12 - s.rewardDebt;
    }

    /// @notice Returns the staked amount for a given user
    function getStakedAmount(address user) external view returns (uint256 amount) {
        return stakes[user].amount;
    }

    /// @notice Computes the current emission rate per second, based on elapsed time since staking started.
    function currentRewardPerSecond() public view returns (uint256) {
        uint256 elapsed = block.timestamp - startTimestamp;
        if (elapsed >= EMISSION_DURATION) return EMISSION_END;

        uint256 diff = EMISSION_START - EMISSION_END;
        uint256 decayed = (diff * elapsed) / EMISSION_DURATION;
        return EMISSION_START - decayed;
    }

    /// @notice Manage loader role
    function grantLoaderRole(address account) external onlyOwner {
        grantRole(POOL_LOADER_ROLE, account);
    }

    function revokeLoaderRole(address account) external onlyOwner {
        revokeRole(POOL_LOADER_ROLE, account);
    }
}
