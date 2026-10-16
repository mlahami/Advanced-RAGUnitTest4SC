# fund-chain-campaign--sergio11

- domain: crowdfunding (crowdfunding)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/sergio11/fundchain_blockchain @ bfe34107858fcd2002205f85f16ce2a21385c192
- license: MIT
- targets: FundChainCampaign.sol, IFundChainCampaign.sol
- validation: 16 passing tests, 0 failing; statement coverage FundChainCampaign.sol 71.05 %, IFundChainCampaign.sol 100.0 %

## Contract: FundChainCampaign.sol (primary target)

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

## Tests: FundChainCampaign.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FundChainCampaign", function () {
    let fundChainCampaign, owner, user1, user2;
    const goalAmount = ethers.parseEther("10"); // 10 ETH
    const durationInDays = 30; // 30 days
    const minContribution = ethers.parseEther("0.1"); // 0.1 ETH

    beforeEach(async function () {
        // Retrieve the signers (accounts) from Hardhat network
        [owner, user1, user2] = await ethers.getSigners();

        // Use a valid, non-zero address for testing
        const validAddress = "0x0000000000000000000000000000000000000001";

        // Deploy the FundChainCampaign contract with initialized parameters
        const FundChainCampaign = await ethers.getContractFactory("FundChainCampaign");
        fundChainCampaign = await FundChainCampaign.deploy(owner.address, goalAmount, durationInDays, minContribution, validAddress);
    });

    /**
     * @dev Test to ensure the contract is initialized correctly with the given parameters.
     * This checks the owner, goal amount, and minimum contribution.
     */
    it("should initialize the contract correctly", async function () {
        const campaignInfo = await fundChainCampaign.getCampaignInfo();

        expect(campaignInfo.owner).to.equal(owner.address, "The contract owner should be initialized correctly.");
        expect(campaignInfo.goalAmount).to.equal(goalAmount, "The campaign goal should be initialized correctly.");
        expect(campaignInfo.minContribution).to.equal(minContribution, "The minimum contribution should be initialized correctly.");
    });

    /**
     * @dev Test to ensure users can contribute in ETH.
     * This tests that the contribution is tracked correctly in the contract.
     */
    it("should allow contributions in ETH", async function () {
        await fundChainCampaign.connect(user1).contribute({ value: minContribution });
        const contribution = await fundChainCampaign.contributions(user1.address);

        expect(contribution).to.equal(minContribution, "The user's contribution should be tracked correctly.");
    });

    /**
     * @dev Test to ensure contributions below the minimum are rejected.
     * This ensures the contract enforces the minimum contribution requirement.
     */
    it("should not allow contributions below the minimum", async function () {
        await expect(
            fundChainCampaign.connect(user2).contribute({ value: ethers.parseEther("0.05") })
        ).to.be.revertedWith("Contribution must be greater than the minimum", "The contract should reject contributions below the minimum.");
    });

    /**
     * @dev Test to ensure that the owner can withdraw funds if the campaign goal is met.
     * This checks that the contract properly transfers funds to the owner.
     */
    it("should allow the owner to withdraw funds if the goal is met", async function () {
        // Contribute enough to meet the goal
        await fundChainCampaign.connect(user1).contribute({ value: ethers.parseEther("5") });
        await fundChainCampaign.connect(user2).contribute({ value: ethers.parseEther("5") });
    
        // Simulate the passage of time to end the campaign
        await network.provider.send("evm_increaseTime", [durationInDays * 24 * 60 * 60]); // Increase time by campaign duration
        await network.provider.send("evm_mine"); // Mine a block to apply the changes
    
        // Owner can now withdraw funds if the goal is met and the campaign has ended
        await fundChainCampaign.connect(owner).withdrawFunds();
        
        const ownerBalance = await ethers.provider.getBalance(owner.address);
        expect(ownerBalance).to.be.above(ethers.parseEther("10"));
    });
    

    /**
     * @dev Test to ensure contributors can claim a refund if the funding goal is not met.
     * This simulates a failed campaign and checks that users can get their contributions back.
     */
    it("should allow contributors to claim refund if the goal is not met", async function () {
        await fundChainCampaign.connect(user1).contribute({ value: ethers.parseEther("1") });

        // Simulate the campaign ending without reaching the goal
        await network.provider.send("evm_increaseTime", [durationInDays * 24 * 60 * 60]);
        await network.provider.send("evm_mine");

        // User claims a refund
        await fundChainCampaign.connect(user1).claimRefund();

        // Verify that the contributor's balance is refunded correctly
        const user1Balance = await ethers.provider.getBalance(user1.address);
        expect(user1Balance).to.be.above(ethers.parseEther("1"), "The contributor should receive a refund.");
    });

    /**
     * @dev Test to ensure the campaign can be paused and resumed by the owner.
     * This checks that the contract enforces the pause state, preventing contributions when paused.
     */
    it("should allow the owner to pause and resume the campaign", async function () {
        // Owner pauses the campaign
        await fundChainCampaign.connect(owner).pauseCampaign();

        // Try contributing while the campaign is paused
        await expect(
            fundChainCampaign.connect(user1).contribute({ value: minContribution })
        ).to.be.revertedWith("Campaign is paused", "Contributions should be rejected while the campaign is paused.");

        // Owner resumes the campaign
        await fundChainCampaign.connect(owner).resumeCampaign();

        // Contributor successfully contributes after the campaign is resumed
        await fundChainCampaign.connect(user1).contribute({ value: minContribution });

        // Verify the contribution is tracked correctly after resumption
        const contribution = await fundChainCampaign.contributions(user1.address);
        expect(contribution).to.equal(minContribution, "The user's contribution should be tracked correctly after resuming the campaign.");
    });

    /**
     * @dev Test to ensure that invalid parameters passed during the campaign deployment 
     * result in a revert. Specifically, this checks that the contract rejects campaigns 
     * with zero duration or zero minimum contribution.
     */
    it("should revert if invalid parameters are passed during deployment", async function () {
        await expect(
            ethers.getContractFactory("FundChainCampaign").then(async (Factory) => {
                await Factory.deploy(owner.address, ethers.parseEther("10"), 0, ethers.parseEther("0.1"), "0x0000000000000000000000000000000000000001");
            })
        ).to.be.revertedWith("Duration must be greater than zero");

        await expect(
            ethers.getContractFactory("FundChainCampaign").then(async (Factory) => {
                await Factory.deploy(owner.address, ethers.parseEther("10"), 30, 0, "0x0000000000000000000000000000000000000001");
            })
        ).to.be.revertedWith("Minimum contribution must be greater than zero");
    });


    /**
     * @dev Test to ensure that the campaign can be paused and resumed by the owner.
     * This checks that the contract enforces the pause state, preventing contributions 
     * when paused and allowing contributions again once resumed.
     */
    it("should allow the owner to pause and resume the campaign", async function () {
        await fundChainCampaign.connect(owner).pauseCampaign();

        // Test that contribution is not allowed while paused
        await expect(
            fundChainCampaign.connect(user1).contribute({ value: minContribution })
        ).to.be.revertedWith("Campaign is paused");

        await fundChainCampaign.connect(owner).resumeCampaign();

        // Test that contributions can be made after resuming
        await fundChainCampaign.connect(user1).contribute({ value: minContribution });
        const contribution = await fundChainCampaign.contributions(user1.address);
        expect(contribution).to.equal(minContribution);
    });

    
    /**
     * @dev Test to ensure that contributors can claim a refund if the campaign 
     * does not meet its funding goal by the end of the campaign.
     */
    it("should allow contributors to claim a refund if the goal is not met", async function () {
        await fundChainCampaign.connect(user1).contribute({ value: ethers.parseEther("1") });

        // Simulate campaign ending without reaching the funding goal
        await network.provider.send("evm_increaseTime", [durationInDays * 24 * 60 * 60]);
        await network.provider.send("evm_mine");

        // Contributor claims a refund
        await fundChainCampaign.connect(user1).claimRefund();

        const user1Balance = await ethers.provider.getBalance(user1.address);
        expect(user1Balance).to.be.above(ethers.parseEther("1"));
    });

    
    /**
     * @dev Test to ensure that the owner cannot withdraw funds from the campaign 
     * if the goal has not been met by the end of the campaign.
     */
    it("should not allow the owner to withdraw if the goal is not met", async function () {
        await fundChainCampaign.connect(user1).contribute({ value: ethers.parseEther("5") });

        // Simulate campaign ending without reaching the funding goal
        await network.provider.send("evm_increaseTime", [durationInDays * 24 * 60 * 60]);
        await network.provider.send("evm_mine");

        // Try withdrawing and expect failure
        await expect(fundChainCampaign.connect(owner).withdrawFunds()).to.be.revertedWith("Funding goal not reached");
    });

    
    /**
     * @dev Test to ensure the owner can update the funding goal of the campaign after it has started.
     */
    it("should allow the owner to update the goal amount", async function () {
        await fundChainCampaign.connect(user1).contribute({ value: ethers.parseEther("5") });

        const newGoal = ethers.parseEther("20");
        await fundChainCampaign.connect(owner).updateGoalAmount(newGoal);

        const campaignInfo = await fundChainCampaign.getCampaignInfo();
        expect(campaignInfo.goalAmount).to.equal(newGoal);
    });

    
    /**
     * @dev Test to ensure that the owner cannot reduce the funding goal below the 
     * total contributions received. This protects contributors' interests.
     */
    it("should not allow the owner to reduce the goal below total contributions", async function () {
        await fundChainCampaign.connect(user1).contribute({ value: ethers.parseEther("5") });

        const newGoal = ethers.parseEther("3");  // Goal is less than total contributions
        await expect(fundChainCampaign.connect(owner).updateGoalAmount(newGoal)).to.be.revertedWith("New goal must be higher than total contributed");
    });
    
    /**
     * @dev Test to ensure that the contract reverts if a token contribution is made 
     * when no ERC20 token address is set in the contract.
     */
    it("should revert if token contribution is made without setting ERC20 address", async function () {
        await expect(
            fundChainCampaign.connect(user1).contributeWithToken(ethers.parseEther("5"))
        ).to.be.reverted;
    });

    /**
     * @dev Test to ensure that contributions are prevented when the campaign is paused. 
     * This test checks that the contract correctly enforces the pause state.
     */
    it("should revert contributions when the campaign is paused", async function () {
        await fundChainCampaign.connect(owner).pauseCampaign();
        await expect(
            fundChainCampaign.connect(user1).contribute({ value: minContribution })
        ).to.be.revertedWith("Campaign is paused");
    });

    
    /**
     * @dev Test to ensure that contributions are allowed again once the campaign is resumed 
     * after being paused.
     */
    it("should allow contributions again when the campaign is resumed", async function () {
        await fundChainCampaign.connect(owner).resumeCampaign();
        await fundChainCampaign.connect(user1).contribute({ value: minContribution });
        const contribution = await fundChainCampaign.contributions(user1.address);
        expect(contribution).to.equal(minContribution);
    });


    /**
     * @dev Test to ensure that contributors can set and retrieve a personal message 
     * associated with their contribution.
     */
    it("should allow contributors to set and retrieve a personal message", async function () {
        const message = "This is my contribution message!";
        await fundChainCampaign.connect(user1).setContributorMessage(message);

        const storedMessage = await fundChainCampaign.contributorMessages(user1.address);
        expect(storedMessage).to.equal(message);
    });
});
```
