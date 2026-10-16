const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TokenVesting", function () {
  let token;
  let vesting;
  let owner;
  let beneficiary;
  
  const TOKEN_NAME = "Test Token";
  const TOKEN_SYMBOL = "TEST";
  const INITIAL_SUPPLY = 1000000;
  const DECIMALS = 18;

  beforeEach(async function () {
    [owner, beneficiary] = await ethers.getSigners();
    
    // Deploy token
    const BaseToken = await ethers.getContractFactory("BaseToken");
    token = await BaseToken.deploy(TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, DECIMALS);
    await token.waitForDeployment();

    // Deploy vesting
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    vesting = await TokenVesting.deploy(await token.getAddress());
    await vesting.waitForDeployment();
  });

  describe("Vesting Schedule Creation", function () {
    it("Should create a vesting schedule", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const duration = 365 * 24 * 60 * 60; // 1 year

      // Approve tokens
      await token.approve(await vesting.getAddress(), amount);

      // Create vesting schedule
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        cliffDuration,
        duration,
        false
      );

      const schedule = await vesting.vestingSchedules(beneficiary.address);
      expect(schedule.totalAmount).to.equal(amount);
      expect(schedule.startTime).to.equal(startTime);
    });

    it("Should fail if beneficiary is zero address", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();

      await token.approve(await vesting.getAddress(), amount);

      await expect(
        vesting.createVestingSchedule(
          ethers.ZeroAddress,
          amount,
          startTime,
          0,
          365 * 24 * 60 * 60,
          false
        )
      ).to.be.revertedWith("Beneficiary cannot be zero address");
    });

    it("Should fail if amount is zero", async function () {
      const startTime = await time.latest();

      await expect(
        vesting.createVestingSchedule(
          beneficiary.address,
          0,
          startTime,
          0,
          365 * 24 * 60 * 60,
          false
        )
      ).to.be.revertedWith("Amount must be greater than 0");
    });
  });

  describe("Token Release", function () {
    it("Should release vested tokens after cliff", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const duration = 365 * 24 * 60 * 60; // 1 year

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        cliffDuration,
        duration,
        false
      );

      // Move time past cliff
      await time.increase(cliffDuration + 1);

      // Release tokens
      await vesting.connect(beneficiary).release();

      const balance = await token.balanceOf(beneficiary.address);
      expect(balance).to.be.gt(0);
    });

    it("Should not release tokens before cliff", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const cliffDuration = 30 * 24 * 60 * 60;
      const duration = 365 * 24 * 60 * 60;

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        cliffDuration,
        duration,
        false
      );

      // Try to release before cliff
      await expect(
        vesting.connect(beneficiary).release()
      ).to.be.revertedWith("No tokens to release");
    });

    it("Should release all tokens after vesting period", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const duration = 365 * 24 * 60 * 60;

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        0,
        duration,
        false
      );

      // Move time past vesting period
      await time.increase(duration + 1);

      // Release tokens
      await vesting.connect(beneficiary).release();

      const balance = await token.balanceOf(beneficiary.address);
      expect(balance).to.equal(amount);
    });
  });

  describe("Vesting Revocation", function () {
    it("Should allow owner to revoke revocable vesting", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const duration = 365 * 24 * 60 * 60;

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        0,
        duration,
        true // revocable
      );

      // Revoke vesting
      await vesting.revoke(beneficiary.address);

      const schedule = await vesting.vestingSchedules(beneficiary.address);
      expect(schedule.revoked).to.be.true;
    });

    it("Should fail to revoke non-revocable vesting", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const duration = 365 * 24 * 60 * 60;

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        0,
        duration,
        false // not revocable
      );

      await expect(
        vesting.revoke(beneficiary.address)
      ).to.be.revertedWith("Vesting not revocable");
    });
  });

  describe("View Functions", function () {
    it("Should return correct releasable amount", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const duration = 100; // 100 seconds for easy testing

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        0,
        duration,
        false
      );

      // Move time to 50% of vesting period
      await time.increase(50);

      const releasable = await vesting.getReleasableAmount(beneficiary.address);
      // Allow larger tolerance due to block timestamp precision
      expect(releasable).to.be.closeTo(amount / 2n, ethers.parseUnits("100", DECIMALS));
    });
  });
});
