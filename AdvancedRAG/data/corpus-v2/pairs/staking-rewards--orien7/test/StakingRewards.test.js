// test/StakingRewards.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("StakingRewards", function () {
  let token, staking, owner, alice, bob;
  const STAKE_AMOUNT = ethers.parseEther("1000");
  const REWARD_POOL  = ethers.parseEther("500000");

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("UDAYToken");
    token = await Token.deploy(owner.address);

    const Staking = await ethers.getContractFactory("StakingRewards");
    staking = await Staking.deploy(await token.getAddress(), owner.address, 1000, 7);

    // Fund staking rewards pool
    await token.mint(owner.address, REWARD_POOL);
    await token.approve(await staking.getAddress(), REWARD_POOL);
    await staking.fundRewards(REWARD_POOL);

    // Give alice & bob tokens
    await token.transfer(alice.address, ethers.parseEther("5000"));
    await token.transfer(bob.address,   ethers.parseEther("5000"));

    // Approve staking contract
    await token.connect(alice).approve(await staking.getAddress(), ethers.parseEther("5000"));
    await token.connect(bob).approve(await staking.getAddress(),   ethers.parseEther("5000"));
  });

  describe("Staking", () => {
    it("should allow staking above minimum", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      const info = await staking.getStakeInfo(alice.address);
      expect(info.amount).to.equal(STAKE_AMOUNT);
    });

    it("should reject stake below minimum", async () => {
      await expect(staking.connect(alice).stake(ethers.parseEther("50")))
        .to.be.revertedWithCustomError(staking, "BelowMinimumStake");
    });

    it("should reject zero stake", async () => {
      await expect(staking.connect(alice).stake(0))
        .to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("should update totalStaked", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await staking.connect(bob).stake(STAKE_AMOUNT);
      expect(await staking.totalStaked()).to.equal(STAKE_AMOUNT * 2n);
    });
  });

  describe("Rewards", () => {
    it("should accrue rewards over time", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await time.increase(365 * 24 * 60 * 60); // 1 year
      const earned = await staking.earned(alice.address);
      // 10% APY on 1000 tokens = ~100 tokens
      expect(earned).to.be.closeTo(ethers.parseEther("100"), ethers.parseEther("1"));
    });

    it("should allow claiming rewards without unstaking", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await time.increase(30 * 24 * 60 * 60); // 30 days
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).claimRewards();
      const after = await token.balanceOf(alice.address);
      expect(after).to.be.gt(before);
    });

    it("should reset rewards after claim", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await time.increase(60 * 24 * 60 * 60);
      await staking.connect(alice).claimRewards();
      const earnedAfter = await staking.earned(alice.address);
      expect(earnedAfter).to.equal(0);
    });
  });

  describe("Unstaking", () => {
    it("should apply penalty before lock period", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).unstake(STAKE_AMOUNT);
      const after = await token.balanceOf(alice.address);
      const received = after - before;
      // Should receive less than staked (5% penalty)
      expect(received).to.be.lt(STAKE_AMOUNT);
    });

    it("should not apply penalty after lock period", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await time.increase(8 * 24 * 60 * 60); // 8 days (past 7-day lock)
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).unstake(STAKE_AMOUNT);
      const after = await token.balanceOf(alice.address);
      const received = after - before;
      expect(received).to.be.gte(STAKE_AMOUNT); // receives stake + rewards
    });

    it("should revert if nothing staked", async () => {
      await expect(staking.connect(bob).unstake(STAKE_AMOUNT))
        .to.be.revertedWithCustomError(staking, "NothingStaked");
    });
  });

  describe("Emergency Withdraw", () => {
    it("should always apply penalty", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await time.increase(30 * 24 * 60 * 60); // past lock
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).emergencyWithdraw();
      const after = await token.balanceOf(alice.address);
      // Should still take penalty even past lock
      expect(after - before).to.be.lt(STAKE_AMOUNT);
    });

    it("should clear stake info", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await staking.connect(alice).emergencyWithdraw();
      const info = await staking.getStakeInfo(alice.address);
      expect(info.amount).to.equal(0);
    });
  });
});
