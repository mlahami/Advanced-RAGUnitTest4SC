const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("CrowdfundingFactory", function () {
  const ONE_DAY = 24 * 60 * 60;
  const RATE_PRECISION = ethers.parseEther("1");
  const THRESHOLD = ethers.parseEther("1000");
  const REWARD_RATE = ethers.parseEther("2");
  const REQUIRED_COLLATERAL = (THRESHOLD * REWARD_RATE) / RATE_PRECISION; // 2,000 tokens

  async function deployFactoryFixture() {
    const [deployer, creator1, creator2, backer] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const fundingToken = (await MockERC20Factory.deploy("Funding Token", "FND", 18));
    const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

    const Factory = await ethers.getContractFactory("CrowdfundingFactory");
    const factory = (await Factory.deploy());
    const factoryAddress = await factory.getAddress();

    // Mint reward tokens to creators
    await rewardToken.mint(creator1.address, ethers.parseEther("10000"));
    await rewardToken.mint(creator2.address, ethers.parseEther("10000"));

    return {
      factory,
      fundingToken,
      rewardToken,
      deployer,
      creator1,
      creator2,
      backer,
      factoryAddress,
    };
  }

  describe("Initialization", function () {
    it("should start with 0 deployed campaigns", async function () {
      const { factory } = await loadFixture(deployFactoryFixture);
      expect(await factory.getDeployedCampaignsCount()).to.equal(0);
      expect(await factory.getDeployedCampaigns()).to.deep.equal([]);
    });
  });

  describe("Validation & Errors", function () {
    it("should revert if token address is zero", async function () {
      const { factory, rewardToken } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createCampaign(
          ethers.ZeroAddress,
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InvalidTokenAddress");

      await expect(
        factory.createCampaign(
          await rewardToken.getAddress(),
          ethers.ZeroAddress,
          THRESHOLD,
          REWARD_RATE,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InvalidTokenAddress");
    });

    it("should revert if threshold is zero", async function () {
      const { factory, fundingToken, rewardToken } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          0,
          REWARD_RATE,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InvalidThreshold");
    });

    it("should revert if rewardRate is zero or results in 0 collateral", async function () {
      const { factory, fundingToken, rewardToken } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          0,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InvalidRewardRate");

      await expect(
        factory.createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          1,
          1,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InvalidRewardRate");
    });

    it("should revert if duration is zero", async function () {
      const { factory, fundingToken, rewardToken } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          0
        )
      ).to.be.revertedWithCustomError(factory, "InvalidDuration");
    });

    it("should revert if creator has not approved sufficient reward tokens", async function () {
      const { factory, fundingToken, rewardToken, creator1 } = await loadFixture(
        deployFactoryFixture
      );

      // No approval given
      await expect(
        factory.connect(creator1).createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          ONE_DAY * 7
        )
      ).to.be.reverted;
    });

    it("should revert with InsufficientCollateral if reward token deducts a fee on transfer", async function () {
      const { factory, fundingToken, creator1, factoryAddress } = await loadFixture(
        deployFactoryFixture
      );

      const MockFeeFactory = await ethers.getContractFactory("MockFeeToken");
      const feeToken = await MockFeeFactory.deploy();

      await feeToken.mint(creator1.address, REQUIRED_COLLATERAL * 2n);
      await feeToken.connect(creator1).approve(factoryAddress, REQUIRED_COLLATERAL * 2n);

      await expect(
        factory.connect(creator1).createCampaign(
          await fundingToken.getAddress(),
          await feeToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InsufficientCollateral");
    });
  });

  describe("Successful Campaign Creation", function () {
    it("should create campaign, lock collateral, and register instance", async function () {
      const { factory, fundingToken, rewardToken, creator1, factoryAddress } = await loadFixture(
        deployFactoryFixture
      );

      // Creator approves factory to transfer collateral
      await rewardToken.connect(creator1).approve(factoryAddress, REQUIRED_COLLATERAL);

      const tx = await factory.connect(creator1).createCampaign(
        await fundingToken.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        ONE_DAY * 7
      );

      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;

      // Verify registry updates
      expect(await factory.getDeployedCampaignsCount()).to.equal(1);
      const deployedCampaigns = await factory.getDeployedCampaigns();
      const campaignAddress = deployedCampaigns[0];

      expect(await factory.getCreatorCampaignsCount(creator1.address)).to.equal(1);
      const creatorCampaigns = await factory.getCreatorCampaigns(creator1.address);
      expect(creatorCampaigns[0]).to.equal(campaignAddress);

      // Verify collateral was transferred into the campaign contract
      expect(await rewardToken.balanceOf(campaignAddress)).to.equal(REQUIRED_COLLATERAL);

      // Verify campaign contract state
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = CampaignFactory.attach(campaignAddress);
      expect(await campaign.creator()).to.equal(creator1.address);
      expect(await campaign.threshold()).to.equal(THRESHOLD);
      expect(await campaign.rewardCollateral()).to.equal(REQUIRED_COLLATERAL);
    });

    it("should support multiple creators and indexing", async function () {
      const { factory, fundingToken, rewardToken, creator1, creator2, factoryAddress } =
        await loadFixture(deployFactoryFixture);

      await rewardToken.connect(creator1).approve(factoryAddress, REQUIRED_COLLATERAL * 2n);
      await rewardToken.connect(creator2).approve(factoryAddress, REQUIRED_COLLATERAL);

      // Creator 1 creates 2 campaigns
      await factory.connect(creator1).createCampaign(
        await fundingToken.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        ONE_DAY * 3
      );
      await factory.connect(creator1).createCampaign(
        await fundingToken.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        ONE_DAY * 5
      );

      // Creator 2 creates 1 campaign
      await factory.connect(creator2).createCampaign(
        await fundingToken.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        ONE_DAY * 10
      );

      expect(await factory.getDeployedCampaignsCount()).to.equal(3);
      expect(await factory.getCreatorCampaignsCount(creator1.address)).to.equal(2);
      expect(await factory.getCreatorCampaignsCount(creator2.address)).to.equal(1);
    });

    it("should support paginated retrieval of deployed and creator campaigns", async function () {
      const { factory, fundingToken, rewardToken, creator1, factoryAddress } = await loadFixture(
        deployFactoryFixture
      );

      await rewardToken.connect(creator1).approve(factoryAddress, REQUIRED_COLLATERAL * 5n);

      // Deploy 3 campaigns
      for (let i = 1; i <= 3; i++) {
        await factory.connect(creator1).createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          ONE_DAY * i
        );
      }

      const allCampaigns = await factory.getDeployedCampaigns();
      expect(allCampaigns.length).to.equal(3);

      // Page 1: offset 0, limit 2
      const [page1, total1] = await factory.getDeployedCampaignsPaginated(0, 2);
      expect(total1).to.equal(3);
      expect(page1.length).to.equal(2);
      expect(page1[0]).to.equal(allCampaigns[0]);
      expect(page1[1]).to.equal(allCampaigns[1]);

      // Page 2: offset 2, limit 2 (only 1 remaining)
      const [page2, total2] = await factory.getDeployedCampaignsPaginated(2, 2);
      expect(total2).to.equal(3);
      expect(page2.length).to.equal(1);
      expect(page2[0]).to.equal(allCampaigns[2]);

      // Out of bounds offset
      const [pageEmpty, totalEmpty] = await factory.getDeployedCampaignsPaginated(5, 2);
      expect(totalEmpty).to.equal(3);
      expect(pageEmpty.length).to.equal(0);

      // Limit 0 returns empty slice
      const [pageZeroLimit, totalZero] = await factory.getDeployedCampaignsPaginated(0, 0);
      expect(totalZero).to.equal(3);
      expect(pageZeroLimit.length).to.equal(0);

      // Creator paginated queries
      const [creatorPage1, creatorTotal1] = await factory.getCreatorCampaignsPaginated(
        creator1.address,
        0,
        1
      );
      expect(creatorTotal1).to.equal(3);
      expect(creatorPage1.length).to.equal(1);
      expect(creatorPage1[0]).to.equal(allCampaigns[0]);

      // Creator pagination where offset + limit exceeds total
      const [creatorPageExceed, creatorTotalExceed] = await factory.getCreatorCampaignsPaginated(
        creator1.address,
        1,
        10
      );
      expect(creatorTotalExceed).to.equal(3);
      expect(creatorPageExceed.length).to.equal(2);
      expect(creatorPageExceed[0]).to.equal(allCampaigns[1]);
      expect(creatorPageExceed[1]).to.equal(allCampaigns[2]);

      const [creatorPageOOB, creatorTotalOOB] = await factory.getCreatorCampaignsPaginated(
        creator1.address,
        10,
        5
      );
      expect(creatorTotalOOB).to.equal(3);
      expect(creatorPageOOB.length).to.equal(0);

      // Creator pagination where limit is 0
      const [creatorPageZeroLimit, creatorTotalZeroLimit] = await factory.getCreatorCampaignsPaginated(
        creator1.address,
        0,
        0
      );
      expect(creatorTotalZeroLimit).to.equal(3);
      expect(creatorPageZeroLimit.length).to.equal(0);
    });
  });
});
