// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFundChainFactory {

    // --- Events ---

    /// @notice Emitted when a new campaign is created
    /// @param campaignAddress The address of the newly created campaign contract
    /// @param creator The address of the campaign creator
    /// @param goal The funding goal of the campaign
    /// @param deadline The timestamp when the campaign ends
    /// @param minContribution The minimum contribution amount in wei for the campaign
    /// @param tokenAddress The address of the ERC20 token used for contributions (if applicable)
    event CampaignCreated(
        address indexed campaignAddress,
        address indexed creator,
        uint goal,
        uint deadline,
        uint minContribution,
        address tokenAddress
    );

    // --- External Functions ---

    /// @notice Creates a new crowdfunding campaign on the FundChain platform.
    /// @param _goalAmount The target amount in wei that the campaign aims to raise.
    /// @param _durationInDays The duration of the campaign in days from the current block timestamp.
    /// @param _minContribution The minimum contribution allowed in wei for the campaign.
    /// @param _tokenAddress The address of the ERC20 token to be used for contributions, or 0x0 if no token is used.
    /// @dev This function deploys a new instance of the FundChainCampaign contract and tracks it in the factory.
    /// @dev Emits the CampaignCreated event with details of the new campaign.
    /// @return campaignAddress The address of the newly created campaign contract.
    function createCampaign(
        uint _goalAmount,
        uint _durationInDays,
        uint _minContribution,
        address _tokenAddress
    ) external returns (address campaignAddress);

    /// @notice Returns the list of all campaigns created by a specific owner.
    /// @param owner The address of the campaign owner.
    /// @return An array containing the addresses of all campaigns created by the owner.
    function getOwnerCampaigns(address owner) external view returns (address[] memory);

    /// @notice Returns the total number of campaigns created by a specific owner.
    /// @param owner The address of the campaign owner.
    /// @return The total number of campaigns created by the owner.
    function getOwnerCampaignCount(address owner) external view returns (uint);

    /// @notice Returns the list of all deployed crowdfunding campaign addresses.
    /// @return An array containing the addresses of all deployed campaigns.
    function getAllCampaigns() external view returns (address[] memory);

    /// @notice Returns the maximum number of campaigns a single owner can create.
    /// @return The maximum number of campaigns allowed per owner.
    function maxCampaignsPerOwner() external view returns (uint);
}