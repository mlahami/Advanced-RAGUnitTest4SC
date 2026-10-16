// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICrowdfundingCampaign} from "./ICrowdfundingCampaign.sol";

/**
 * @title CrowdfundingCampaign
 * @notice Production-grade, autonomous All-or-Nothing escrow smart contract.
 * @dev Implements strict state machine transitions, CEI, SafeERC20, and ReentrancyGuard.
 */
contract CrowdfundingCampaign is ICrowdfundingCampaign, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Precision scalar for reward rate calculations (1e18)
    uint256 public constant RATE_PRECISION = 1e18;

    /// @notice The ERC-20 token accepted for funding pledges
    IERC20 public immutable override fundingToken;

    /// @notice The ERC-20 token distributed to backers as rewards
    IERC20 public immutable override rewardToken;

    /// @notice Address of the project creator / proposer
    address public immutable override creator;

    /// @notice Funding target in fundingToken base units
    uint256 public immutable override threshold;

    /// @notice Reward exchange rate scaled by RATE_PRECISION
    uint256 public immutable override rewardRate;

    /// @notice Unix timestamp after which pledges close
    uint256 public immutable override deadline;

    /// @notice Required reward collateral deposited by creator at launch
    uint256 public immutable override rewardCollateral;

    /// @notice Aggregate amount of funding tokens currently pledged
    uint256 public override totalRaised;

    /// @notice Aggregate amount of reward tokens claimed by backers
    uint256 public override totalRewardsClaimed;

    /// @notice Whether the creator has withdrawn the raised funds upon success
    bool public override creatorFundsClaimed;

    /// @notice Whether the creator has recovered their reward collateral upon expiration
    bool public override creatorCollateralRecovered;

    /// @notice Ledger tracking individual backer contributions
    mapping(address => uint256) public override contributions;

    /// @notice Tracks whether a backer has claimed their rewards
    mapping(address => bool) public override rewardsClaimed;

    /// @notice Tracks whether a backer has claimed their refund
    mapping(address => bool) public override refundsClaimed;

    /**
     * @notice Deploys an autonomous CrowdfundingCampaign instance.
     * @param _creator Address of the campaign creator
     * @param _fundingToken ERC-20 token address used for funding
     * @param _rewardToken ERC-20 token address used for rewards
     * @param _threshold Target funding amount in fundingToken units
     * @param _rewardRate Reward token multiplier scaled by 1e18
     * @param _deadline Unix timestamp representing the campaign deadline
     */
    constructor(
        address _creator,
        address _fundingToken,
        address _rewardToken,
        uint256 _threshold,
        uint256 _rewardRate,
        uint256 _deadline
    ) {
        if (_creator == address(0) || _fundingToken == address(0) || _rewardToken == address(0)) {
            revert InvalidConfiguration();
        }
        if (_threshold == 0 || _rewardRate == 0) {
            revert InvalidConfiguration();
        }
        if (_deadline <= block.timestamp) {
            revert DeadlinePassed();
        }

        creator = _creator;
        fundingToken = IERC20(_fundingToken);
        rewardToken = IERC20(_rewardToken);
        threshold = _threshold;
        rewardRate = _rewardRate;
        deadline = _deadline;

        // Calculate exact 100% upfront collateral requirement
        rewardCollateral = (_threshold * _rewardRate) / RATE_PRECISION;
        if (rewardCollateral == 0) {
            revert InvalidConfiguration();
        }
    }

    /**
     * @notice Computes the current lifecycle state of the campaign.
     * @return Current State: Active, Successful, or Expired
     */
    function state() public view override returns (State) {
        if (totalRaised >= threshold) {
            return State.Successful;
        }
        if (block.timestamp >= deadline) {
            return State.Expired;
        }
        return State.Active;
    }

    /**
     * @notice Pledges funding tokens to the active campaign.
     * @dev Enforces All-or-Nothing invariants, checks cap, and follows CEI.
     * @param amount The quantity of funding tokens to contribute
     */
    function pledge(uint256 amount) external override nonReentrant {
        if (state() != State.Active) {
            revert CampaignNotActive();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        // Measure actual balance delta received to protect against fee-on-transfer tokens
        uint256 balanceBefore = fundingToken.balanceOf(address(this));
        fundingToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actualReceived = fundingToken.balanceOf(address(this)) - balanceBefore;

        if (actualReceived == 0) {
            revert ZeroAmount();
        }
        if (totalRaised + actualReceived > threshold) {
            revert ThresholdExceeded();
        }

        // Checks & Effects
        contributions[msg.sender] += actualReceived;
        totalRaised += actualReceived;

        emit Pledged(msg.sender, actualReceived, totalRaised);
    }

    /**
     * @notice Allows backers to withdraw their contributed funds before threshold is reached.
     * @dev Flexible withdrawal invariant: active while totalRaised < threshold and before deadline.
     * @param amount The amount of funding tokens to withdraw
     */
    function withdrawBeforeThreshold(uint256 amount) external override nonReentrant {
        if (state() != State.Active) {
            revert CampaignNotActive();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (contributions[msg.sender] < amount) {
            revert InsufficientContribution();
        }

        // Checks & Effects
        contributions[msg.sender] -= amount;
        totalRaised -= amount;

        emit WithdrawnBeforeThreshold(msg.sender, amount, totalRaised);

        // Interaction
        fundingToken.safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Allows a backer to claim reward tokens if the campaign succeeded.
     * @dev Implements Pull-over-Push pattern to prevent gas limit DoS.
     */
    function claimReward() external override nonReentrant {
        if (state() != State.Successful) {
            revert CampaignNotSuccessful();
        }
        if (rewardsClaimed[msg.sender]) {
            revert RewardsAlreadyClaimed();
        }

        uint256 backerContribution = contributions[msg.sender];
        if (backerContribution == 0) {
            revert InsufficientContribution();
        }

        // Effects
        rewardsClaimed[msg.sender] = true;
        uint256 rewardAmount = calculateReward(backerContribution);
        totalRewardsClaimed += rewardAmount;

        emit RewardsClaimed(msg.sender, rewardAmount);

        // Interaction
        rewardToken.safeTransfer(msg.sender, rewardAmount);
    }

    /**
     * @notice Allows a backer to claim a 100% refund if the campaign expired without reaching threshold.
     * @dev Guarantees full principal recovery under All-or-Nothing mechanics.
     */
    function claimRefund() external override nonReentrant {
        if (state() != State.Expired) {
            revert CampaignNotExpired();
        }
        if (refundsClaimed[msg.sender]) {
            revert RefundsAlreadyClaimed();
        }

        uint256 backerContribution = contributions[msg.sender];
        if (backerContribution == 0) {
            revert InsufficientContribution();
        }

        // Effects
        refundsClaimed[msg.sender] = true;

        emit RefundClaimed(msg.sender, backerContribution);

        // Interaction
        fundingToken.safeTransfer(msg.sender, backerContribution);
    }

    /**
     * @notice Allows the creator to withdraw total funding tokens once the campaign succeeds.
     */
    function claimFunds() external override nonReentrant {
        if (msg.sender != creator) {
            revert Unauthorized();
        }
        if (state() != State.Successful) {
            revert CampaignNotSuccessful();
        }
        if (creatorFundsClaimed) {
            revert CreatorFundsAlreadyClaimed();
        }

        // Effects
        creatorFundsClaimed = true;
        uint256 fundsToClaim = totalRaised;

        emit CreatorFundsClaimed(creator, fundsToClaim);

        // Interaction
        fundingToken.safeTransfer(creator, fundsToClaim);
    }

    /**
     * @notice Allows the creator to recover their deposited reward collateral if the campaign expires.
     */
    function recoverCollateral() external override nonReentrant {
        if (msg.sender != creator) {
            revert Unauthorized();
        }
        if (state() != State.Expired) {
            revert CampaignNotExpired();
        }
        if (creatorCollateralRecovered) {
            revert CreatorCollateralAlreadyRefunded();
        }

        // Effects
        creatorCollateralRecovered = true;

        emit CreatorCollateralRecovered(creator, rewardCollateral);

        // Interaction
        rewardToken.safeTransfer(creator, rewardCollateral);
    }

    /**
     * @notice Allows the creator to recover unallocated reward tokens and rounding dust in a successful campaign.
     * @dev Calculates remaining maximum backer liability and sweeps only true surplus.
     */
    function recoverExcessRewards() external override nonReentrant {
        if (msg.sender != creator) {
            revert Unauthorized();
        }
        if (state() != State.Successful) {
            revert CampaignNotSuccessful();
        }

        uint256 remainingLiability = rewardCollateral - totalRewardsClaimed;
        uint256 currentBalance = rewardToken.balanceOf(address(this));

        if (currentBalance <= remainingLiability) {
            revert NoExcessRewards();
        }

        uint256 excessAmount = currentBalance - remainingLiability;

        emit ExcessRewardsRecovered(creator, excessAmount);

        rewardToken.safeTransfer(creator, excessAmount);
    }

    /**
     * @notice Pure mathematical calculation of reward tokens owed for a given contribution.
     * @param contributionAmount The amount of funding tokens contributed
     * @return The amount of reward tokens owed
     */
    function calculateReward(uint256 contributionAmount) public view override returns (uint256) {
        return (contributionAmount * rewardRate) / RATE_PRECISION;
    }

    /**
     * @notice Returns remaining funding tokens needed to meet the threshold.
     * @return 0 if threshold is met or exceeded, otherwise threshold - totalRaised
     */
    function remainingToThreshold() external view override returns (uint256) {
        if (totalRaised >= threshold) {
            return 0;
        }
        return threshold - totalRaised;
    }
}
