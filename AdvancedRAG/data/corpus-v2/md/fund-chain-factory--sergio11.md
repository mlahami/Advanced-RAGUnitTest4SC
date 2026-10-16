# fund-chain-factory--sergio11

- domain: crowdfunding (crowdfunding)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/sergio11/fundchain_blockchain @ bfe34107858fcd2002205f85f16ce2a21385c192
- license: MIT
- targets: FundChainFactory.sol, FundChainCampaign.sol, IFundChainCampaign.sol, IFundChainFactory.sol
- validation: 7 passing tests, 0 failing; statement coverage FundChainFactory.sol 100.0 %, FundChainCampaign.sol 10.53 %, IFundChainCampaign.sol 100.0 %, IFundChainFactory.sol 100.0 %

## Contract: FundChainCampaign.sol (dependency)

```solidity
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
```

## Contract: FundChainFactory.sol (primary target)

```solidity
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
```

## Contract: IFundChainCampaign.sol (dependency)

```solidity
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
```

## Contract: IFundChainFactory.sol (dependency)

```solidity
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
```

## Tests: FundChainFactory.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FundChainFactory", function () {
  let FundChainFactory, fundChainFactory, FundChainCampaign;
  let owner, user1, user2;
  let goalAmount = ethers.parseEther("10");
  let durationInDays = 30;
  let minContribution = ethers.parseEther("0.1");
  let tokenAddress = "0x0000000000000000000000000000000000000001";

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    FundChainCampaign = await ethers.getContractFactory("FundChainCampaign");
    FundChainFactory = await ethers.getContractFactory("FundChainFactory");

    fundChainFactory = await FundChainFactory.deploy();
  });

  it("should allow a user to create a campaign", async function () {
    // Call the createCampaign function, which returns a transaction
    const tx = await fundChainFactory.connect(owner).createCampaign(
      goalAmount,
      durationInDays,
      minContribution,
      tokenAddress
    );
  
    // Wait for the transaction to be mined
    const receipt = await tx.wait();
  
    // Find the CampaignCreated event in the logs
    const campaignCreatedEvent = receipt.logs
      .map(log => {
        try {
          return fundChainFactory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(parsed => parsed && parsed.name === "CampaignCreated");
  
    // Get the deployed campaign address from the event
    const campaignAddress = campaignCreatedEvent.args[0];
  
    // Attach to the deployed campaign contract
    const campaign = await ethers.getContractAt("FundChainCampaign", campaignAddress);
  
    // Verify that the owner is set correctly
    const campaignOwner = await campaign.owner();
    expect(campaignOwner).to.equal(owner.address);
  });
  

  it("should revert if a user tries to create more than 3 campaigns", async function () {
    // Create 3 campaigns for the owner
    for (let i = 0; i < 3; i++) {
      await fundChainFactory.connect(owner).createCampaign(
        goalAmount,
        durationInDays,
        minContribution,
        tokenAddress
      );
    }

    // Try to create the 4th campaign and expect it to fail
    await expect(
      fundChainFactory.connect(owner).createCampaign(
        goalAmount,
        durationInDays,
        minContribution,
        tokenAddress
      )
    ).to.be.revertedWith("Max number of campaigns reached for this owner.");
  });

  it("should allow the owner to retrieve their created campaigns", async function () {
    // Create the first campaign
    const tx1 = await fundChainFactory.connect(owner).createCampaign(
      goalAmount,
      durationInDays,
      minContribution,
      tokenAddress
    );
    const receipt1 = await tx1.wait();
    const campaignCreatedEvent1 = receipt1.logs
      .map(log => {
        try {
          return fundChainFactory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(e => e?.name === "CampaignCreated");
    const campaignAddress1 = campaignCreatedEvent1.args[0];
  
    // Create the second campaign
    const tx2 = await fundChainFactory.connect(owner).createCampaign(
      goalAmount,
      durationInDays,
      minContribution,
      tokenAddress
    );
    const receipt2 = await tx2.wait();
    const campaignCreatedEvent2 = receipt2.logs
      .map(log => {
        try {
          return fundChainFactory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(e => e?.name === "CampaignCreated");
    const campaignAddress2 = campaignCreatedEvent2.args[0];
  
    // Retrieve the owner's campaigns from the factory
    const campaigns = await fundChainFactory.getOwnerCampaigns(owner.address);
  
    // Check both campaigns are in the list
    expect(campaigns).to.include(campaignAddress1);
    expect(campaigns).to.include(campaignAddress2);
  });
  

  it("should allow the owner to retrieve the total number of their created campaigns", async function () {
    await fundChainFactory.connect(owner).createCampaign(
      goalAmount,
      durationInDays,
      minContribution,
      tokenAddress
    );

    const campaignCount = await fundChainFactory.getOwnerCampaignCount(owner.address);
    expect(campaignCount).to.equal(1);
  });

  it("should return all deployed campaigns", async function () {
    /**
     * @dev Test to ensure that all campaigns deployed via the factory are correctly tracked.
     * This validates that the global list of deployed campaigns includes campaigns created by different users.
     */
  
    // Deploy first campaign and extract the address from the event
    const tx1 = await fundChainFactory.connect(owner).createCampaign(
      goalAmount,
      durationInDays,
      minContribution,
      tokenAddress
    );
    const receipt1 = await tx1.wait();
    const event1 = receipt1.logs
      .map(log => {
        try {
          return fundChainFactory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(e => e?.name === "CampaignCreated");
    const campaignAddress1 = event1.args[0];
  
    // Deploy second campaign and extract the address
    const tx2 = await fundChainFactory.connect(user1).createCampaign(
      goalAmount,
      durationInDays,
      minContribution,
      tokenAddress
    );
    const receipt2 = await tx2.wait();
    const event2 = receipt2.logs
      .map(log => {
        try {
          return fundChainFactory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(e => e?.name === "CampaignCreated");
    const campaignAddress2 = event2.args[0];
  
    // Retrieve all deployed campaigns from the factory
    const allCampaigns = await fundChainFactory.getAllCampaigns();
  
    // Assert that both created campaigns are listed
    expect(allCampaigns).to.include(campaignAddress1);
    expect(allCampaigns).to.include(campaignAddress2);
  });
  

  it("should return the maximum number of campaigns per owner", async function () {
    const maxCampaigns = await fundChainFactory.maxCampaignsPerOwner();
    expect(maxCampaigns).to.equal(3);
  });

  it("should emit a CampaignCreated event when a campaign is created", async function () {
    /**
     * @dev Test to ensure that the CampaignCreated event is emitted with the correct parameters when a new campaign is created.
     */
  
    const tx = await fundChainFactory.connect(owner).createCampaign(
      goalAmount,
      durationInDays,
      minContribution,
      tokenAddress
    );
    const receipt = await tx.wait();
  
    const event = receipt.logs
      .map(log => {
        try {
          return fundChainFactory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(e => e?.name === "CampaignCreated");
  
    expect(event).to.not.be.null;
  });
  
});
```
