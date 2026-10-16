const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SubscriptionService", function () {
  let subscriptionService;
  let token;
  let owner;
  let subscriber1;
  let subscriber2;
  let treasury;

  const PRICE = ethers.parseEther("1");
  const PERIOD = 86400n; // 1 day in seconds

  beforeEach(async function () {
    [owner, subscriber1, subscriber2, treasury] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Deploy SubscriptionService
    const SubscriptionService = await ethers.getContractFactory("SubscriptionService");
    subscriptionService = await SubscriptionService.deploy(await token.getAddress(), treasury.address);
    await subscriptionService.waitForDeployment();

    // Mint tokens and approve subscription service
    await token.mint(subscriber1.address, ethers.parseEther("100"));
    await token.mint(subscriber2.address, ethers.parseEther("100"));
    await token.connect(subscriber1).approve(await subscriptionService.getAddress(), ethers.MaxUint256);
    await token.connect(subscriber2).approve(await subscriptionService.getAddress(), ethers.MaxUint256);
  });

  describe("Plan Management", function () {
    it("Should create a new plan", async function () {
      const tx = await subscriptionService.createPlan(PRICE, PERIOD);
      const receipt = await tx.wait();

      expect(await subscriptionService.planCount()).to.equal(1);
      expect(receipt.logs[0].fragment.name).to.equal("PlanCreated");
      expect(receipt.logs[0].args.planId).to.equal(0n);
      expect(receipt.logs[0].args.price).to.equal(PRICE);
      expect(receipt.logs[0].args.period).to.equal(PERIOD);
    });

    it("Should deactivate a plan", async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
      const tx = await subscriptionService.deactivatePlan(0);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("PlanDeactivated");
      expect(receipt.logs[0].args.planId).to.equal(0n);
    });

    it("Should revert when creating invalid plan", async function () {
      await expect(subscriptionService.createPlan(0, PERIOD)).to.be.revertedWith("Invalid plan");
      await expect(subscriptionService.createPlan(PRICE, 0)).to.be.revertedWith("Invalid plan");
    });

    it("Should revert when non-owner tries to create plan", async function () {
      await expect(subscriptionService.connect(subscriber1).createPlan(PRICE, PERIOD))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Subscription Management", function () {
    beforeEach(async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
    });

    it("Should subscribe to a plan", async function () {
      const initialBalance = await token.balanceOf(subscriber1.address);
      const tx = await subscriptionService.connect(subscriber1).subscribe(0);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("Subscribed");
      expect(receipt.logs[0].args.subscriber).to.equal(subscriber1.address);
      expect(receipt.logs[0].args.planId).to.equal(0n);

      expect(receipt.logs[1].fragment.name).to.equal("Charged");
      expect(receipt.logs[1].args.subscriber).to.equal(subscriber1.address);
      expect(receipt.logs[1].args.planId).to.equal(0n);
      expect(receipt.logs[1].args.amount).to.equal(PRICE);

      const finalBalance = await token.balanceOf(subscriber1.address);
      expect(finalBalance).to.equal(initialBalance - PRICE);

      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.planId).to.equal(0n);
      expect(subscription.active).to.be.true;
    });

    it("Should cancel subscription", async function () {
      await subscriptionService.connect(subscriber1).subscribe(0);
      const tx = await subscriptionService.connect(subscriber1).cancel();
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("Cancelled");
      expect(receipt.logs[0].args.subscriber).to.equal(subscriber1.address);

      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.active).to.be.false;
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

    it("Should revert when payment fails", async function () {
      // Burn all tokens to make payment fail
      await token.connect(subscriber1).burnFrom(subscriber1.address, ethers.parseEther("100"));
      await expect(subscriptionService.connect(subscriber1).subscribe(0))
        .to.be.revertedWith("Payment failed");
    });
  });

  describe("Charge Management", function () {
    beforeEach(async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
      await subscriptionService.connect(subscriber1).subscribe(0);
    });

    it("Should charge a subscriber", async function () {
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [Number(PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      const initialBalance = await token.balanceOf(subscriber1.address);
      const tx = await subscriptionService.charge(subscriber1.address);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("Charged");
      expect(receipt.logs[0].args.subscriber).to.equal(subscriber1.address);
      expect(receipt.logs[0].args.planId).to.equal(0n);
      expect(receipt.logs[0].args.amount).to.equal(PRICE);

      const finalBalance = await token.balanceOf(subscriber1.address);
      expect(finalBalance).to.equal(initialBalance - PRICE);

      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.nextDue).to.be.gt(await ethers.provider.getBlock("latest").timestamp);
    });

    it("Should cancel subscription when charge fails", async function () {
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [Number(PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Burn all tokens to make charge fail
      await token.connect(subscriber1).burnFrom(subscriber1.address, ethers.parseEther("100"));
      const tx = await subscriptionService.charge(subscriber1.address);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("Cancelled");
      expect(receipt.logs[0].args.subscriber).to.equal(subscriber1.address);

      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.active).to.be.false;
    });

    it("Should revert when not subscribed", async function () {
      await expect(subscriptionService.charge(subscriber2.address))
        .to.be.revertedWith("Not subscribed");
    });

    it("Should revert when not due yet", async function () {
      await expect(subscriptionService.charge(subscriber1.address))
        .to.be.revertedWith("Not due yet");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
      await subscriptionService.connect(subscriber1).subscribe(0);
    });

    it("Should return correct isActive status", async function () {
      expect(await subscriptionService.isActive(subscriber1.address)).to.be.true;
      expect(await subscriptionService.isActive(subscriber2.address)).to.be.false;
    });

    it("Should return correct plan count", async function () {
      expect(await subscriptionService.planCount()).to.equal(1n);
    });
  });
});