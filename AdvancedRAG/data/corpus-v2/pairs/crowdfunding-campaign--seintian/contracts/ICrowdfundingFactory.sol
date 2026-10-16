// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ICrowdfundingFactory
 * @notice Formal interface for the Crowdfunding Factory registry and deployer.
 */
interface ICrowdfundingFactory {
    event CampaignCreated(
        address indexed campaignAddress,
        address indexed creator,
        address indexed fundingToken,
        address rewardToken,
        uint256 threshold,
        uint256 rewardRate,
        uint256 deadline,
        uint256 rewardCollateral
    );

    error InvalidTokenAddress();
    error InvalidThreshold();
    error InvalidRewardRate();
    error InvalidDuration();
    error InsufficientCollateral();

    function createCampaign(
        address fundingToken,
        address rewardToken,
        uint256 threshold,
        uint256 rewardRate,
        uint256 duration
    ) external returns (address campaignAddress);

    function getDeployedCampaigns() external view returns (address[] memory);
    function getDeployedCampaignsPaginated(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory campaigns, uint256 total);
    function getDeployedCampaignsCount() external view returns (uint256);
    function getCreatorCampaigns(address creator) external view returns (address[] memory);
    function getCreatorCampaignsPaginated(address creator, uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory campaigns, uint256 total);
    function getCreatorCampaignsCount(address creator) external view returns (uint256);
}
