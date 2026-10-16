const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SubscriptionService", function () {
  let subscriptionService;
  let token;
  let owner;
  let treasury;
  let subscriber1;
  let subscriber2;
  let planId;

  beforeEach(async function () {
    [owner, treasury, subscriber1, subscriber2] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Deploy SubscriptionService
    const SubscriptionService = await ethers.getContractFactory("SubscriptionService");
    subscriptionService = await SubscriptionService.deploy(await token.getAddress(), treasury.address);
    await subscriptionService.waitForDeployment();

    // Create a test plan
    const tx = await subscriptionService.createPlan(ethers.parseEther("1"), 86400n); // 1 token per day
    const receipt = await tx.wait();
    planId = receipt.logs[0].args[0];
  });

  describe("Plan Management", function () {
    it("should create a plan", async function () {
      const price = ethers.parseEther("2");
      const period = 3600n; // 1 hour

      const tx = await subscriptionService.createPlan(price, period);
      const receipt = await tx.wait();

      expect(receipt.logs[0].eventName).to.equal("PlanCreated");
      expect(receipt.logs[0].args[0]).to.equal(1n); // planId
      expect(receipt.logs[0].args[1]).to.equal(price);
      expect(receipt.logs[0].args[2]).to.equal(period);

      const planCount = await subscriptionService.planCount();
      expect(planCount).to.equal(2n);
    });

    it("should deactivate a plan", async function () {
      const tx = await subscriptionService.deactivatePlan(planId);
      const receipt = await tx.wait();

      expect(receipt.logs[0].eventName).to.equal("PlanDeactivated");
      expect(receipt.logs[0].args[0]).to.equal(planId);
    });

    it("should revert when creating invalid plan", async function () {
      await expect(subscriptionService.createPlan(0, 86400n))
        .to.be.revertedWith("Invalid plan");
      await expect(subscriptionService.createPlan(ethers.parseEther("1"), 0))
        .to.be.revertedWith("Invalid plan");
    });

    it("should revert when non-owner tries to create plan", async function () {
      await expect(subscriptionService.connect(subscriber1).createPlan(ethers.parseEther("1"), 86400n))
        .to.be.revertedWith("Not owner");
    });

    it("should revert when non-owner tries to deactivate plan", async function () {
      await expect(subscriptionService.connect(subscriber1).deactivatePlan(planId))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Subscription Management", function () {
    beforeEach(async function () {
      // Mint and approve tokens for subscriber1
      await token.mint(subscriber1.address, ethers.parseEther("10"));
      await token.connect(subscriber1).approve(await subscriptionService.getAddress(), ethers.parseEther("10"));
    });

    it("should subscribe to a plan", async function () {
      const tx = await subscriptionService.connect(subscriber1).subscribe(planId);
      const receipt = await tx.wait();

      expect(receipt.logs[0].eventName).to.equal("Subscribed");
      expect(receipt.logs[0].args[0]).to.equal(subscriber1.address);
      expect(receipt.logs[0].args[1]).to.equal(planId);

      expect(receipt.logs[1].eventName).to.equal("Charged");
      expect(receipt.logs[1].args[0]).to.equal(subscriber1.address);
      expect(receipt.logs[1].args[1]).to.equal(planId);
      expect(receipt.logs[1].args[2]).to.equal(ethers.parseEther("1"));

      const isActive = await subscriptionService.isActive(subscriber1.address);
      expect(isActive).to.be.true;
    });

    it("should cancel subscription", async function () {
      await subscriptionService.connect(subscriber1).subscribe(planId);
      const tx = await subscriptionService.connect(subscriber1).cancel();
      const receipt = await tx.wait();

      expect(receipt.logs[0].eventName).to.equal("Cancelled");
      expect(receipt.logs[0].args[0]).to.equal(subscriber1.address);

      const isActive = await subscriptionService.isActive(subscriber1.address);
      expect(isActive).to.be.false;
    });

    it("should revert when subscribing to invalid plan", async function () {
      await expect(subscriptionService.connect(subscriber1).subscribe(999n))
        .to.be.revertedWith("Invalid plan");
    });

    it("should revert when subscribing to inactive plan", async function () {
      await subscriptionService.deactivatePlan(planId);
      await expect(subscriptionService.connect(subscriber1).subscribe(planId))
        .to.be.revertedWith("Invalid plan");
    });

    it("should revert when already subscribed", async function () {
      await subscriptionService.connect(subscriber1).subscribe(planId);
      await expect(subscriptionService.connect(subscriber1).subscribe(planId))
        .to.be.revertedWith("Already subscribed");
    });

    it("should revert when payment fails", async function () {
      // Subscriber2 has no tokens
      await expect(subscriptionService.connect(subscriber2).subscribe(planId))
        .to.be.revertedWith("Payment failed");
    });

    it("should revert when canceling without subscription", async function () {
      await expect(subscriptionService.connect(subscriber1).cancel())
        .to.be.revertedWith("Not subscribed");
    });
  });

  describe("Charging", function () {
    beforeEach(async function () {
      // Mint and approve tokens for subscriber1
      await token.mint(subscriber1.address, ethers.parseEther("10"));
      await token.connect(subscriber1).approve(await subscriptionService.getAddress(), ethers.parseEther("10"));

      // Subscribe subscriber1
      await subscriptionService.connect(subscriber1).subscribe(planId);
    });

    it("should charge a subscriber", async function () {
      // Fast forward time to make the subscription due
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      const tx = await subscriptionService.charge(subscriber1.address);
      const receipt = await tx.wait();

      expect(receipt.logs[0].eventName).to.equal("Charged");
      expect(receipt.logs[0].args[0]).to.equal(subscriber1.address);
      expect(receipt.logs[0].args[1]).to.equal(planId);
      expect(receipt.logs[0].args[2]).to.equal(ethers.parseEther("1"));
    });

    it("should cancel subscription when charge fails", async function () {
      // Fast forward time to make the subscription due
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      // Reduce allowance to make charge fail
      await token.connect(subscriber1).approve(await subscriptionService.getAddress(), 0);

      const tx = await subscriptionService.charge(subscriber1.address);
      const receipt = await tx.wait();

      expect(receipt.logs[0].eventName).to.equal("Cancelled");
      expect(receipt.logs[0].args[0]).to.equal(subscriber1.address);

      const isActive = await subscriptionService.isActive(subscriber1.address);
      expect(isActive).to.be.false;
    });

    it("should revert when charging non-subscriber", async function () {
      await expect(subscriptionService.charge(subscriber2.address))
        .to.be.revertedWith("Not subscribed");
    });

    it("should revert when charging before due time", async function () {
      await expect(subscriptionService.charge(subscriber1.address))
        .to.be.revertedWith("Not due yet");
    });
  });
});