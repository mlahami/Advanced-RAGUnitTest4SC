// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./FundChainCampaign.sol";
import "./IFundChainFactory.sol";

/// @title FundChainFactory Contract
/// @notice Manages the creation and registration of crowdfunding campaigns in the FundChain platform.
/// @dev Ensures that each owner can only create a maximum of 3 campaigns.
contract FundChainFactory is IFundChainFactory {

    // --- State Variables ---

    // Mapping of owner addresses to the list of campaigns they have created
    mapping(address => address[]) private ownerCampaigns;
    
    // Maximum number of campaigns a single owner can create
    uint public constant MAX_CAMPAIGNS_PER_OWNER = 3;

    // Array to store all deployed campaigns globally
    address[] public deployedCampaigns;

    // --- External Functions ---

    /// @notice Creates a new crowdfunding campaign
    /// @param _goalAmount The goal amount (in wei) that the campaign aims to raise
    /// @param _durationInDays The number of days the campaign will run for
    /// @param _minContribution The minimum contribution allowed for the campaign in wei
    /// @param _tokenAddress The address of the ERC20 token to be used for contributions (or 0x0 if no token)
    /// @return campaignAddress The address of the newly created campaign contract
    function createCampaign(
        uint _goalAmount,
        uint _durationInDays,
        uint _minContribution,
        address _tokenAddress
    ) external override returns (address campaignAddress) {
        // Ensure the owner does not exceed the max campaign limit
        require(ownerCampaigns[msg.sender].length < MAX_CAMPAIGNS_PER_OWNER, "Max number of campaigns reached for this owner.");

        // Deploy the new campaign contract with all the parameters, including the new ones
        FundChainCampaign newCampaign = new FundChainCampaign(
            msg.sender, 
            _goalAmount, 
            _durationInDays, 
            _minContribution, 
            _tokenAddress
        );
        
        // Add the campaign address to the list of campaigns for the owner
        ownerCampaigns[msg.sender].push(address(newCampaign));
        
        // Add the new campaign to the global list of deployed campaigns
        deployedCampaigns.push(address(newCampaign));

        // Emit event for campaign creation
        emit CampaignCreated(
            address(newCampaign), 
            msg.sender, 
            _goalAmount,
            block.timestamp + (_durationInDays * 1 days),
            _minContribution,
            _tokenAddress
        );

        // Return the address of the newly created campaign
        return address(newCampaign);
    }

    /// @notice Returns the list of all campaigns created by a specific owner
    /// @param owner The address of the campaign owner
    /// @return An array containing the addresses of all campaigns created by the specified owner
    function getOwnerCampaigns(address owner) external view override returns (address[] memory) {
        return ownerCampaigns[owner];
    }

    /// @notice Returns the total number of campaigns created by a specific owner
    /// @param owner The address of the campaign owner
    /// @return The total number of campaigns created by the specified owner
    function getOwnerCampaignCount(address owner) external view override returns (uint) {
        return ownerCampaigns[owner].length;
    }

    /// @notice Returns the list of all deployed campaigns
    /// @return An array containing the addresses of all deployed campaigns
    function getAllCampaigns() external view override returns (address[] memory) {
        return deployedCampaigns;
    }

    /// @notice Returns the maximum number of campaigns a single owner can create
    /// @return The maximum number of campaigns allowed per owner (3 in this case)
    function maxCampaignsPerOwner() external pure override returns (uint) {
        return MAX_CAMPAIGNS_PER_OWNER;
    }
}