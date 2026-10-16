const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("CrowdfundingCampaign", function () {
  const ONE_DAY = 24 * 60 * 60;
  const RATE_PRECISION = ethers.parseEther("1"); // 1e18
  const THRESHOLD = ethers.parseEther("1000"); // 1,000 funding tokens
  const REWARD_RATE = ethers.parseEther("2"); // 2 reward tokens per 1 funding token (2:1 ratio)
  const REQUIRED_COLLATERAL = (THRESHOLD * REWARD_RATE) / RATE_PRECISION; // 2,000 reward tokens

  async function deployCampaignFixture() {
    const [deployer, creator, alice, bob, charlie, attacker] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const fundingToken = (await MockERC20Factory.deploy("Funding Token", "FND", 18));
    const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

    const latestTime = await time.latest();
    const deadline = latestTime + ONE_DAY * 7; // 7 days from now

    // Deploy campaign
    const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
    const campaign = (await CampaignFactory.deploy(
      creator.address,
      await fundingToken.getAddress(),
      await rewardToken.getAddress(),
      THRESHOLD,
      REWARD_RATE,
      deadline
    ));

    const campaignAddress = await campaign.getAddress();

    // Mint reward tokens to creator and fund the campaign escrow with 100% collateral
    await rewardToken.mint(creator.address, REQUIRED_COLLATERAL * 2n);
    await rewardToken.connect(creator).transfer(campaignAddress, REQUIRED_COLLATERAL);

    // Mint funding tokens to backers
    await fundingToken.mint(alice.address, ethers.parseEther("5000"));
    await fundingToken.mint(bob.address, ethers.parseEther("5000"));
    await fundingToken.mint(charlie.address, ethers.parseEther("5000"));

    return {
      campaign,
      fundingToken,
      rewardToken,
      deployer,
      creator,
      alice,
      bob,
      charlie,
      attacker,
      deadline,
      campaignAddress,
    };
  }

  describe("Deployment & Configuration", function () {
    it("should initialize parameters correctly", async function () {
      const { campaign, fundingToken, rewardToken, creator, deadline } = await loadFixture(
        deployCampaignFixture
      );

      expect(await campaign.creator()).to.equal(creator.address);
      expect(await campaign.fundingToken()).to.equal(await fundingToken.getAddress());
      expect(await campaign.rewardToken()).to.equal(await rewardToken.getAddress());
      expect(await campaign.threshold()).to.equal(THRESHOLD);
      expect(await campaign.rewardRate()).to.equal(REWARD_RATE);
      expect(await campaign.deadline()).to.equal(deadline);
      expect(await campaign.rewardCollateral()).to.equal(REQUIRED_COLLATERAL);
      expect(await campaign.state()).to.equal(0); // State.Active
      expect(await campaign.totalRaised()).to.equal(0);
    });

    it("should revert if creator address is zero", async function () {
      const { fundingToken, rewardToken } = await loadFixture(deployCampaignFixture);
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const latestTime = await time.latest();

      await expect(
        CampaignFactory.deploy(
          ethers.ZeroAddress,
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");
    });

    it("should revert if funding or reward token address is zero", async function () {
      const { creator, fundingToken, rewardToken } = await loadFixture(deployCampaignFixture);
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const latestTime = await time.latest();

      await expect(
        CampaignFactory.deploy(
          creator.address,
          ethers.ZeroAddress,
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");

      await expect(
        CampaignFactory.deploy(
          creator.address,
          await fundingToken.getAddress(),
          ethers.ZeroAddress,
          THRESHOLD,
          REWARD_RATE,
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");
    });

    it("should revert if threshold or rewardRate is zero", async function () {
      const { creator, fundingToken, rewardToken } = await loadFixture(deployCampaignFixture);
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const latestTime = await time.latest();

      await expect(
        CampaignFactory.deploy(
          creator.address,
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          0,
          REWARD_RATE,
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");

      await expect(
        CampaignFactory.deploy(
          creator.address,
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          0,
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");
    });

    it("should revert if deadline is in the past or present", async function () {
      const { creator, fundingToken, rewardToken } = await loadFixture(deployCampaignFixture);
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const latestTime = await time.latest();

      await expect(
        CampaignFactory.deploy(
          creator.address,
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          latestTime - 10
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "DeadlinePassed");
    });

    it("should revert if rewardCollateral calculates to zero", async function () {
      const { creator, fundingToken, rewardToken } = await loadFixture(deployCampaignFixture);
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const latestTime = await time.latest();

      await expect(
        CampaignFactory.deploy(
          creator.address,
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          1, // extremely small threshold
          1, // extremely small rate
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");
    });
  });

  describe("Pledging", function () {
    it("should allow a backer to pledge funding tokens", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );
      const pledgeAmount = ethers.parseEther("300");

      await fundingToken.connect(alice).approve(campaignAddress, pledgeAmount);

      await expect(campaign.connect(alice).pledge(pledgeAmount))
        .to.emit(campaign, "Pledged")
        .withArgs(alice.address, pledgeAmount, pledgeAmount);

      expect(await campaign.contributions(alice.address)).to.equal(pledgeAmount);
      expect(await campaign.totalRaised()).to.equal(pledgeAmount);
      expect(await campaign.state()).to.equal(0); // State.Active
      expect(await fundingToken.balanceOf(campaignAddress)).to.equal(pledgeAmount);
    });

    it("should revert if pledging zero amount", async function () {
      const { campaign, alice } = await loadFixture(deployCampaignFixture);

      await expect(campaign.connect(alice).pledge(0)).to.be.revertedWithCustomError(
        campaign,
        "ZeroAmount"
      );
    });

    it("should revert if pledge exceeds threshold", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );
      const excessivePledge = THRESHOLD + 1n;

      await fundingToken.connect(alice).approve(campaignAddress, excessivePledge);

      await expect(campaign.connect(alice).pledge(excessivePledge)).to.be.revertedWithCustomError(
        campaign,
        "ThresholdExceeded"
      );
    });

    it("should transition state to Successful when pledge meets threshold exactly", async function () {
      const { campaign, fundingToken, alice, bob, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );

      const pledgeAlice = ethers.parseEther("600");
      const pledgeBob = ethers.parseEther("400");

      await fundingToken.connect(alice).approve(campaignAddress, pledgeAlice);
      await campaign.connect(alice).pledge(pledgeAlice);

      await fundingToken.connect(bob).approve(campaignAddress, pledgeBob);
      await campaign.connect(bob).pledge(pledgeBob);

      expect(await campaign.totalRaised()).to.equal(THRESHOLD);
      expect(await campaign.state()).to.equal(1); // State.Successful
      expect(await campaign.remainingToThreshold()).to.equal(0);
    });

    it("should accurately return remainingToThreshold while active", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );

      expect(await campaign.remainingToThreshold()).to.equal(THRESHOLD);

      const pledgeAmount = ethers.parseEther("300");
      await fundingToken.connect(alice).approve(campaignAddress, pledgeAmount);
      await campaign.connect(alice).pledge(pledgeAmount);

      expect(await campaign.remainingToThreshold()).to.equal(THRESHOLD - pledgeAmount);
    });
  });

  describe("Flexible Early Withdrawal Before Threshold", function () {
    it("should allow partial and full withdrawals while totalRaised < threshold", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );
      const pledgeAmount = ethers.parseEther("400");
      const partialWithdraw = ethers.parseEther("150");

      await fundingToken.connect(alice).approve(campaignAddress, pledgeAmount);
      await campaign.connect(alice).pledge(pledgeAmount);

      const initialAliceBalance = await fundingToken.balanceOf(alice.address);

      // Partial withdrawal
      await expect(campaign.connect(alice).withdrawBeforeThreshold(partialWithdraw))
        .to.emit(campaign, "WithdrawnBeforeThreshold")
        .withArgs(alice.address, partialWithdraw, pledgeAmount - partialWithdraw);

      expect(await campaign.contributions(alice.address)).to.equal(pledgeAmount - partialWithdraw);
      expect(await campaign.totalRaised()).to.equal(pledgeAmount - partialWithdraw);
      expect(await fundingToken.balanceOf(alice.address)).to.equal(
        initialAliceBalance + partialWithdraw
      );

      // Full remaining withdrawal
      const remaining = pledgeAmount - partialWithdraw;
      await campaign.connect(alice).withdrawBeforeThreshold(remaining);

      expect(await campaign.contributions(alice.address)).to.equal(0);
      expect(await campaign.totalRaised()).to.equal(0);
    });

    it("should revert if withdrawing zero", async function () {
      const { campaign, alice } = await loadFixture(deployCampaignFixture);

      await expect(campaign.connect(alice).withdrawBeforeThreshold(0)).to.be.revertedWithCustomError(
        campaign,
        "ZeroAmount"
      );
    });

    it("should revert if withdrawing more than contributed", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );
      const pledgeAmount = ethers.parseEther("200");

      await fundingToken.connect(alice).approve(campaignAddress, pledgeAmount);
      await campaign.connect(alice).pledge(pledgeAmount);

      await expect(
        campaign.connect(alice).withdrawBeforeThreshold(ethers.parseEther("201"))
      ).to.be.revertedWithCustomError(campaign, "InsufficientContribution");
    });

    it("should disallow early withdrawal once threshold is reached", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );

      await fundingToken.connect(alice).approve(campaignAddress, THRESHOLD);
      await campaign.connect(alice).pledge(THRESHOLD);

      expect(await campaign.state()).to.equal(1); // State.Successful

      await expect(
        campaign.connect(alice).withdrawBeforeThreshold(ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(campaign, "CampaignNotActive");
    });

    it("should disallow early withdrawal once deadline has passed", async function () {
      const { campaign, fundingToken, alice, deadline, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );

      const pledgeAmount = ethers.parseEther("200");
      await fundingToken.connect(alice).approve(campaignAddress, pledgeAmount);
      await campaign.connect(alice).pledge(pledgeAmount);

      // Advance time past deadline
      await time.increaseTo(deadline + 1);

      expect(await campaign.state()).to.equal(2); // State.Expired

      await expect(
        campaign.connect(alice).withdrawBeforeThreshold(pledgeAmount)
      ).to.be.revertedWithCustomError(campaign, "CampaignNotActive");
    });
  });

  describe("Successful Campaign Settlement", function () {
    async function deploySuccessfulCampaignFixture() {
      const base = await deployCampaignFixture();
      const { campaign, fundingToken, alice, bob, campaignAddress } = base;

      const pledgeAlice = ethers.parseEther("700");
      const pledgeBob = ethers.parseEther("300");

      await fundingToken.connect(alice).approve(campaignAddress, pledgeAlice);
      await campaign.connect(alice).pledge(pledgeAlice);

      await fundingToken.connect(bob).approve(campaignAddress, pledgeBob);
      await campaign.connect(bob).pledge(pledgeBob);

      return { ...base, pledgeAlice, pledgeBob };
    }

    it("should allow backers to claim their reward tokens", async function () {
      const { campaign, rewardToken, alice, pledgeAlice } = await loadFixture(
        deploySuccessfulCampaignFixture
      );

      const expectedReward = (pledgeAlice * REWARD_RATE) / RATE_PRECISION; // 700 * 2 = 1400

      await expect(campaign.connect(alice).claimReward())
        .to.emit(campaign, "RewardsClaimed")
        .withArgs(alice.address, expectedReward);

      expect(await rewardToken.balanceOf(alice.address)).to.equal(expectedReward);
      expect(await campaign.rewardsClaimed(alice.address)).to.be.true;
    });

    it("should revert if backer attempts to double-claim rewards", async function () {
      const { campaign, alice } = await loadFixture(deploySuccessfulCampaignFixture);

      await campaign.connect(alice).claimReward();

      await expect(campaign.connect(alice).claimReward()).to.be.revertedWithCustomError(
        campaign,
        "RewardsAlreadyClaimed"
      );
    });

    it("should revert if non-backer calls claimReward", async function () {
      const { campaign, charlie } = await loadFixture(deploySuccessfulCampaignFixture);

      await expect(campaign.connect(charlie).claimReward()).to.be.revertedWithCustomError(
        campaign,
        "InsufficientContribution"
      );
    });

    it("should allow creator to claim total raised funding tokens", async function () {
      const { campaign, fundingToken, creator } = await loadFixture(
        deploySuccessfulCampaignFixture
      );

      const initialCreatorFunding = await fundingToken.balanceOf(creator.address);

      await expect(campaign.connect(creator).claimFunds())
        .to.emit(campaign, "CreatorFundsClaimed")
        .withArgs(creator.address, THRESHOLD);

      expect(await fundingToken.balanceOf(creator.address)).to.equal(
        initialCreatorFunding + THRESHOLD
      );
      expect(await campaign.creatorFundsClaimed()).to.be.true;
    });

    it("should revert if creator attempts to double-claim funds", async function () {
      const { campaign, creator } = await loadFixture(deploySuccessfulCampaignFixture);

      await campaign.connect(creator).claimFunds();

      await expect(campaign.connect(creator).claimFunds()).to.be.revertedWithCustomError(
        campaign,
        "CreatorFundsAlreadyClaimed"
      );
    });

    it("should revert if non-creator calls claimFunds", async function () {
      const { campaign, alice } = await loadFixture(deploySuccessfulCampaignFixture);

      await expect(campaign.connect(alice).claimFunds()).to.be.revertedWithCustomError(
        campaign,
        "Unauthorized"
      );
    });

    it("should prevent refunds or collateral recovery when campaign is successful", async function () {
      const { campaign, alice, creator, deadline } = await loadFixture(
        deploySuccessfulCampaignFixture
      );

      await expect(campaign.connect(alice).claimRefund()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotExpired"
      );

      await expect(campaign.connect(creator).recoverCollateral()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotExpired"
      );

      // Even if time advances far past deadline, state remains Successful!
      await time.increaseTo(deadline + ONE_DAY * 10);
      expect(await campaign.state()).to.equal(1); // State.Successful

      await expect(campaign.connect(alice).claimRefund()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotExpired"
      );

      await expect(campaign.connect(creator).recoverCollateral()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotExpired"
      );
    });
  });

  describe("Expired / Failed Campaign Settlement", function () {
    async function deployExpiredCampaignFixture() {
      const base = await deployCampaignFixture();
      const { campaign, fundingToken, alice, deadline, campaignAddress } = base;

      // Alice pledges only 400 (threshold is 1000)
      const pledgeAlice = ethers.parseEther("400");
      await fundingToken.connect(alice).approve(campaignAddress, pledgeAlice);
      await campaign.connect(alice).pledge(pledgeAlice);

      // Advance time past deadline
      await time.increaseTo(deadline + 10);

      return { ...base, pledgeAlice };
    }

    it("should transition state to Expired", async function () {
      const { campaign } = await loadFixture(deployExpiredCampaignFixture);
      expect(await campaign.state()).to.equal(2); // State.Expired
    });

    it("should revert if attempting to pledge after expiration", async function () {
      const { campaign, fundingToken, bob, campaignAddress } = await loadFixture(
        deployExpiredCampaignFixture
      );

      await fundingToken.connect(bob).approve(campaignAddress, ethers.parseEther("100"));
      await expect(
        campaign.connect(bob).pledge(ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(campaign, "CampaignNotActive");
    });

    it("should allow backers to claim 100% refund of contributed funding tokens", async function () {
      const { campaign, fundingToken, alice, pledgeAlice } = await loadFixture(
        deployExpiredCampaignFixture
      );

      const initialBalance = await fundingToken.balanceOf(alice.address);

      await expect(campaign.connect(alice).claimRefund())
        .to.emit(campaign, "RefundClaimed")
        .withArgs(alice.address, pledgeAlice);

      expect(await fundingToken.balanceOf(alice.address)).to.equal(initialBalance + pledgeAlice);
      expect(await campaign.refundsClaimed(alice.address)).to.be.true;
    });

    it("should revert if backer attempts double-refund", async function () {
      const { campaign, alice } = await loadFixture(deployExpiredCampaignFixture);

      await campaign.connect(alice).claimRefund();

      await expect(campaign.connect(alice).claimRefund()).to.be.revertedWithCustomError(
        campaign,
        "RefundsAlreadyClaimed"
      );
    });

    it("should revert if non-backer calls claimRefund", async function () {
      const { campaign, charlie } = await loadFixture(deployExpiredCampaignFixture);

      await expect(campaign.connect(charlie).claimRefund()).to.be.revertedWithCustomError(
        campaign,
        "InsufficientContribution"
      );
    });

    it("should allow creator to recover 100% of reward collateral", async function () {
      const { campaign, rewardToken, creator } = await loadFixture(deployExpiredCampaignFixture);

      const initialRewardBalance = await rewardToken.balanceOf(creator.address);

      await expect(campaign.connect(creator).recoverCollateral())
        .to.emit(campaign, "CreatorCollateralRecovered")
        .withArgs(creator.address, REQUIRED_COLLATERAL);

      expect(await rewardToken.balanceOf(creator.address)).to.equal(
        initialRewardBalance + REQUIRED_COLLATERAL
      );
      expect(await campaign.creatorCollateralRecovered()).to.be.true;
    });

    it("should revert if creator attempts double-recovery of collateral", async function () {
      const { campaign, creator } = await loadFixture(deployExpiredCampaignFixture);

      await campaign.connect(creator).recoverCollateral();

      await expect(campaign.connect(creator).recoverCollateral()).to.be.revertedWithCustomError(
        campaign,
        "CreatorCollateralAlreadyRefunded"
      );
    });

    it("should revert if non-creator calls recoverCollateral", async function () {
      const { campaign, alice } = await loadFixture(deployExpiredCampaignFixture);

      await expect(campaign.connect(alice).recoverCollateral()).to.be.revertedWithCustomError(
        campaign,
        "Unauthorized"
      );
    });

    it("should prevent claims of rewards or funds when campaign is expired", async function () {
      const { campaign, alice, creator } = await loadFixture(deployExpiredCampaignFixture);

      await expect(campaign.connect(alice).claimReward()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotSuccessful"
      );

      await expect(campaign.connect(creator).claimFunds()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotSuccessful"
      );
    });
  });

  describe("Security: Reentrancy Attack Protection", function () {
    it("should block reentrancy attack on claimRefund via MaliciousReentrantToken", async function () {
      const [, creator, attacker] = await ethers.getSigners();

      // Deploy malicious funding token
      const MaliciousFactory = await ethers.getContractFactory("MaliciousReentrantToken");
      const maliciousFunding = (await MaliciousFactory.deploy());

      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY;

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = (await CampaignFactory.deploy(
        creator.address,
        await maliciousFunding.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        deadline
      ));

      const campaignAddress = await campaign.getAddress();

      // Fund collateral
      await rewardToken.mint(campaignAddress, REQUIRED_COLLATERAL);

      // Attacker pledges
      const pledgeAmount = ethers.parseEther("100");
      await maliciousFunding.mint(attacker.address, pledgeAmount);
      await maliciousFunding.connect(attacker).approve(campaignAddress, pledgeAmount);
      await campaign.connect(attacker).pledge(pledgeAmount);

      // Expire campaign
      await time.increaseTo(deadline + 10);

      // Arm malicious token to attack on refund
      await maliciousFunding.setAttackConfig(campaignAddress, 1 /* Refund */, true);

      // When campaign executes safeTransfer, malicious token reenters claimRefund()
      // OpenZeppelin ReentrancyGuard should revert with ReentrancyGuardReentrantCall()
      await expect(campaign.connect(attacker).claimRefund()).to.be.revertedWithCustomError(
        campaign,
        "ReentrancyGuardReentrantCall"
      );
    });

    it("should block reentrancy attack on withdrawBeforeThreshold via MaliciousReentrantToken", async function () {
      const [, creator, attacker] = await ethers.getSigners();

      const MaliciousFactory = await ethers.getContractFactory("MaliciousReentrantToken");
      const maliciousFunding = (await MaliciousFactory.deploy());

      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY;

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = (await CampaignFactory.deploy(
        creator.address,
        await maliciousFunding.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        deadline
      ));

      const campaignAddress = await campaign.getAddress();
      await rewardToken.mint(campaignAddress, REQUIRED_COLLATERAL);

      const pledgeAmount = ethers.parseEther("100");
      await maliciousFunding.mint(attacker.address, pledgeAmount);
      await maliciousFunding.connect(attacker).approve(campaignAddress, pledgeAmount);
      await campaign.connect(attacker).pledge(pledgeAmount);

      // Arm malicious token to attack on withdraw
      await maliciousFunding.setAttackConfig(campaignAddress, 0 /* Withdraw */, true);

      await expect(
        campaign.connect(attacker).withdrawBeforeThreshold(ethers.parseEther("50"))
      ).to.be.revertedWithCustomError(campaign, "ReentrancyGuardReentrantCall");
    });

    it("should allow regular transfers on MaliciousReentrantToken when attack is inactive", async function () {
      const [deployer, user1, user2] = await ethers.getSigners();
      const MaliciousFactory = await ethers.getContractFactory("MaliciousReentrantToken");
      const token = (await MaliciousFactory.deploy());
      await token.mint(user1.address, 1000n);
      await token.connect(user1).transfer(user2.address, 400n);
      expect(await token.balanceOf(user2.address)).to.equal(400n);
    });
  });

  describe("MockERC20 Faucet & Utility", function () {
    it("should allow users to call faucet and check decimals", async function () {
      const [,, user] = await ethers.getSigners();
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const token = (await MockERC20Factory.deploy("Test Token", "TST", 6));

      expect(await token.decimals()).to.equal(6);
      await token.connect(user).faucet(1000n);
      expect(await token.balanceOf(user.address)).to.equal(1000n);
    });
  });

  describe("Multi-Decimal Precision Handling", function () {
    it("should correctly handle 6-decimal USDC funding token and 18-decimal reward token", async function () {
      const [, creator, backer] = await ethers.getSigners();

      // USDC has 6 decimals
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const usdcFunding = (await MockERC20Factory.deploy("USD Coin", "USDC", 6));
      const projectReward = (await MockERC20Factory.deploy("Project Token", "PRJ", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY * 5;

      // Threshold: 50,000 USDC = 50,000 * 10^6 units
      const usdcThreshold = 50_000n * 10n ** 6n;

      // Rate: 1 whole USDC gives 10 whole PRJ tokens
      // 10^6 raw USDC -> 10 * 10^18 raw PRJ
      // rewardRate = (10 * 10^18 * 10^18) / 10^6 = 10^31
      const normalizedRate = ethers.parseUnits("10", 30); // 10 * 1e30

      const requiredRewardCollateral = (usdcThreshold * normalizedRate) / RATE_PRECISION;
      // 50,000 * 10^6 * 10 * 10^30 / 10^18 = 500,000 * 10^18 (500,000 whole PRJ tokens)
      expect(requiredRewardCollateral).to.equal(ethers.parseEther("500000"));

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const multiDecCampaign = (await CampaignFactory.deploy(
        creator.address,
        await usdcFunding.getAddress(),
        await projectReward.getAddress(),
        usdcThreshold,
        normalizedRate,
        deadline
      ));

      const campaignAddress = await multiDecCampaign.getAddress();

      // Fund collateral
      await projectReward.mint(campaignAddress, requiredRewardCollateral);

      // Backer pledges 5,000 USDC (10% of threshold)
      const pledgeAmount = 5_000n * 10n ** 6n;
      await usdcFunding.mint(backer.address, pledgeAmount);
      await usdcFunding.connect(backer).approve(campaignAddress, pledgeAmount);
      await multiDecCampaign.connect(backer).pledge(pledgeAmount);

      const expectedReward = (pledgeAmount * normalizedRate) / RATE_PRECISION;
      // 5,000 * 10 = 50,000 whole PRJ tokens (50,000 * 10^18)
      expect(expectedReward).to.equal(ethers.parseEther("50000"));
      expect(await multiDecCampaign.calculateReward(pledgeAmount)).to.equal(expectedReward);
    });
  });

  describe("Fee-on-Transfer Funding Token Protection", function () {
    it("should correctly record net received amount and avoid contract insolvency", async function () {
      const [deployer, creator, backer] = await ethers.getSigners();
      const MockFeeTokenFactory = await ethers.getContractFactory("MockFeeToken");
      const feeFundingToken = (await MockFeeTokenFactory.deploy());

      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY * 7;
      const threshold = ethers.parseEther("950"); // Target is exactly 950 net tokens

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = (await CampaignFactory.deploy(
        creator.address,
        await feeFundingToken.getAddress(),
        await rewardToken.getAddress(),
        threshold,
        REWARD_RATE,
        deadline
      ));

      const campaignAddress = await campaign.getAddress();
      const collateral = (threshold * REWARD_RATE) / RATE_PRECISION;
      await rewardToken.mint(campaignAddress, collateral);

      // Backer has 2,000 fee tokens. Backer pledges 1,000 tokens.
      // MockFeeToken deducts 5% fee (50 tokens), so campaign receives exactly 950 tokens!
      await feeFundingToken.mint(backer.address, ethers.parseEther("2000"));
      await feeFundingToken.connect(backer).approve(campaignAddress, ethers.parseEther("1000"));

      await expect(campaign.connect(backer).pledge(ethers.parseEther("1000")))
        .to.emit(campaign, "Pledged")
        .withArgs(backer.address, ethers.parseEther("950"), ethers.parseEther("950"));

      // Invariant checks
      expect(await campaign.contributions(backer.address)).to.equal(ethers.parseEther("950"));
      expect(await campaign.totalRaised()).to.equal(ethers.parseEther("950"));
      expect(await campaign.state()).to.equal(1); // Successful!

      // Verify contract balance of fee token exactly matches totalRaised
      expect(await feeFundingToken.balanceOf(campaignAddress)).to.equal(ethers.parseEther("950"));

      // Creator claims funds: must succeed without reverting because contract holds the full 950 tokens!
      await expect(campaign.connect(creator).claimFunds())
        .to.emit(campaign, "CreatorFundsClaimed")
        .withArgs(creator.address, ethers.parseEther("950"));

      expect(await feeFundingToken.balanceOf(campaignAddress)).to.equal(0);
    });

    it("should revert if fee-on-transfer pledge net amount exceeds threshold", async function () {
      const [deployer, creator, backer] = await ethers.getSigners();
      const MockFeeTokenFactory = await ethers.getContractFactory("MockFeeToken");
      const feeFundingToken = (await MockFeeTokenFactory.deploy());

      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY * 7;
      const threshold = ethers.parseEther("500");

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = (await CampaignFactory.deploy(
        creator.address,
        await feeFundingToken.getAddress(),
        await rewardToken.getAddress(),
        threshold,
        REWARD_RATE,
        deadline
      ));

      const campaignAddress = await campaign.getAddress();
      await rewardToken.mint(campaignAddress, (threshold * REWARD_RATE) / RATE_PRECISION);

      // Pledging 1,000 gives 950 net, which exceeds 500 threshold
      await feeFundingToken.mint(backer.address, ethers.parseEther("1000"));
      await feeFundingToken.connect(backer).approve(campaignAddress, ethers.parseEther("1000"));

      await expect(campaign.connect(backer).pledge(ethers.parseEther("1000"))).to.be.revertedWithCustomError(
        campaign,
        "ThresholdExceeded"
      );
    });

    it("should revert with ZeroAmount if fee-on-transfer token results in 0 net tokens received", async function () {
      const [deployer, creator, backer] = await ethers.getSigners();
      const MockFeeTokenFactory = await ethers.getContractFactory("MockFeeToken");
      const feeFundingToken = (await MockFeeTokenFactory.deploy());

      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY * 7;
      const threshold = ethers.parseEther("500");

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = (await CampaignFactory.deploy(
        creator.address,
        await feeFundingToken.getAddress(),
        await rewardToken.getAddress(),
        threshold,
        REWARD_RATE,
        deadline
      ));

      const campaignAddress = await campaign.getAddress();
      await rewardToken.mint(campaignAddress, (threshold * REWARD_RATE) / RATE_PRECISION);

      // Set fee to 100%, meaning 0 net tokens are received
      await feeFundingToken.setFeePercent(100);
      await feeFundingToken.mint(backer.address, ethers.parseEther("100"));
      await feeFundingToken.connect(backer).approve(campaignAddress, ethers.parseEther("100"));

      await expect(campaign.connect(backer).pledge(ethers.parseEther("100"))).to.be.revertedWithCustomError(
        campaign,
        "ZeroAmount"
      );
    });
  });

  describe("Excess Reward Dust Recovery", function () {
    it("should allow creator to recover excess reward tokens and dust upon success", async function () {
      const { campaign, fundingToken, rewardToken, creator, alice, bob, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );

      // Fund to threshold
      await fundingToken.connect(alice).approve(campaignAddress, ethers.parseEther("600"));
      await campaign.connect(alice).pledge(ethers.parseEther("600"));

      await fundingToken.connect(bob).approve(campaignAddress, ethers.parseEther("400"));
      await campaign.connect(bob).pledge(ethers.parseEther("400"));

      expect(await campaign.state()).to.equal(1); // Successful

      // Alice claims rewards: 600 * 2 = 1200 reward tokens
      await campaign.connect(alice).claimReward();
      expect(await campaign.totalRewardsClaimed()).to.equal(ethers.parseEther("1200"));

      // Currently, contract has 800 remaining reward tokens for Bob (collateral was 2000, 2000 - 1200 = 800)
      // Attempting to recover excess rewards should revert with NoExcessRewards
      await expect(campaign.connect(creator).recoverExcessRewards()).to.be.revertedWithCustomError(
        campaign,
        "NoExcessRewards"
      );

      // Non-creator cannot call recoverExcessRewards
      await expect(campaign.connect(alice).recoverExcessRewards()).to.be.revertedWithCustomError(
        campaign,
        "Unauthorized"
      );

      // Simulate excess reward tokens (e.g., donated tokens or rounding dust surplus)
      const surplus = ethers.parseEther("250");
      await rewardToken.mint(campaignAddress, surplus);

      const creatorRewardBefore = await rewardToken.balanceOf(creator.address);

      // Creator sweeps excess tokens
      await expect(campaign.connect(creator).recoverExcessRewards())
        .to.emit(campaign, "ExcessRewardsRecovered")
        .withArgs(creator.address, surplus);

      const creatorRewardAfter = await rewardToken.balanceOf(creator.address);
      expect(creatorRewardAfter - creatorRewardBefore).to.equal(surplus);

      // Second recovery reverts since excess was already swept
      await expect(campaign.connect(creator).recoverExcessRewards()).to.be.revertedWithCustomError(
        campaign,
        "NoExcessRewards"
      );

      // Bob can still claim his exact 800 reward tokens without failure!
      await expect(campaign.connect(bob).claimReward())
        .to.emit(campaign, "RewardsClaimed")
        .withArgs(bob.address, ethers.parseEther("800"));
      expect(await campaign.totalRewardsClaimed()).to.equal(ethers.parseEther("2000"));
    });

    it("should revert recoverExcessRewards if campaign is not successful", async function () {
      const { campaign, creator } = await loadFixture(deployCampaignFixture);
      // Campaign is still Active
      await expect(campaign.connect(creator).recoverExcessRewards()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotSuccessful"
      );
    });
  });
});
