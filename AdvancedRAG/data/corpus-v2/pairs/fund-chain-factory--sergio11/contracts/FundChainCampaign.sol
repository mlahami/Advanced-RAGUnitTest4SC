// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IFundChainCampaign.sol";

/// @title FundChainCampaign Contract (with OpenZeppelin Ownable and ReentrancyGuard)
/// @author Sergio Sánchez
/// @notice A crowdfunding contract for the FundChain platform, enabling users to contribute to a campaign, withdraw funds, or claim refunds.
/// @dev This contract follows the ERC-20 compatible crowdfunding model and uses OpenZeppelin's Ownable and ReentrancyGuard for security.
contract FundChainCampaign is IFundChainCampaign, Ownable, ReentrancyGuard {

     // --- State Variables ---

    /// @notice Stores the information about the campaign
    /// @dev Uses the CampaignInfo struct to store the owner, goal amount, total contributions, deadline, and withdraw status.
    CampaignInfo private campaign;

    /// @notice Tracks the contributions made by each address
    /// @dev The mapping stores the amount of ETH contributed by each participant.
    mapping(address => uint) public override contributions;

    /// @notice Tracks the messages from contributors (if any)
    mapping(address => string) public contributorMessages;

    /// @notice Token address used for ERC20 contributions
    address public tokenAddress;

    /// @notice Tracks the paused state of the campaign
    bool public isPaused;

    // --- Constructor ---

    /// @notice Deploys a new crowdfunding campaign
    /// @dev The constructor initializes the campaign with an owner, funding goal, and duration in days.
    /// @param initialOwner The address of the campaign creator.
    /// @param _goalAmount The target funding amount in wei.
    /// @param _durationInDays The campaign duration in days.
    /// @param _minContribution The minimum contribution in wei.
    /// @param _tokenAddress The address of the ERC20 token for token contributions (0x0 if no token).
    constructor(
        address initialOwner, 
        uint _goalAmount, 
        uint _durationInDays,
        uint _minContribution,
        address _tokenAddress
    ) Ownable(initialOwner) {
        require(initialOwner != address(0), "Invalid owner address");
        require(_goalAmount > 0, "Goal amount must be greater than zero");
        require(_durationInDays > 0, "Duration must be greater than zero");
        require(_minContribution > 0, "Minimum contribution must be greater than zero");

        // Initialize the campaign details
        campaign = CampaignInfo({
            owner: initialOwner,
            goalAmount: _goalAmount,
            totalContributed: 0,
            deadline: block.timestamp + (_durationInDays * 1 days),
            isWithdrawn: false,
            minContribution: _minContribution
        });

        tokenAddress = _tokenAddress;
        isPaused = false;
    }

    // --- Modifiers ---

    /// @notice Ensures that the function is called only when the campaign is still active (before the deadline).
    modifier campaignActive() {
        require(block.timestamp < campaign.deadline, "Campaign has ended");
        require(!isPaused, "Campaign is paused");
        _;
    }

    /// @notice Ensures that the function is called only when the campaign has ended (after the deadline).
    modifier campaignEnded() {
        require(block.timestamp >= campaign.deadline, "Campaign is still active");
        _;
    }

    /// @notice Ensures that the function is called only when the campaign is not paused.
    modifier notPaused() {
        require(!isPaused, "Campaign is paused");
        _;
    }

    // --- External Functions ---

    /// This function can only be called while the campaign is active. Contributions are tracked by address.
    function contribute() external payable override campaignActive notPaused {
        require(msg.value >= campaign.minContribution, "Contribution must be greater than the minimum");

        // Track the contribution for the sender
        contributions[msg.sender] += msg.value;
        campaign.totalContributed += msg.value;

        // Emit the ContributionReceived event to notify the network
        emit ContributionReceived(msg.sender, msg.value, contributorMessages[msg.sender]);
    }

    /// This function allows contributors to use ERC20 tokens for their contributions.
    /// @param amount The amount of ERC20 tokens to contribute.
    function contributeWithToken(uint amount) external override campaignActive notPaused {
        require(amount >= campaign.minContribution, "Contribution must be greater than the minimum");
        require(tokenAddress != address(0), "No ERC20 token defined");

        IERC20 token = IERC20(tokenAddress);
        uint balanceBefore = token.balanceOf(address(this));
        
        // Transfer tokens to the contract
        token.transferFrom(msg.sender, address(this), amount);

        // Ensure tokens are transferred correctly
        uint balanceAfter = token.balanceOf(address(this));
        uint actualAmountContributed = balanceAfter - balanceBefore;

        require(actualAmountContributed == amount, "Token transfer failed");

        // Track the contribution for the sender
        contributions[msg.sender] += actualAmountContributed;
        campaign.totalContributed += actualAmountContributed;

        // Emit the ContributionReceived event to notify the network
        emit ContributionReceived(msg.sender, actualAmountContributed, contributorMessages[msg.sender]);
    }

    /// Allows the campaign owner to withdraw the funds if the funding goal is met
    function withdrawFunds() external override onlyOwner campaignEnded nonReentrant {
        require(campaign.totalContributed >= campaign.goalAmount, "Funding goal not reached");
        require(!campaign.isWithdrawn, "Funds already withdrawn");

        // Mark the campaign as withdrawn to prevent further withdrawals
        campaign.isWithdrawn = true;

        // Transfer the funds to the owner
        uint balance = address(this).balance;
        payable(owner()).transfer(balance);

        // Emit the FundsWithdrawn event to notify the network
        emit FundsWithdrawn(owner(), balance);
    }

    /// Allows contributors to claim a refund if the funding goal is not met
    function claimRefund() external override campaignEnded nonReentrant {
        require(campaign.totalContributed < campaign.goalAmount, "Funding goal was reached");

        // Get the contributor's amount to refund
        uint contributedAmount = contributions[msg.sender];
        require(contributedAmount > 0, "No contributions to refund");

        // Reset the contribution before refunding
        contributions[msg.sender] = 0;

        // Refund the contributor
        payable(msg.sender).transfer(contributedAmount);

        // Emit the RefundIssued event to notify the network
        emit RefundIssued(msg.sender, contributedAmount);
    }

    /// Allows a contributor to set a personal message when contributing
    /// @param message A message that will be attached to the contributor's contribution
    function setContributorMessage(string calldata message) external {
        contributorMessages[msg.sender] = message;
    }

    /// Returns the campaign details in a struct
    /// @return info The CampaignInfo struct containing the campaign's owner, goal amount, total contributions, deadline, and withdraw status.
    function getCampaignInfo() external view override returns (CampaignInfo memory info) {
        return campaign;
    }

    /// Returns the percentage of the total contributions made by the specified contributor
    /// @param contributor The address of the contributor
    /// @return percentage The contribution percentage relative to the total raised amount
    function getContributionPercentage(address contributor) external view override returns (uint percentage) {
        uint contributorAmount = contributions[contributor];
        if (campaign.totalContributed == 0) {
            return 0;
        }
        return (contributorAmount * 100) / campaign.totalContributed;
    }

    /// Allows the owner to update the goal amount for the campaign
    /// @param newGoal The new funding goal in wei
    function updateGoalAmount(uint newGoal) external onlyOwner {
        require(newGoal > campaign.totalContributed, "New goal must be higher than total contributed");
        campaign.goalAmount = newGoal;

        // Emit the GoalAmountUpdated event to notify the network
        emit GoalAmountUpdated(newGoal);
    }

    /// Allows the owner to pause the campaign (prevent new contributions)
    function pauseCampaign() external onlyOwner {
        isPaused = true;
    }

    /// Allows the owner to resume the campaign (allow new contributions)
    function resumeCampaign() external onlyOwner {
        isPaused = false;
    }

    /// Allows the owner to withdraw ERC20 tokens if the funding goal is met
    /// @param token The address of the ERC20 token
    /// @param amount The amount of tokens to withdraw
    function withdrawERC20(address token, uint amount) external onlyOwner campaignEnded {
        require(IERC20(token).balanceOf(address(this)) >= amount, "Insufficient token balance");
        IERC20(token).transfer(owner(), amount);
    }
}