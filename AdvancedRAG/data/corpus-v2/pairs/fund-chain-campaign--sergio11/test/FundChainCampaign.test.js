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