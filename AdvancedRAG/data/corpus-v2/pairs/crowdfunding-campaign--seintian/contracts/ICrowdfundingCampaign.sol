// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ICrowdfundingCampaign
 * @notice Formal interface for autonomous All-or-Nothing Crowdfunding Campaign instances.
 */
interface ICrowdfundingCampaign {
    /// @notice State machine definitions for the campaign lifecycle
    enum State {
        Active,
        Successful,
        Expired
    }

    // --- Events ---
    event Pledged(address indexed backer, uint256 amount, uint256 newTotalRaised);
    event WithdrawnBeforeThreshold(address indexed backer, uint256 amount, uint256 newTotalRaised);
    event RewardsClaimed(address indexed backer, uint256 rewardAmount);
    event RefundClaimed(address indexed backer, uint256 refundAmount);
    event CreatorFundsClaimed(address indexed creator, uint256 fundsAmount);
    event CreatorCollateralRecovered(address indexed creator, uint256 collateralAmount);
    event ExcessRewardsRecovered(address indexed creator, uint256 amount);

    // --- Custom Errors ---
    error CampaignNotActive();
    error CampaignNotSuccessful();
    error CampaignNotExpired();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error ThresholdAlreadyReached();
    error ThresholdNotReached();
    error ThresholdExceeded();
    error ZeroAmount();
    error InsufficientContribution();
    error RewardsAlreadyClaimed();
    error RefundsAlreadyClaimed();
    error CreatorFundsAlreadyClaimed();
    error CreatorCollateralAlreadyRefunded();
    error NoExcessRewards();
    error Unauthorized();
    error InvalidConfiguration();

    // --- Mutating Functions ---
    function pledge(uint256 amount) external;
    function withdrawBeforeThreshold(uint256 amount) external;
    function claimReward() external;
    function claimRefund() external;
    function claimFunds() external;
    function recoverCollateral() external;
    function recoverExcessRewards() external;

    // --- View Functions ---
    function state() external view returns (State);
    function fundingToken() external view returns (IERC20);
    function rewardToken() external view returns (IERC20);
    function creator() external view returns (address);
    function threshold() external view returns (uint256);
    function rewardRate() external view returns (uint256);
    function deadline() external view returns (uint256);
    function rewardCollateral() external view returns (uint256);
    function totalRaised() external view returns (uint256);
    function totalRewardsClaimed() external view returns (uint256);
    function contributions(address backer) external view returns (uint256);
    function rewardsClaimed(address backer) external view returns (bool);
    function refundsClaimed(address backer) external view returns (bool);
    function creatorFundsClaimed() external view returns (bool);
    function creatorCollateralRecovered() external view returns (bool);
    function calculateReward(uint256 contributionAmount) external view returns (uint256);
    function remainingToThreshold() external view returns (uint256);
}
