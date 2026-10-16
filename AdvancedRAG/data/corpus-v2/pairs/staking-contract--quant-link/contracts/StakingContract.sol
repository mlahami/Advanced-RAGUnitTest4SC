// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title StakingContract
 * @author Quantlink Team
 * @notice This contract implements a staking mechanism for ERC20 tokens with a reward distribution system
 * @dev A professional staking contract that allows users to stake ERC20 tokens and earn rewards over time
 *
 * The contract implements a reward distribution mechanism based on the amount of tokens staked and the
 * duration of the stake. Rewards are calculated per second and distributed proportionally to all stakers
 * based on their share of the total staked amount.
 *
 * Security considerations:
 * - Uses OpenZeppelin's SafeERC20 to safely handle token transfers
 * - Implements ReentrancyGuard to prevent reentrancy attacks
 * - Implements Ownable for privileged functions like setting reward rates
 * - All state-changing functions update rewards before execution
 */
contract StakingContract is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The ERC20 token that users can stake in this contract
    /// @dev All reward calculations and distributions are also made using this token
    IERC20 public stakingToken;

    /// @notice The rate at which rewards are distributed per second
    /// @dev Measured in tokens per second, with 18 decimal precision
    uint256 public rewardRate;

    /// @notice The last timestamp when the reward calculation was updated
    /// @dev Used to calculate the time elapsed for reward distribution
    uint256 public lastUpdateTime;

    /// @notice The accumulated reward per token at the last update
    /// @dev Used in the reward calculation formula, stored with 18 extra decimals of precision
    uint256 public rewardPerTokenStored;

    /// @notice Tracks the last recorded reward per token value for each user
    /// @dev Used to calculate the rewards earned since the last update for each user
    /// @dev Stored with 18 extra decimals of precision for accurate calculations
    mapping(address => uint256) public userRewardPerTokenPaid;

    /// @notice The accumulated rewards for each user that haven't been claimed yet
    /// @dev Updated every time a user stakes, unstakes, or claims rewards
    mapping(address => uint256) public rewards;

    /// @notice The total amount of tokens staked in the contract
    /// @dev Used to calculate each user's share of the rewards
    uint256 public totalStaked;

    /// @notice The amount of tokens staked by each user
    /// @dev Key: user address, Value: staked amount
    mapping(address => uint256) public stakedBalances;

    // ==================== Events ====================

    /// @notice Emitted when a user stakes tokens
    /// @param user The address of the user who staked tokens
    /// @param amount The amount of tokens staked
    event Staked(address indexed user, uint256 amount);

    /// @notice Emitted when a user unstakes tokens
    /// @param user The address of the user who unstaked tokens
    /// @param amount The amount of tokens unstaked
    event Unstaked(address indexed user, uint256 amount);

    /// @notice Emitted when a user claims their rewards
    /// @param user The address of the user who claimed rewards
    /// @param reward The amount of rewards claimed
    event RewardClaimed(address indexed user, uint256 reward);

    /// @notice Emitted when the reward rate is updated
    /// @param newRate The new reward rate per second
    event RewardRateUpdated(uint256 newRate);

    /**
     * @notice Initializes the staking contract with the specified token and reward rate
     * @dev Sets up the contract with the token to be staked and the initial reward rate
     * @param _stakingToken The ERC20 token that will be staked and used for rewards
     * @param _rewardRate Initial reward rate per second (in tokens, with 18 decimal precision)
     */
    constructor(IERC20 _stakingToken, uint256 _rewardRate) Ownable(msg.sender) {
        require(address(_stakingToken) != address(0), "Staking token cannot be zero address");
        require(_rewardRate > 0, "Reward rate must be greater than zero");

        stakingToken = _stakingToken;
        rewardRate = _rewardRate;
        lastUpdateTime = block.timestamp;
    }

    /**
     * @notice Updates reward-related variables before executing a function
     * @dev This modifier ensures that reward calculations are up-to-date before any state changes
     *
     * The modifier performs the following operations:
     * 1. Updates the global rewardPerTokenStored based on the time elapsed since the last update
     * 2. Updates the lastUpdateTime to the current timestamp
     * 3. If an account is specified (not address(0)), updates that account's earned rewards
     *    and their userRewardPerTokenPaid value
     *
     * This modifier is applied to all state-changing functions to ensure accurate reward tracking.
     *
     * @param account The address for which to update rewards, or address(0) to only update global values
     */
    modifier updateReward(address account) {
        // Update global reward variables
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp;

        // Update account-specific reward variables if an account is specified
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /**
     * @notice Calculates the current reward per token based on time elapsed and total staked amount
     * @dev This function computes the accumulated reward per token since the last update
     *
     * The formula used is:
     * rewardPerTokenStored + ((timeElapsed * rewardRate * 1e18) / totalStaked)
     *
     * Where:
     * - rewardPerTokenStored is the previously accumulated reward per token
     * - timeElapsed is the time in seconds since the last update
     * - rewardRate is the reward rate per second
     * - 1e18 is used for precision (18 decimal places)
     * - totalStaked is the total amount of tokens staked in the contract
     *
     * If no tokens are staked (totalStaked = 0), the function returns the previously stored value
     * to avoid division by zero.
     *
     * @return The current reward per token with 18 decimal precision
     */
    function rewardPerToken() public view returns (uint256) {
        // If no tokens are staked, return the previously stored value
        if (totalStaked == 0) {
            return rewardPerTokenStored;
        }

        // Calculate the new reward per token based on time elapsed
        uint256 timeElapsed = block.timestamp - lastUpdateTime;
        uint256 rewardForPeriod = (timeElapsed * rewardRate * 1e18) / totalStaked;

        return rewardPerTokenStored + rewardForPeriod;
    }

    /**
     * @notice Calculates the total rewards earned by an account
     * @dev This function computes the total rewards earned by an account based on their stake
     *
     * The formula used is:
     * ((stakedBalance * (rewardPerToken - userRewardPerTokenPaid)) / 1e18) + existingRewards
     *
     * Where:
     * - stakedBalance is the amount of tokens staked by the account
     * - rewardPerToken is the current reward per token (from rewardPerToken())
     * - userRewardPerTokenPaid is the last recorded reward per token for this account
     * - 1e18 is used to adjust for the precision in rewardPerToken
     * - existingRewards is the previously accumulated rewards for this account
     *
     * This calculation accounts for both newly earned rewards since the last update and
     * previously accumulated rewards that haven't been claimed yet.
     *
     * @param account The address to calculate rewards for
     * @return The total amount of rewards earned by the account
     */
    function earned(address account) public view returns (uint256) {
        // Calculate newly earned rewards based on the stake and reward per token difference
        uint256 currentRewardPerToken = rewardPerToken();
        uint256 rewardPerTokenDifference = currentRewardPerToken - userRewardPerTokenPaid[account];
        uint256 newlyEarned = (stakedBalances[account] * rewardPerTokenDifference) / 1e18;

        // Add newly earned rewards to previously accumulated rewards
        return newlyEarned + rewards[account];
    }

    /**
     * @notice Allows a user to stake tokens in the contract
     * @dev Stakes the specified amount of tokens and updates the user's rewards
     *
     * This function:
     * 1. Updates the user's rewards before staking (via the updateReward modifier)
     * 2. Transfers the specified amount of tokens from the user to the contract
     * 3. Updates the user's staked balance and the total staked amount
     * 4. Emits a Staked event
     *
     * Requirements:
     * - The amount must be greater than 0
     * - The user must have approved the contract to transfer the tokens
     * - The user must have sufficient token balance
     *
     * Security considerations:
     * - Uses nonReentrant modifier to prevent reentrancy attacks
     * - Uses SafeERC20 for secure token transfers
     * - Updates rewards before any state changes
     *
     * @param amount The amount of tokens to stake
     */
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");

        // Update state variables
        totalStaked += amount;
        stakedBalances[msg.sender] += amount;

        // Transfer tokens from sender to this contract
        // This will revert if the user hasn't approved enough tokens or has insufficient balance
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        // Emit staking event
        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Allows a user to unstake tokens from the contract
     * @dev Unstakes the specified amount of tokens and updates the user's rewards
     *
     * This function:
     * 1. Updates the user's rewards before unstaking (via the updateReward modifier)
     * 2. Reduces the user's staked balance and the total staked amount
     * 3. Transfers the specified amount of tokens back to the user
     * 4. Emits an Unstaked event
     *
     * Requirements:
     * - The amount must be greater than 0
     * - The user must have at least the specified amount of tokens staked
     *
     * Security considerations:
     * - Uses nonReentrant modifier to prevent reentrancy attacks
     * - Uses SafeERC20 for secure token transfers
     * - Updates rewards before any state changes
     * - Checks user's staked balance before unstaking
     *
     * @param amount The amount of tokens to unstake
     */
    function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot unstake 0");
        require(stakedBalances[msg.sender] >= amount, "Not enough staked tokens");

        // Update state variables
        totalStaked -= amount;
        stakedBalances[msg.sender] -= amount;

        // Transfer tokens back to sender
        stakingToken.safeTransfer(msg.sender, amount);

        // Emit unstaking event
        emit Unstaked(msg.sender, amount);
    }

    /**
     * @notice Allows a user to claim their accumulated rewards
     * @dev Claims all accumulated rewards for the caller and transfers them to the caller's address
     *
     * This function:
     * 1. Updates the user's rewards before claiming (via the updateReward modifier)
     * 2. Retrieves the user's accumulated rewards
     * 3. If rewards are greater than 0:
     *    a. Resets the user's rewards to 0
     *    b. Transfers the rewards to the user
     *    c. Emits a RewardClaimed event
     *
     * Security considerations:
     * - Uses nonReentrant modifier to prevent reentrancy attacks
     * - Uses SafeERC20 for secure token transfers
     * - Updates rewards before any state changes
     * - Only transfers rewards if they are greater than 0
     */
    function claimReward() external nonReentrant updateReward(msg.sender) {
        // Get the accumulated rewards for the caller
        uint256 reward = rewards[msg.sender];

        // Only process if there are rewards to claim
        if (reward > 0) {
            // Reset rewards to 0 before transfer to prevent reentrancy issues
            rewards[msg.sender] = 0;

            // Transfer rewards to the caller
            stakingToken.safeTransfer(msg.sender, reward);

            // Emit reward claimed event
            emit RewardClaimed(msg.sender, reward);
        }
    }

    /**
     * @notice Allows the owner to update the reward rate
     * @dev Sets a new reward rate per second for future reward calculations
     *
     * This function:
     * 1. Updates all reward calculations with the current rate (via the updateReward modifier)
     * 2. Sets the new reward rate
     * 3. Emits a RewardRateUpdated event
     *
     * The updateReward modifier ensures that all reward calculations are finalized with the
     * old rate before switching to the new rate.
     *
     * Requirements:
     * - Can only be called by the contract owner
     * - New reward rate must be greater than 0
     *
     * @param _rewardRate New reward rate per second (in tokens, with 18 decimal precision)
     */
    function setRewardRate(uint256 _rewardRate) external onlyOwner updateReward(address(0)) {
        require(_rewardRate > 0, "Reward rate must be greater than zero");
        rewardRate = _rewardRate;
        emit RewardRateUpdated(_rewardRate);
    }

    /**
     * @notice Returns the amount of tokens staked by a specific account
     * @dev View function to check how many tokens an account has staked
     *
     * This is a convenience function that directly returns the value from the stakedBalances mapping.
     *
     * @param account The address to check the staked balance for
     * @return The amount of tokens staked by the specified account
     */
    function getStakedBalance(address account) external view returns (uint256) {
        return stakedBalances[account];
    }

    /**
     * @notice Returns the total amount of tokens staked in the contract
     * @dev View function to check the total staked amount across all users
     *
     * This is a convenience function that directly returns the totalStaked state variable.
     *
     * @return The total amount of tokens staked in the contract
     */
    function getTotalStaked() external view returns (uint256) {
        return totalStaked;
    }

    /**
     * @notice Returns the current reward rate per second
     * @dev View function to check the current reward distribution rate
     *
     * @return The current reward rate per second (in tokens, with 18 decimal precision)
     */
    function getRewardRate() external view returns (uint256) {
        return rewardRate;
    }

    /**
     * @notice Calculates the estimated daily rewards for an account
     * @dev View function to help users estimate their daily rewards based on current conditions
     *
     * The calculation assumes that:
     * - The total staked amount remains constant
     * - The reward rate remains constant
     * - The account's staked balance remains constant
     *
     * @param account The address to calculate estimated daily rewards for
     * @return The estimated amount of tokens the account would earn in one day
     */
    function getEstimatedDailyRewards(address account) external view returns (uint256) {
        if (totalStaked == 0 || stakedBalances[account] == 0) {
            return 0;
        }

        // Calculate the user's share of the total staked amount
        uint256 userShare = (stakedBalances[account] * 1e18) / totalStaked;

        // Calculate daily rewards (86400 seconds in a day)
        uint256 dailyRewards = (rewardRate * 86400 * userShare) / 1e18;

        return dailyRewards;
    }
}
