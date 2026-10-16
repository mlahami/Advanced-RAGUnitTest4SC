// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

error CrowdFunding__WithdrawFailed();


/// @title A crowdfunding platform for environmental projects
/// @notice This contract allows users to create, fund, and manage campaigns for environmental causes
/// @dev Extends OpenZeppelin's ReentrancyGuard for protection against re-entrancy attacks

contract Crowdfunding is ReentrancyGuard {
    IERC20 public leafToken;

    /// @notice Structure to store campaign details
    struct Campaign {
        string name;
        string description;
        string image;
        address payable creator;
        uint256 startAt;
        uint256 endAt;
        uint256 id;
        uint256 targetAmount;
        uint256 amountCollected;
        uint256 amountWithdrawnByOwner;
        bool isActive;
        bool claimedByOwner;
    }


    uint256 private constant THIRTY_DAYS = 2592000; // 30 days in seconds
    uint256 public constant RATE = 100; // Rate of LEAF tokens per ETH

    uint256 public campaignsCount;
    Campaign[] public campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(uint256 => mapping(address => bool)) public rewardsClaimed;

    /// @notice Emitted when a new campaign is created
    event CampaignCreated(uint256 indexed campaignId, address indexed creator, uint256 indexed targetAmount, uint256 startAt, uint256 endAt);
    /// @notice Emitted when a campaign is updated
    event CampaignUpdated(uint256 indexed campaignId, address indexed creator, uint256 indexed targetAmount, uint256 startAt, uint256 endAt);
    /// @notice Emitted when a campaign's active status is changed
    event CampaignActiveStatusChanged(uint256 indexed campaignId, address indexed creator, bool indexed isActive);
    /// @notice Emitted when a campaign is funded
    event CampaignFunded(uint256 indexed campaignId, address indexed funder, uint256 indexed amount);
    /// @notice Emitted when a campaign is funded with tokens
    event CampaignFundedWithToken(uint256 indexed campaignId, address indexed funder, uint256 indexed amount);
    /// @notice Emitted when funds are successfully withdrawn by the campaign creator
    event WithdrawSuccessful(uint256 indexed campaignId, address indexed owner, uint256 indexed amount);
    /// @notice Emitted when a refund is issued to a contributor
    event RefundIssued(uint256 indexed campaignId, address indexed funder, uint256 indexed amount);
    /// @notice Emitted when a reward is claimed by a contributor
    event RewardClaimed(address indexed claimant, uint256 indexed campaignId, uint256 reward);

    /// @dev Sets the LeafToken contract address upon deployment
    /// @param _leafToken Address of the LeafToken contract
    constructor(address _leafToken) {
        leafToken = IERC20(_leafToken);
    }

    /// @dev Modifier to restrict function access to the campaign creator
    modifier onlyCreator(uint256 campaignId) {
        require(campaigns[campaignId].creator == msg.sender, "Only the campaign creator can call this function.");
        _;
    }

    /// @dev Modifier to check if the caller has contributed to the campaign
    modifier onlyContributor(uint256 campaignId) {
        require(contributions[campaignId][msg.sender] > 0, "Not a contributor");
        _;
    }

    /// @notice Allows a user to create a new campaign
    /// @param _name Name of the campaign
    /// @param _description Description of the campaign
    /// @param _targetAmount Target funding amount in wei
    /// @param _startAt Campaign start time in UNIX timestamp
    /// @param _endAt Campaign end time in UNIX timestamp
    /// @param _image URI of the campaign image
    function createCampaign(
        string memory _name,
        string memory _description,
        uint256 _targetAmount,
        uint256 _startAt,
        uint256 _endAt,
        string memory _image
    ) external {
        require(campaigns.length < 10, "Maximum number of campaigns reached");
        require(_startAt < _endAt, "End date should be after start date");
        require(bytes(_name).length != 0, "Name cannot be empty");
        require(bytes(_description).length != 0, "Description cannot be empty");
        require(bytes(_image).length != 0, "Image URL cannot be empty");
        require(_targetAmount > 0, "Target amount should be greater than zero");

        Campaign memory newCampaign = Campaign({
            name: _name,
            description: _description,
            image: _image,
            creator: payable(msg.sender),
            startAt: _startAt,
            endAt: _endAt,
            id: campaignsCount,
            targetAmount: _targetAmount,
            amountCollected: 0,
            amountWithdrawnByOwner: 0,
            isActive: true,
            claimedByOwner: false
        });

        campaigns.push(newCampaign);
        emit CampaignCreated(campaignsCount, msg.sender, _targetAmount, _startAt, _endAt);
        campaignsCount++;
    }

    /// @notice Gets the total number of campaigns
    /// @return The total number of campaigns
    function getCampaignsCount() public view returns (uint256) {
        return campaignsCount;
    }

    /// @notice Checks if a campaign exists
    /// @dev Reverts if the campaign ID is invalid
    /// @param campaignId The ID of the campaign to check
    function checkCampaignExists(uint256 campaignId) public view {
        require(campaignId < campaigns.length, "Invalid campaign id");
    }

    /// @notice Retrieves details of a specific campaign
    /// @param campaignId The ID of the campaign
    /// @return The campaign details
    function getCampaign(uint256 campaignId) public view returns (Campaign memory) {
        checkCampaignExists(campaignId);
        return campaigns[campaignId];
    }

    /// @notice Allows the campaign creator to update the campaign details
    /// @param campaignId The ID of the campaign to update
    /// @param _name New name of the campaign
    /// @param _description New description of the campaign
    /// @param _targetAmount New target funding amount in wei
    /// @param _startAt New campaign start time in UNIX timestamp
    /// @param _endAt New campaign end time in UNIX timestamp
    /// @param _image New URI of the campaign image
    function updateCampaign(
        uint256 campaignId,
        string memory _name,
        string memory _description,
        uint256 _targetAmount,
        uint256 _startAt,
        uint256 _endAt,
        string memory _image
    ) external onlyCreator(campaignId) {
        require(_startAt < _endAt, "End date should be after start date");
        require(bytes(_name).length != 0, "Name cannot be empty");
        require(bytes(_description).length != 0, "Description cannot be empty");
        require(bytes(_image).length != 0, "Image URL cannot be empty");
        require(_targetAmount > 0, "Target amount should be greater than zero");

        Campaign storage campaign = campaigns[campaignId];
        campaign.name = _name;
        campaign.description = _description;
        campaign.image = _image;
        campaign.startAt = _startAt;
        campaign.endAt = _endAt;
        campaign.targetAmount = _targetAmount;

        emit CampaignUpdated(campaignId, msg.sender, _targetAmount, _startAt, _endAt);
    }

    /// @notice Toggles the active status of a campaign
    /// @param campaignId The ID of the campaign to toggle
    function toggleCampaignStatus(uint256 campaignId) external onlyCreator(campaignId) {
        campaigns[campaignId].isActive = !campaigns[campaignId].isActive;

        emit CampaignActiveStatusChanged(campaignId, msg.sender, campaigns[campaignId].isActive);
    }

    /// @notice Allows users to fund an active and not yet fully funded campaign
    /// @param campaignId The ID of the campaign to fund
    function fundCampaign(uint256 campaignId) external payable {
        require(msg.value > 0, "Amount must be greater than zero");
        Campaign storage campaign = campaigns[campaignId];
        require(campaign.amountCollected + msg.value <= campaign.targetAmount, "Campaign already funded");
        require(campaign.isActive, "Campaign is not active");
        require(block.timestamp < campaign.endAt, "Campaign is expired");

        contributions[campaignId][msg.sender] += msg.value;
        campaign.amountCollected += msg.value;

        emit CampaignFunded(campaignId, msg.sender, msg.value);
    }

    /// @notice Allows users to fund an active and not yet fully funded campaign with tokens
    /// @param campaignId The ID of the campaign to fund
    /// @param amount The amount of tokens to fund the campaign with
    function fundCampaignWithToken(uint256 campaignId, uint256 amount) external nonReentrant {
        Campaign storage campaign = campaigns[campaignId];
        require(amount > 0, "Amount must be greater than zero");
        require(campaign.isActive, "Campaign is not active");
        require(block.timestamp < campaign.endAt, "Campaign is expired");
        require(campaign.amountCollected + amount <= campaign.targetAmount, "Campaign already funded");

        contributions[campaignId][msg.sender] += amount;
        campaign.amountCollected += amount;

        emit CampaignFundedWithToken(campaignId, msg.sender, amount);
    }


    /// @notice Allows contributors to request a refund if the campaign has failed or is overfunded
    /// @param campaignId The ID of the campaign from which to refund
    function refund(uint256 campaignId) external nonReentrant onlyContributor(campaignId) {
        Campaign storage campaign = campaigns[campaignId];

        require(block.timestamp > campaign.endAt, "Campaign is not ended");
        uint256 contributedAmount = contributions[campaignId][msg.sender];
        require(contributedAmount > 0, "No contribution found");

        contributions[campaignId][msg.sender] = 0;

        (bool success,) = msg.sender.call{value: contributedAmount}("");
        require(success, "Refund failed");

        campaign.amountCollected -= contributedAmount;

        emit RefundIssued(campaignId, msg.sender, contributedAmount);
    }

    /// @notice Allows the campaign creator to withdraw the funds after the campaign ends
    /// @dev Reverts if the campaign has not ended, if the amount was already withdrawn, or if the balance is zero
    /// @param campaignId The ID of the campaign from which to withdraw funds
    function withdraw(uint256 campaignId) external nonReentrant onlyCreator(campaignId) {
        Campaign storage campaign = campaigns[campaignId];

        require(block.timestamp > campaign.endAt, "Campaign is not ended");
        require(!campaign.claimedByOwner, "Amount already withdrawn");
        require(campaign.amountCollected > 0, "Balance is equal to zero");

        uint256 amountToWithdraw = campaign.amountCollected;
        campaign.amountCollected = 0;
        campaign.claimedByOwner = true;

        (bool sent, ) = campaign.creator.call{value: amountToWithdraw}("");
        require(sent, "Failed to send Ether");

        emit WithdrawSuccessful(campaignId, msg.sender, amountToWithdraw);
    }

    /// @notice Allows contributors to claim their rewards after the campaign ends
    /// @dev Reverts if the campaign has not ended or if the reward was already claimed
    /// @param campaignId The ID of the campaign for which to claim rewards
    function claimReward(uint256 campaignId) public nonReentrant onlyContributor(campaignId) {
        Campaign storage campaign = campaigns[campaignId];
        require(block.timestamp > campaign.endAt, "Campaign is not ended");
        require(!rewardsClaimed[campaignId][msg.sender], "Reward already claimed");

        uint256 rewardAmount = calculateReward(campaignId, msg.sender);

        rewardsClaimed[campaignId][msg.sender] = true;
        require(leafToken.transfer(msg.sender, rewardAmount), "Rewards transfer failed");

        emit RewardClaimed(msg.sender, campaignId, rewardAmount);
    }

    /// @dev Calculates the reward for a contributor based on their contribution and the reward rate
    /// @param campaignId The ID of the campaign
    /// @param contributor The address of the contributor
    /// @return The amount of reward in LEAF tokens
    function calculateReward(uint256 campaignId, address contributor) internal view returns (uint256) {
        uint256 userContribution = contributions[campaignId][contributor];
        uint256 rewardAmount = (userContribution * RATE) / 1 ether;
        return rewardAmount;
    }

    /// @dev Allows the contract to receive ether
    receive() external payable {}
}
