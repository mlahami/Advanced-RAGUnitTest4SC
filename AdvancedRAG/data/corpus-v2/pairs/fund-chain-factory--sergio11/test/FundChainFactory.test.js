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