const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SubscriptionService", function () {
  let subscriptionService;
  let token;
  let owner;
  let subscriber1;
  let subscriber2;
  let treasury;
  let planId;

  const PRICE = ethers.parseEther("1");
  const PERIOD = 86400n; // 1 day in seconds

  beforeEach(async function () {
    [owner, subscriber1, subscriber2, treasury] = await ethers.getSigners();

    // Deploy mock ERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Deploy SubscriptionService
    const SubscriptionService = await ethers.getContractFactory("SubscriptionService");
    subscriptionService = await SubscriptionService.deploy(await token.getAddress(), treasury.address);
    await subscriptionService.waitForDeployment();

    // Mint tokens and approve for subscribers
    await token.mint(subscriber1.address, ethers.parseEther("100"));
    await token.mint(subscriber2.address, ethers.parseEther("100"));
    await token.connect(subscriber1).approve(await subscriptionService.getAddress(), ethers.MaxUint256);
    await token.connect(subscriber2).approve(await subscriptionService.getAddress(), ethers.MaxUint256);

    // Create a test plan
    const tx = await subscriptionService.connect(owner).createPlan(PRICE, PERIOD);
    const receipt = await tx.wait();
    planId = receipt.logs[0].args[0];
  });

  describe("Plan Management", function () {
    it("Should create a new plan", async function () {
      const tx = await subscriptionService.connect(owner).createPlan(ethers.parseEther("2"), PERIOD * 2n);
      const receipt = await tx.wait();

      expect(receipt.logs[0].args[0]).to.equal(1n);
      expect(receipt.logs[0].args[1]).to.equal(ethers.parseEther("2"));
      expect(receipt.logs[0].args[2]).to.equal(PERIOD * 2n);

      const planCount = await subscriptionService.planCount();
      expect(planCount).to.equal(2n);
    });

    it("Should deactivate a plan", async function () {
      const tx = await subscriptionService.connect(owner).deactivatePlan(planId);
      const receipt = await tx.wait();

      expect(receipt.logs[0].args[0]).to.equal(planId);
    });

    it("Should revert when creating invalid plan", async function () {
      await expect(subscriptionService.connect(owner).createPlan(0, PERIOD))
        .to.be.revertedWith("Invalid plan");
      await expect(subscriptionService.connect(owner).createPlan(PRICE, 0))
        .to.be.revertedWith("Invalid plan");
    });

    it("Should revert when non-owner creates plan", async function () {
      await expect(subscriptionService.connect(subscriber1).createPlan(PRICE, PERIOD))
        .to.be.revertedWith("Not owner");
    });

    it("Should revert when non-owner deactivates plan", async function () {
      await expect(subscriptionService.connect(subscriber1).deactivatePlan(planId))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Subscription Management", function () {
    it("Should allow subscription", async function () {
      const tx = await subscriptionService.connect(subscriber1).subscribe(planId);
      const receipt = await tx.wait();

      expect(receipt.logs[0].args[0]).to.equal(subscriber1.address);
      expect(receipt.logs[0].args[1]).to.equal(planId);
      expect(receipt.logs[1].args[0]).to.equal(subscriber1.address);
      expect(receipt.logs[1].args[1]).to.equal(planId);
      expect(receipt.logs[1].args[2]).to.equal(PRICE);

      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.planId).to.equal(planId);
      expect(subscription.active).to.be.true;
    });

    it("Should revert when subscribing to invalid plan", async function () {
      await expect(subscriptionService.connect(subscriber1).subscribe(999n))
        .to.be.revertedWith("Invalid plan");
    });

    it("Should revert when subscribing to inactive plan", async function () {
      await subscriptionService.connect(owner).deactivatePlan(planId);
      await expect(subscriptionService.connect(subscriber1).subscribe(planId))
        .to.be.revertedWith("Invalid plan");
    });

    it("Should revert when already subscribed", async function () {
      await subscriptionService.connect(subscriber1).subscribe(planId);
      await expect(subscriptionService.connect(subscriber1).subscribe(planId))
        .to.be.revertedWith("Already subscribed");
    });

    it("Should cancel subscription", async function () {
      await subscriptionService.connect(subscriber1).subscribe(planId);
      const tx = await subscriptionService.connect(subscriber1).cancel();
      const receipt = await tx.wait();

      expect(receipt.logs[0].args[0]).to.equal(subscriber1.address);

      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.active).to.be.false;
    });

    it("Should revert when canceling non-existent subscription", async function () {
      await expect(subscriptionService.connect(subscriber1).cancel())
        .to.be.revertedWith("Not subscribed");
    });
  });

  describe("Charging", function () {
    it("Should charge subscriber", async function () {
      await subscriptionService.connect(subscriber1).subscribe(planId);

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [Number(PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      const tx = await subscriptionService.connect(subscriber2).charge(subscriber1.address);
      const receipt = await tx.wait();

      expect(receipt.logs[0].args[0]).to.equal(subscriber1.address);
      expect(receipt.logs[0].args[1]).to.equal(planId);
      expect(receipt.logs[0].args[2]).to.equal(PRICE);

      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.nextDue).to.be.gt(0n);
    });

    it("Should revert when charging non-subscriber", async function () {
      await expect(subscriptionService.connect(subscriber2).charge(subscriber1.address))
        .to.be.revertedWith("Not subscribed");
    });

    it("Should revert when charging before due time", async function () {
      await subscriptionService.connect(subscriber1).subscribe(planId);
      await expect(subscriptionService.connect(subscriber2).charge(subscriber1.address))
        .to.be.revertedWith("Not due yet");
    });

    it("Should cancel subscription when charge fails", async function () {
      await subscriptionService.connect(subscriber1).subscribe(planId);

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [Number(PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Revoke allowance to make charge fail
      await token.connect(subscriber1).approve(await subscriptionService.getAddress(), 0);

      const tx = await subscriptionService.connect(subscriber2).charge(subscriber1.address);
      const receipt = await tx.wait();

      expect(receipt.logs[0].args[0]).to.equal(subscriber1.address);

      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.active).to.be.false;
    });
  });

  describe("View Functions", function () {
    it("Should return correct isActive status", async function () {
      expect(await subscriptionService.isActive(subscriber1.address)).to.be.false;

      await subscriptionService.connect(subscriber1).subscribe(planId);
      expect(await subscriptionService.isActive(subscriber1.address)).to.be.true;

      await subscriptionService.connect(subscriber1).cancel();
      expect(await subscriptionService.isActive(subscriber1.address)).to.be.false;
    });

    it("Should return correct plan count", async function () {
      expect(await subscriptionService.planCount()).to.equal(1n);

      await subscriptionService.connect(owner).createPlan(ethers.parseEther("2"), PERIOD * 2n);
      expect(await subscriptionService.planCount()).to.equal(2n);
    });
  });
});