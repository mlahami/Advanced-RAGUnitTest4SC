const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let token, vesting, owner, beneficiary, other;
  const TOTAL_TOKENS = 1000000n;
  const DECIMALS = 18n;

  beforeEach(async function () {
    [owner, beneficiary, other] = await ethers.getSigners();

    // Deploy token
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TEST");
    await token.waitForDeployment();

    // Mint tokens to owner
    await token.mint(owner.address, ethers.parseUnits(TOTAL_TOKENS.toString(), DECIMALS));

    // Deploy vesting contract
    const Vesting = await ethers.getContractFactory("TokenVesting");
    vesting = await Vesting.deploy(await token.getAddress());
    await vesting.waitForDeployment();

    // Approve vesting contract to spend tokens
    await token.approve(await vesting.getAddress(), ethers.MaxUint256);
  });

  describe("Grant Creation", function () {
    it("Should create a grant with valid parameters", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000) + 1000; // 1000 seconds in future
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      await expect(vesting.createGrant(
        beneficiary.address,
        amount,
        start,
        cliffDuration,
        vestingDuration
      ))
      .to.emit(vesting, "GrantCreated")
      .withArgs(beneficiary.address, 0, amount, start, start + cliffDuration, start + vestingDuration);

      const grantCount = await vesting.grantCount(beneficiary.address);
      expect(grantCount).to.equal(1);
    });

    it("Should revert when creating grant for zero address", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000) + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      await expect(vesting.createGrant(
        ethers.ZeroAddress,
        amount,
        start,
        cliffDuration,
        vestingDuration
      )).to.be.revertedWith("Zero address");
    });

    it("Should revert when creating grant with zero amount", async function () {
      const amount = 0n;
      const start = Math.floor(Date.now() / 1000) + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      await expect(vesting.createGrant(
        beneficiary.address,
        amount,
        start,
        cliffDuration,
        vestingDuration
      )).to.be.revertedWith("Zero amount");
    });

    it("Should revert when creating grant with zero duration", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000) + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 0n;

      await expect(vesting.createGrant(
        beneficiary.address,
        amount,
        start,
        cliffDuration,
        vestingDuration
      )).to.be.revertedWith("Zero duration");
    });

    it("Should revert when end is before cliff", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000) + 1000;
      const cliffDuration = 365 * 24 * 60 * 60; // 1 year
      const vestingDuration = 30 * 24 * 60 * 60; // 30 days

      await expect(vesting.createGrant(
        beneficiary.address,
        amount,
        start,
        cliffDuration,
        vestingDuration
      )).to.be.revertedWith("End before cliff");
    });
  });

  describe("Grant Revocation", function () {
    it("Should revoke a grant and emit event", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000) + 1000;
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      await vesting.createGrant(
        beneficiary.address,
        amount,
        start,
        cliffDuration,
        vestingDuration
      );

      // Fast forward to halfway through vesting period
      await ethers.provider.send("evm_increaseTime", [vestingDuration / 2]);
      await ethers.provider.send("evm_mine");

      const vestedAmount = await vesting.claimable(beneficiary.address, 0);
      const unreleasedAmount = amount - vestedAmount;

      await expect(vesting.revokeGrant(beneficiary.address, 0))
        .to.emit(vesting, "GrantRevoked")
        .withArgs(beneficiary.address, 0, unreleasedAmount);

      // Verify grant was capped at vested amount
      const grant = await vesting.grants(beneficiary.address, 0);
      expect(grant.total).to.equal(vestedAmount);
    });

    it("Should revert when non-owner tries to revoke", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000) + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      await vesting.createGrant(
        beneficiary.address,
        amount,
        start,
        cliffDuration,
        vestingDuration
      );

      await expect(vesting.connect(other).revokeGrant(beneficiary.address, 0))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Token Claiming", function () {
    it("Should allow beneficiary to claim vested tokens", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000) + 1000;
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      await vesting.createGrant(
        beneficiary.address,
        amount,
        start,
        cliffDuration,
        vestingDuration
      );

      // Fast forward past cliff period
      await ethers.provider.send("evm_increaseTime", [cliffDuration + 1000]);
      await ethers.provider.send("evm_mine");

      const claimableAmount = await vesting.claimable(beneficiary.address, 0);
      expect(claimableAmount).to.be.gt(0);

      const initialBalance = await token.balanceOf(beneficiary.address);

      await expect(vesting.connect(beneficiary).claim(0))
        .to.emit(vesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, claimableAmount);

      const finalBalance = await token.balanceOf(beneficiary.address);
      expect(finalBalance).to.equal(initialBalance + claimableAmount);
    });

    it("Should revert when trying to claim nothing", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000) + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      await vesting.createGrant(
        beneficiary.address,
        amount,
        start,
        cliffDuration,
        vestingDuration
      );

      // Try to claim before cliff period
      await expect(vesting.connect(beneficiary).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });

    it("Should revert when non-beneficiary tries to claim", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000) + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      await vesting.createGrant(
        beneficiary.address,
        amount,
        start,
        cliffDuration,
        vestingDuration
      );

      // Fast forward past cliff period
      await ethers.provider.send("evm_increaseTime", [cliffDuration + 1000]);
      await ethers.provider.send("evm_mine");

      await expect(vesting.connect(other).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });
  });

  describe("View Functions", function () {
    it("Should correctly calculate claimable amount", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000) + 1000;
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      await vesting.createGrant(
        beneficiary.address,
        amount,
        start,
        cliffDuration,
        vestingDuration
      );

      // Before cliff period
      let claimable = await vesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(0);

      // After cliff period but before end
      await ethers.provider.send("evm_increaseTime", [cliffDuration + 1000]);
      await ethers.provider.send("evm_mine");

      claimable = await vesting.claimable(beneficiary.address, 0);
      expect(claimable).to.be.gt(0);
      expect(claimable).to.be.lt(amount);

      // After vesting period
      await ethers.provider.send("evm_increaseTime", [vestingDuration - cliffDuration]);
      await ethers.provider.send("evm_mine");

      claimable = await vesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(amount);
    });

    it("Should correctly count grants", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000) + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      // No grants initially
      expect(await vesting.grantCount(beneficiary.address)).to.equal(0);

      // Create first grant
      await vesting.createGrant(
        beneficiary.address,
        amount,
        start,
        cliffDuration,
        vestingDuration
      );
      expect(await vesting.grantCount(beneficiary.address)).to.equal(1);

      // Create second grant
      await vesting.createGrant(
        beneficiary.address,
        amount,
        start + 1000,
        cliffDuration,
        vestingDuration
      );
      expect(await vesting.grantCount(beneficiary.address)).to.equal(2);
    });
  });
});