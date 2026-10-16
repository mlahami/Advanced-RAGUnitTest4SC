const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SubscriptionService", function () {
  let subscriptionService;
  let token;
  let owner, treasury, subscriber1, subscriber2, other;
  const PRICE = ethers.parseEther("1");
  const PERIOD = 86400n; // 1 day in seconds

  beforeEach(async function () {
    [owner, treasury, subscriber1, subscriber2, other] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const TokenFactory = await ethers.getContractFactory("BenchmarkERC20");
    token = await TokenFactory.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Deploy SubscriptionService
    const SubscriptionServiceFactory = await ethers.getContractFactory("SubscriptionService");
    subscriptionService = await SubscriptionServiceFactory.deploy(
      await token.getAddress(),
      treasury.address
    );
    await subscriptionService.waitForDeployment();

    // Mint tokens and approve for subscribers
    await token.mint(subscriber1.address, ethers.parseEther("100"));
    await token.mint(subscriber2.address, ethers.parseEther("100"));
    await token.connect(subscriber1).approve(await subscriptionService.getAddress(), ethers.MaxUint256);
    await token.connect(subscriber2).approve(await subscriptionService.getAddress(), ethers.MaxUint256);
  });

  describe("Plan Management", function () {
    it("Should create a new plan", async function () {
      const tx = await subscriptionService.createPlan(PRICE, PERIOD);
      const receipt = await tx.wait();

      // Check event emission
      await expect(tx)
        .to.emit(subscriptionService, "PlanCreated")
        .withArgs(0n, PRICE, PERIOD);

      // Check plan count
      expect(await subscriptionService.planCount()).to.equal(1n);

      // Check plan details
      const plan = await subscriptionService.plans(0);
      expect(plan.price).to.equal(PRICE);
      expect(plan.period).to.equal(PERIOD);
      expect(plan.active).to.be.true;
    });

    it("Should deactivate a plan", async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);

      const tx = await subscriptionService.deactivatePlan(0);
      await expect(tx)
        .to.emit(subscriptionService, "PlanDeactivated")
        .withArgs(0n);

      const plan = await subscriptionService.plans(0);
      expect(plan.active).to.be.false;
    });

    it("Should revert when creating invalid plan", async function () {
      await expect(subscriptionService.createPlan(0, PERIOD))
        .to.be.revertedWith("Invalid plan");

      await expect(subscriptionService.createPlan(PRICE, 0))
        .to.be.revertedWith("Invalid plan");
    });

    it("Should revert when non-owner tries to create plan", async function () {
      await expect(subscriptionService.connect(other).createPlan(PRICE, PERIOD))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Subscription Management", function () {
    beforeEach(async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
    });

    it("Should allow subscription", async function () {
      const tx = await subscriptionService.connect(subscriber1).subscribe(0);
      const receipt = await tx.wait();

      // Check event emission
      await expect(tx)
        .to.emit(subscriptionService, "Subscribed")
        .withArgs(subscriber1.address, 0n);

      await expect(tx)
        .to.emit(subscriptionService, "Charged")
        .withArgs(subscriber1.address, 0n, PRICE);

      // Check subscription details
      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.planId).to.equal(0n);
      expect(subscription.active).to.be.true;
      expect(subscription.nextDue).to.be.gt(0n);

      // Check token transfer
      const treasuryBalance = await token.balanceOf(treasury.address);
      expect(treasuryBalance).to.equal(PRICE);
    });

    it("Should revert when subscribing to invalid plan", async function () {
      await expect(subscriptionService.connect(subscriber1).subscribe(1))
        .to.be.revertedWith("Invalid plan");
    });

    it("Should revert when already subscribed", async function () {
      await subscriptionService.connect(subscriber1).subscribe(0);
      await expect(subscriptionService.connect(subscriber1).subscribe(0))
        .to.be.revertedWith("Already subscribed");
    });

    it("Should cancel subscription", async function () {
      await subscriptionService.connect(subscriber1).subscribe(0);

      const tx = await subscriptionService.connect(subscriber1).cancel();
      await expect(tx)
        .to.emit(subscriptionService, "Cancelled")
        .withArgs(subscriber1.address);

      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.active).to.be.false;
    });

    it("Should revert when canceling non-existent subscription", async function () {
      await expect(subscriptionService.connect(subscriber1).cancel())
        .to.be.revertedWith("Not subscribed");
    });
  });

  describe("Charge Management", function () {
    beforeEach(async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
      await subscriptionService.connect(subscriber1).subscribe(0);
    });

    it("Should charge subscriber when due", async function () {
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [Number(PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      const initialTreasuryBalance = await token.balanceOf(treasury.address);

      const tx = await subscriptionService.charge(subscriber1.address);
      await expect(tx)
        .to.emit(subscriptionService, "Charged")
        .withArgs(subscriber1.address, 0n, PRICE);

      // Check token transfer
      const treasuryBalance = await token.balanceOf(treasury.address);
      expect(treasuryBalance).to.equal(initialTreasuryBalance + PRICE);

      // Check next due time
      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.nextDue).to.be.gt(0n);
    });

    it("Should revert when charging not due yet", async function () {
      await expect(subscriptionService.charge(subscriber1.address))
        .to.be.revertedWith("Not due yet");
    });

    it("Should cancel subscription when charge fails", async function () {
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [Number(PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Revoke allowance
      await token.connect(subscriber1).approve(await subscriptionService.getAddress(), 0);

      const tx = await subscriptionService.charge(subscriber1.address);
      await expect(tx)
        .to.emit(subscriptionService, "Cancelled")
        .withArgs(subscriber1.address);

      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.active).to.be.false;
    });

    it("Should revert when charging non-subscriber", async function () {
      await expect(subscriptionService.charge(other.address))
        .to.be.revertedWith("Not subscribed");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
      await subscriptionService.connect(subscriber1).subscribe(0);
    });

    it("Should return correct subscription status", async function () {
      expect(await subscriptionService.isActive(subscriber1.address)).to.be.true;
      expect(await subscriptionService.isActive(other.address)).to.be.false;
    });

    it("Should return correct plan count", async function () {
      expect(await subscriptionService.planCount()).to.equal(1n);
    });
  });
});