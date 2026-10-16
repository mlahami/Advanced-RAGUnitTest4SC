// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FundChainCampaign Interface with Structs and Additional Features
/// @author 
/// @notice Interface for interacting with a FundChain crowdfunding campaign
/// @dev Defines all public methods, events, and data structures for external interaction, including new features like token contributions, contribution messages, and more.
interface IFundChainCampaign {

    // --- Structs ---

    /// @notice Represents basic information about a crowdfunding campaign
    struct CampaignInfo {
        address owner;             // Creator of the campaign
        uint goalAmount;           // Funding goal in wei
        uint totalContributed;     // Total amount of wei contributed so far
        uint deadline;             // Timestamp when the campaign ends
        bool isWithdrawn;          // Whether the campaign funds have been withdrawn
        uint minContribution;      // Minimum contribution allowed in wei
    }

    // --- Events ---

    /// @notice Emitted when a contribution is made
    /// @param contributor The address of the contributor
    /// @param amount The amount of ETH contributed
    /// @param message A personal message attached by the contributor (if any)
    event ContributionReceived(address indexed contributor, uint amount, string message);

    /// @notice Emitted when the campaign owner withdraws the collected funds
    /// @param owner The address of the campaign owner
    /// @param amount The amount of ETH withdrawn
    event FundsWithdrawn(address indexed owner, uint amount);

    /// @notice Emitted when a refund is issued to a contributor
    /// @param contributor The address receiving the refund
    /// @param amount The amount of ETH refunded
    event RefundIssued(address indexed contributor, uint amount);

    /// @notice Emitted when the funding goal is updated
    /// @param newGoal The new funding goal in wei
    event GoalAmountUpdated(uint newGoal);

    // --- External Functions ---

    /// @notice Contribute ETH to the campaign
    /// @dev Only possible while the campaign is active (before deadline) and the contribution is above the minimum required.
    function contribute() external payable;

    /// @notice Contribute ERC20 tokens to the campaign
    /// @dev Allows contributions in a specified ERC20 token instead of ETH. Only possible if the campaign is active and meets the minimum required contribution.
    /// @param amount The amount of tokens to contribute
    function contributeWithToken(uint amount) external;

    /// @notice Withdraw the raised funds to the owner if the funding goal is met
    /// @dev Only callable by the owner after the campaign ends successfully.
    function withdrawFunds() external;

    /// @notice Claim a refund if the funding goal was not reached
    /// @dev Only callable after the campaign ends unsuccessfully.
    function claimRefund() external;

    /// @notice Retrieve basic details about the campaign
    /// @return info A struct containing the campaign's basic information
    function getCampaignInfo() external view returns (CampaignInfo memory info);

    /// @notice Get the contribution amount for a specific address
    /// @param contributor The address to check
    /// @return amount The total amount contributed by the given address
    function contributions(address contributor) external view returns (uint amount);

    /// @notice Get the contribution percentage for a specific address based on the goal amount
    /// @param contributor The address to check
    /// @return percentage The percentage of the total goal contributed by the given address
    function getContributionPercentage(address contributor) external view returns (uint percentage);

    /// @notice Update the goal amount for the campaign
    /// @dev Allows the owner to increase the goal amount. Can only be called if the goal hasn't been reached yet.
    /// @param newGoal The new funding goal in wei
    function updateGoalAmount(uint newGoal) external;

    /// @notice Allow the owner to pause the campaign (prevent new contributions)
    /// @dev Only callable by the owner
    function pauseCampaign() external;

    /// @notice Allow the owner to resume the campaign (allow new contributions)
    /// @dev Only callable by the owner
    function resumeCampaign() external;

    /// @notice Set a personal message for the contributor when making a contribution
    /// @param message A message that will be attached to the contributor's contribution
    function setContributorMessage(string calldata message) external;
}