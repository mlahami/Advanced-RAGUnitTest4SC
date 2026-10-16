const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SubscriptionService", function () {
  let subscriptionService;
  let token;
  let owner;
  let treasury;
  let subscriber1;
  let subscriber2;
  let subscribers;

  const PRICE = ethers.parseEther("1");
  const PERIOD = 86400n; // 1 day in seconds

  beforeEach(async function () {
    [owner, treasury, subscriber1, subscriber2, ...subscribers] = await ethers.getSigners();

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
    await token.approve(subscriptionService.getAddress(), ethers.MaxUint256, subscriber1);
    await token.approve(subscriptionService.getAddress(), ethers.MaxUint256, subscriber2);
  });

  describe("Plan Management", function () {
    it("should create a new plan", async function () {
      const tx = await subscriptionService.createPlan(PRICE, PERIOD);
      const receipt = await tx.wait();

      expect(await subscriptionService.planCount()).to.equal(1);
      expect(receipt.logs[0].fragment.name).to.equal("PlanCreated");
      expect(receipt.logs[0].args.planId).to.equal(0n);
      expect(receipt.logs[0].args.price).to.equal(PRICE);
      expect(receipt.logs[0].args.period).to.equal(PERIOD);
    });

    it("should deactivate a plan", async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
      const tx = await subscriptionService.deactivatePlan(0);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("PlanDeactivated");
      expect(receipt.logs[0].args.planId).to.equal(0n);
    });

    it("should revert when creating invalid plan", async function () {
      await expect(subscriptionService.createPlan(0, PERIOD))
        .to.be.revertedWith("Invalid plan");
      await expect(subscriptionService.createPlan(PRICE, 0))
        .to.be.revertedWith("Invalid plan");
    });

    it("should revert when non-owner tries to create plan", async function () {
      await expect(subscriptionService.connect(subscriber1).createPlan(PRICE, PERIOD))
        .to.be.revertedWith("Not owner");
    });

    it("should revert when non-owner tries to deactivate plan", async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
      await expect(subscriptionService.connect(subscriber1).deactivatePlan(0))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Subscription Management", function () {
    beforeEach(async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
    });

    it("should subscribe to a plan", async function () {
      const tx = await subscriptionService.connect(subscriber1).subscribe(0);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("Subscribed");
      expect(receipt.logs[0].args.subscriber).to.equal(subscriber1.address);
      expect(receipt.logs[0].args.planId).to.equal(0n);

      expect(receipt.logs[1].fragment.name).to.equal("Charged");
      expect(receipt.logs[1].args.subscriber).to.equal(subscriber1.address);
      expect(receipt.logs[1].args.planId).to.equal(0n);
      expect(receipt.logs[1].args.amount).to.equal(PRICE);

      expect(await subscriptionService.isActive(subscriber1.address)).to.be.true;
    });

    it("should cancel subscription", async function () {
      await subscriptionService.connect(subscriber1).subscribe(0);
      const tx = await subscriptionService.connect(subscriber1).cancel();
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("Cancelled");
      expect(receipt.logs[0].args.subscriber).to.equal(subscriber1.address);
      expect(await subscriptionService.isActive(subscriber1.address)).to.be.false;
    });

    it("should revert when subscribing to invalid plan", async function () {
      await expect(subscriptionService.connect(subscriber1).subscribe(1))
        .to.be.revertedWith("Invalid plan");
    });

    it("should revert when subscribing to inactive plan", async function () {
      await subscriptionService.deactivatePlan(0);
      await expect(subscriptionService.connect(subscriber1).subscribe(0))
        .to.be.revertedWith("Invalid plan");
    });

    it("should revert when already subscribed", async function () {
      await subscriptionService.connect(subscriber1).subscribe(0);
      await expect(subscriptionService.connect(subscriber1).subscribe(0))
        .to.be.revertedWith("Already subscribed");
    });

    it("should revert when payment fails", async function () {
      // Reduce allowance to less than price
      await token.connect(subscriber1).approve(subscriptionService.getAddress(), PRICE - 1n);
      await expect(subscriptionService.connect(subscriber1).subscribe(0))
        .to.be.revertedWith("Payment failed");
    });

    it("should revert when canceling without subscription", async function () {
      await expect(subscriptionService.connect(subscriber1).cancel())
        .to.be.revertedWith("Not subscribed");
    });
  });

  describe("Charge Management", function () {
    beforeEach(async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
      await subscriptionService.connect(subscriber1).subscribe(0);
    });

    it("should charge a subscriber", async function () {
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [Number(PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      const tx = await subscriptionService.charge(subscriber1.address);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("Charged");
      expect(receipt.logs[0].args.subscriber).to.equal(subscriber1.address);
      expect(receipt.logs[0].args.planId).to.equal(0n);
      expect(receipt.logs[0].args.amount).to.equal(PRICE);
    });

    it("should cancel subscription when charge fails", async function () {
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [Number(PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Reduce allowance to less than price
      await token.connect(subscriber1).approve(subscriptionService.getAddress(), PRICE - 1n);

      const tx = await subscriptionService.charge(subscriber1.address);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("Cancelled");
      expect(receipt.logs[0].args.subscriber).to.equal(subscriber1.address);
      expect(await subscriptionService.isActive(subscriber1.address)).to.be.false;
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