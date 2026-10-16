// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ICrowdfunding.sol";
import "./IStaking.sol";

/// @title Staking Contract for Token Holders
/// @notice This contract allows users to stake their tokens for a period of time and earn rewards based on the duration of staking.
/// @dev This contract uses ReentrancyGuard from OpenZeppelin to prevent reentrancy attacks.
contract Staking is ReentrancyGuard, IStaking {
    IERC20 public stakingToken;
    ICrowdfunding public crowdfunding;

    /// Staking durations in seconds.
    uint256 public constant ONE_MONTH = 2592000;
    uint256 public constant THREE_MONTHS = ONE_MONTH * 3;
    uint256 public constant SIX_MONTHS = ONE_MONTH * 6;

    /// Rewards rates as a percentage for different staking durations.
    uint256 public constant REWARD_RATE_ONE_MONTH = 10;
    uint256 public constant REWARD_RATE_THREE_MONTHS = 15;
    uint256 public constant REWARD_RATE_SIX_MONTHS = 25;

    /// @notice A struct to store details of each stake.
    struct Stake {
        uint256 amount; // Amount of tokens staked
        uint256 startTime; // When the staking started
        uint256 duration; // Duration for which tokens are staked
    }

    /// Mapping from staker address to their stake details.
    mapping(address => Stake) public stakes;

    /// Events for staking, reinvesting rewards, and claiming rewards.
    event Staked(address indexed staker, uint256 amount, uint256 duration);
    event RewardReinvested(address indexed staker, uint256 campaignId, uint256 amount);
    event RewardClaimed(address indexed staker, uint256 amount);

    /// @notice Creates a new Staking contract instance.
    /// @param _stakingToken The ERC20 token that will be staked.
    /// @param _crowdfundingContract The crowdfunding contract with which the staked funds may interact.
    constructor(address _stakingToken, address _crowdfundingContract) {
        stakingToken = IERC20(_stakingToken);
        crowdfunding = ICrowdfunding(_crowdfundingContract);
    }

    /// @notice Allows a user to stake tokens for a specified duration.
    /// @param _amount The amount of tokens to stake.
    /// @param _duration The duration for which to stake the tokens.
    /// @dev Emits a Staked event on successful staking.
    function stakeTokens(uint256 _amount, uint256 _duration) external nonReentrant {
        require(_amount > 0, "Amount must be more than 0");
        require(_duration == ONE_MONTH || _duration == THREE_MONTHS || _duration == SIX_MONTHS, "Invalid staking duration");

        stakes[msg.sender] = Stake(_amount, block.timestamp, _duration);
        stakingToken.transferFrom(msg.sender, address(this), _amount);

        emit Staked(msg.sender, _amount, _duration);
    }

    /// @notice Calculates the reward for a staker based on their stake details.
    /// @param _staker The address of the staker.
    /// @return reward The calculated reward.
    /// @dev The reward is calculated as a percentage of the staked amount, prorated by the staking duration.
    function calculateReward(address _staker) public view returns (uint256) {
        Stake storage stake = stakes[_staker];
        uint256 rewardRate;

        if (stake.duration == ONE_MONTH) {
            rewardRate = REWARD_RATE_ONE_MONTH;
        } else if (stake.duration == THREE_MONTHS) {
            rewardRate = REWARD_RATE_THREE_MONTHS;
        } else if (stake.duration == SIX_MONTHS) {
            rewardRate = REWARD_RATE_SIX_MONTHS;
        }

        uint256 stakingPeriod = block.timestamp > (stake.startTime + stake.duration) ? stake.duration : block.timestamp - stake.startTime;
        uint256 reward = stake.amount * rewardRate * stakingPeriod / (ONE_MONTH * 12) / 100;

        return reward;
    }

    /// @notice Allows a staker to reinvest their rewards into a crowdfunding campaign.
    /// @param campaignId The ID of the crowdfunding campaign to invest in.
    /// @param bonusRate An additional bonus rate applied to the reinvested amount.
    /// @dev Emits a RewardReinvested event on successful reinvestment.
    function reinvestReward(uint256 campaignId, uint256 bonusRate) external nonReentrant {
        uint256 reward = calculateReward(msg.sender);
        require(reward > 0, "No rewards available");

        uint256 bonus = reward * bonusRate / 100;
        uint256 totalInvestment = reward + bonus;

        stakes[msg.sender].amount = 0;

        stakingToken.approve(address(crowdfunding), totalInvestment);
        crowdfunding.fundCampaignWithToken(campaignId, totalInvestment);

        emit RewardReinvested(msg.sender, campaignId, totalInvestment);
    }

    /// @notice Allows a staker to claim their accumulated rewards.
    /// @dev Emits a RewardClaimed event on successful claim.
    function claimReward() external nonReentrant {
        uint256 reward = calculateReward(msg.sender);
        require(reward > 0, "No rewards available");

        uint256 contractBalance = stakingToken.balanceOf(address(this));
        require(contractBalance >= reward, "Insufficient funds in the contract");

        stakes[msg.sender].amount = 0;
        stakes[msg.sender].startTime = 0;
        stakes[msg.sender].duration = 0;

        stakingToken.transfer(msg.sender, reward);

        emit RewardClaimed(msg.sender, reward);
    }

}
