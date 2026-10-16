const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("StakingContract", function () {
  let mockToken;
  let stakingContract;
  let owner;
  let user1;
  let user2;
  const initialSupply = 1000000; // 1 million tokens
  const rewardRate = ethers.parseUnits("0.01", 18); // 0.01 tokens per second

  beforeEach(async function () {
    // Get signers
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy MockToken
    const MockToken = await ethers.getContractFactory("MockToken");
    mockToken = await MockToken.deploy("Quantlink Token", "QNTL", initialSupply);
    await mockToken.waitForDeployment();

    // Deploy StakingContract
    const StakingContract = await ethers.getContractFactory("StakingContract");
    stakingContract = await StakingContract.deploy(await mockToken.getAddress(), rewardRate);
    await stakingContract.waitForDeployment();

    // Transfer some tokens to users for testing
    await mockToken.transfer(user1.address, ethers.parseUnits("10000", 18));
    await mockToken.transfer(user2.address, ethers.parseUnits("10000", 18));

    // Transfer some tokens to the staking contract for rewards
    await mockToken.transfer(await stakingContract.getAddress(), ethers.parseUnits("100000", 18));
  });

  describe("Deployment", function () {
    it("Should set the correct token and reward rate", async function () {
      expect(await stakingContract.stakingToken()).to.equal(await mockToken.getAddress());
      expect(await stakingContract.rewardRate()).to.equal(rewardRate);
    });

    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await mockToken.balanceOf(owner.address);
      const user1Balance = await mockToken.balanceOf(user1.address);
      const user2Balance = await mockToken.balanceOf(user2.address);
      const contractBalance = await mockToken.balanceOf(await stakingContract.getAddress());

      const totalDistributed = ownerBalance + user1Balance + user2Balance + contractBalance;
      expect(await mockToken.totalSupply()).to.equal(totalDistributed);
    });
  });

  describe("Staking", function () {
    it("Should allow users to stake tokens", async function () {
      const stakeAmount = ethers.parseUnits("1000", 18);

      // Approve tokens for staking
      await mockToken.connect(user1).approve(await stakingContract.getAddress(), stakeAmount);

      // Stake tokens
      await stakingContract.connect(user1).stake(stakeAmount);

      // Check staked balance
      expect(await stakingContract.getStakedBalance(user1.address)).to.equal(stakeAmount);

      // Check total staked
      expect(await stakingContract.getTotalStaked()).to.equal(stakeAmount);
    });

    it("Should not allow staking zero tokens", async function () {
      await expect(stakingContract.connect(user1).stake(0)).to.be.revertedWith("Cannot stake 0");
    });

    it("Should fail if user tries to stake more than their balance", async function () {
      const userBalance = await mockToken.balanceOf(user1.address);
      const stakeAmount = userBalance + 1n;

      // Approve tokens for staking
      await mockToken.connect(user1).approve(await stakingContract.getAddress(), stakeAmount);

      // Try to stake more than balance
      await expect(stakingContract.connect(user1).stake(stakeAmount)).to.be.reverted;
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      // Stake some tokens first
      const stakeAmount = ethers.parseUnits("1000", 18);
      await mockToken.connect(user1).approve(await stakingContract.getAddress(), stakeAmount);
      await stakingContract.connect(user1).stake(stakeAmount);
    });

    it("Should allow users to unstake tokens", async function () {
      const unstakeAmount = ethers.parseUnits("500", 18);

      // Unstake tokens
      await stakingContract.connect(user1).unstake(unstakeAmount);

      // Check staked balance
      expect(await stakingContract.getStakedBalance(user1.address)).to.equal(
        ethers.parseUnits("500", 18)
      );

      // Check total staked
      expect(await stakingContract.getTotalStaked()).to.equal(
        ethers.parseUnits("500", 18)
      );
    });

    it("Should not allow unstaking zero tokens", async function () {
      await expect(stakingContract.connect(user1).unstake(0)).to.be.revertedWith("Cannot unstake 0");
    });

    it("Should not allow unstaking more than staked", async function () {
      const stakedBalance = await stakingContract.getStakedBalance(user1.address);
      const unstakeAmount = stakedBalance + 1n;

      // Try to unstake more than staked
      await expect(stakingContract.connect(user1).unstake(unstakeAmount)).to.be.revertedWith(
        "Not enough staked tokens"
      );
    });
  });

  describe("Rewards", function () {
    beforeEach(async function () {
      // Stake some tokens first
      const stakeAmount = ethers.parseUnits("1000", 18);
      await mockToken.connect(user1).approve(await stakingContract.getAddress(), stakeAmount);
      await stakingContract.connect(user1).stake(stakeAmount);
    });

    it("Should accumulate rewards over time", async function () {
      // Fast forward time by 1 day
      await time.increase(86400); // 1 day in seconds

      // Check earned rewards
      const earned = await stakingContract.earned(user1.address);

      // Expected rewards: rewardRate * time
      const expectedRewards = rewardRate * 86400n;

      // Allow for small rounding differences
      expect(earned).to.be.closeTo(expectedRewards, ethers.parseUnits("0.1", 18));
    });

    it("Should allow claiming rewards", async function () {
      // Fast forward time by 1 day
      await time.increase(86400); // 1 day in seconds

      // Get initial balance
      const initialBalance = await mockToken.balanceOf(user1.address);

      // Claim rewards
      await stakingContract.connect(user1).claimReward();

      // Check new balance
      const newBalance = await mockToken.balanceOf(user1.address);

      // Balance should have increased
      expect(newBalance).to.be.gt(initialBalance);

      // Earned rewards should be reset
      expect(await stakingContract.earned(user1.address)).to.equal(0);
    });

    it("Should distribute rewards correctly between multiple stakers", async function () {
      // User2 stakes the same amount
      const stakeAmount = ethers.parseUnits("1000", 18);
      await mockToken.connect(user2).approve(await stakingContract.getAddress(), stakeAmount);
      await stakingContract.connect(user2).stake(stakeAmount);

      // Fast forward time by 1 day
      await time.increase(86400); // 1 day in seconds

      // Check earned rewards for both users
      const earned1 = await stakingContract.earned(user1.address);
      const earned2 = await stakingContract.earned(user2.address);

      // Both users should have earned approximately the same amount
      expect(earned1).to.be.closeTo(earned2, ethers.parseUnits("0.1", 18));

      // Total rewards should be approximately rewardRate * time
      const totalEarned = earned1 + earned2;
      const expectedTotalRewards = rewardRate * 86400n;
      expect(totalEarned).to.be.closeTo(expectedTotalRewards, ethers.parseUnits("0.1", 18));
    });
  });
});
