const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SubscriptionService", function () {
  let subscriptionService;
  let token;
  let owner, treasury, subscriber1, subscriber2, other;
  const PRICE = 100n;
  const PERIOD = 86400n; // 1 day in seconds

  beforeEach(async function () {
    [owner, treasury, subscriber1, subscriber2, other] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Deploy SubscriptionService
    const SubscriptionService = await ethers.getContractFactory("SubscriptionService");
    subscriptionService = await SubscriptionService.deploy(await token.getAddress(), treasury.address);
    await subscriptionService.waitForDeployment();

    // Mint tokens and approve for subscribers
    await token.mint(subscriber1.address, ethers.parseEther("1000"));
    await token.mint(subscriber2.address, ethers.parseEther("1000"));
    await token.connect(subscriber1).approve(await subscriptionService.getAddress(), ethers.MaxUint256);
    await token.connect(subscriber2).approve(await subscriptionService.getAddress(), ethers.MaxUint256);
  });

  describe("Plan Management", function () {
    it("Should create a new plan", async function () {
      const tx = await subscriptionService.createPlan(PRICE, PERIOD);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => {
        try {
          const parsed = subscriptionService.interface.parseLog(log);
          return parsed.name === 'PlanCreated';
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
      const parsed = subscriptionService.interface.parseLog(event);
      expect(parsed.args.planId).to.equal(0n);
      expect(parsed.args.price).to.equal(PRICE);
      expect(parsed.args.period).to.equal(PERIOD);

      // Check state
      const plan = await subscriptionService.plans(0);
      expect(plan.price).to.equal(PRICE);
      expect(plan.period).to.equal(PERIOD);
      expect(plan.active).to.be.true;
      expect(await subscriptionService.planCount()).to.equal(1n);
    });

    it("Should deactivate a plan", async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
      const tx = await subscriptionService.deactivatePlan(0);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => {
        try {
          const parsed = subscriptionService.interface.parseLog(log);
          return parsed.name === 'PlanDeactivated';
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
      const parsed = subscriptionService.interface.parseLog(event);
      expect(parsed.args.planId).to.equal(0n);

      // Check state
      const plan = await subscriptionService.plans(0);
      expect(plan.active).to.be.false;
    });

    it("Should revert when creating invalid plan", async function () {
      await expect(subscriptionService.createPlan(0, PERIOD)).to.be.revertedWith("Invalid plan");
      await expect(subscriptionService.createPlan(PRICE, 0)).to.be.revertedWith("Invalid plan");
    });

    it("Should revert when non-owner tries to create plan", async function () {
      await expect(subscriptionService.connect(other).createPlan(PRICE, PERIOD)).to.be.revertedWith("Not owner");
    });

    it("Should revert when non-owner tries to deactivate plan", async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
      await expect(subscriptionService.connect(other).deactivatePlan(0)).to.be.revertedWith("Not owner");
    });
  });

  describe("Subscription Management", function () {
    beforeEach(async function () {
      await subscriptionService.createPlan(PRICE, PERIOD);
    });

    it("Should subscribe to a plan", async function () {
      const tx = await subscriptionService.connect(subscriber1).subscribe(0);
      const receipt = await tx.wait();

      // Check events
      const subscribedEvent = receipt.logs.find(log => {
        try {
          const parsed = subscriptionService.interface.parseLog(log);
          return parsed.name === 'Subscribed';
        } catch {
          return false;
        }
      });
      expect(subscribedEvent).to.not.be.undefined;
      const parsedSubscribed = subscriptionService.interface.parseLog(subscribedEvent);
      expect(parsedSubscribed.args.subscriber).to.equal(subscriber1.address);
      expect(parsedSubscribed.args.planId).to.equal(0n);

      const chargedEvent = receipt.logs.find(log => {
        try {
          const parsed = subscriptionService.interface.parseLog(log);
          return parsed.name === 'Charged';
        } catch {
          return false;
        }
      });
      expect(chargedEvent).to.not.be.undefined;
      const parsedCharged = subscriptionService.interface.parseLog(chargedEvent);
      expect(parsedCharged.args.subscriber).to.equal(subscriber1.address);
      expect(parsedCharged.args.planId).to.equal(0n);
      expect(parsedCharged.args.amount).to.equal(PRICE);

      // Check state
      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.planId).to.equal(0n);
      expect(subscription.active).to.be.true;
      expect(subscription.nextDue).to.be.gt(0n);
      expect(await subscriptionService.isActive(subscriber1.address)).to.be.true;
    });

    it("Should cancel subscription", async function () {
      await subscriptionService.connect(subscriber1).subscribe(0);
      const tx = await subscriptionService.connect(subscriber1).cancel();
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => {
        try {
          const parsed = subscriptionService.interface.parseLog(log);
          return parsed.name === 'Cancelled';
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
      const parsed = subscriptionService.interface.parseLog(event);
      expect(parsed.args.subscriber).to.equal(subscriber1.address);

      // Check state
      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.active).to.be.false;
      expect(await subscriptionService.isActive(subscriber1.address)).to.be.false;
    });

    it("Should revert when subscribing to invalid plan", async function () {
      await expect(subscriptionService.connect(subscriber1).subscribe(1)).to.be.revertedWith("Invalid plan");
    });

    it("Should revert when subscribing to inactive plan", async function () {
      await subscriptionService.deactivatePlan(0);
      await expect(subscriptionService.connect(subscriber1).subscribe(0)).to.be.revertedWith("Invalid plan");
    });

    it("Should revert when already subscribed", async function () {
      await subscriptionService.connect(subscriber1).subscribe(0);
      await expect(subscriptionService.connect(subscriber1).subscribe(0)).to.be.revertedWith("Already subscribed");
    });

    it("Should revert when payment fails", async function () {
      // Revoke allowance
      await token.connect(subscriber1).approve(await subscriptionService.getAddress(), 0);
      await expect(subscriptionService.connect(subscriber1).subscribe(0)).to.be.revertedWith("Payment failed");
    });

    it("Should revert when canceling without subscription", async function () {
      await expect(subscriptionService.connect(subscriber1).cancel()).to.be.revertedWith("Not subscribed");
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

      const tx = await subscriptionService.charge(subscriber1.address);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => {
        try {
          const parsed = subscriptionService.interface.parseLog(log);
          return parsed.name === 'Charged';
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
      const parsed = subscriptionService.interface.parseLog(event);
      expect(parsed.args.subscriber).to.equal(subscriber1.address);
      expect(parsed.args.planId).to.equal(0n);
      expect(parsed.args.amount).to.equal(PRICE);

      // Check state
      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.nextDue).to.be.gt(0n);
    });

    it("Should cancel subscription when charge fails", async function () {
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [Number(PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Revoke allowance
      await token.connect(subscriber1).approve(await subscriptionService.getAddress(), 0);

      const tx = await subscriptionService.charge(subscriber1.address);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => {
        try {
          const parsed = subscriptionService.interface.parseLog(log);
          return parsed.name === 'Cancelled';
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
      const parsed = subscriptionService.interface.parseLog(event);
      expect(parsed.args.subscriber).to.equal(subscriber1.address);

      // Check state
      const subscription = await subscriptionService.subscriptions(subscriber1.address);
      expect(subscription.active).to.be.false;
    });

    it("Should revert when charging inactive subscription", async function () {
      await subscriptionService.connect(subscriber1).cancel();
      await expect(subscriptionService.charge(subscriber1.address)).to.be.revertedWith("Not subscribed");
    });

    it("Should revert when charging before due time", async function () {
      await expect(subscriptionService.charge(subscriber1.address)).to.be.revertedWith("Not due yet");
    });
  });
});