const { expect } = require("chai");
const { ethers } = require("hardhat");

// Helper functions for time manipulation
async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}

async function getLatestTimestamp() {
  const block = await ethers.provider.getBlock('latest');
  return block.timestamp;
}

async function setNextBlockTimestamp(timestamp) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await ethers.provider.send("evm_mine");
}

describe("AgentSubscriptionsV2", function () {
  let agentSubscriptions;
  let mockUSDC;
  let owner, agent, subscriber, subscriber2, recipient, other;
  let ONE_USDC, TEN_USDC;
  
  const ONE_WEEK = 7 * 24 * 60 * 60;
  const ONE_MINUTE = 60;

  beforeEach(async function () {
    [owner, agent, subscriber, subscriber2, recipient, other] = await ethers.getSigners();

    // Initialize constants
    ONE_USDC = ethers.parseUnits("1", 6);
    TEN_USDC = ethers.parseUnits("10", 6);

    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);
    await mockUSDC.waitForDeployment();

    // Deploy AgentSubscriptions v2
    const AgentSubscriptionsV2 = await ethers.getContractFactory("AgentSubscriptionsV2");
    agentSubscriptions = await AgentSubscriptionsV2.deploy(await mockUSDC.getAddress());
    await agentSubscriptions.waitForDeployment();

    // Mint USDC to test accounts
    await mockUSDC.mint(subscriber.address, ethers.parseUnits("1000", 6));
    await mockUSDC.mint(subscriber2.address, ethers.parseUnits("1000", 6));
  });

  describe("Deployment", function () {
    it("Should set the correct USDC address", async function () {
      expect(await agentSubscriptions.usdc()).to.equal(await mockUSDC.getAddress());
    });

    it("Should start with zero offerings", async function () {
      expect(await agentSubscriptions.offeringCount()).to.equal(0);
    });

    it("Should set owner correctly", async function () {
      expect(await agentSubscriptions.owner()).to.equal(owner.address);
    });

    it("Should reject zero USDC address", async function () {
      const AgentSubscriptionsV2 = await ethers.getContractFactory("AgentSubscriptionsV2");
      await expect(
        AgentSubscriptionsV2.deploy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidAddress");
    });
  });

  describe("Create Offering - Validation", function () {
    it("Should create offering successfully", async function () {
      const tx = await agentSubscriptions.connect(agent).createOffering(
        "MoltDigest Weekly",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );

      await expect(tx).to.emit(agentSubscriptions, "OfferingCreated");
      expect(await agentSubscriptions.offeringCount()).to.equal(1);
    });

    it("Should reject empty service ID", async function () {
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "",
          recipient.address,
          ONE_USDC,
          ONE_WEEK
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidServiceId");
    });

    it("Should reject service ID too long", async function () {
      const longId = "a".repeat(101);
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          longId,
          recipient.address,
          ONE_USDC,
          ONE_WEEK
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidServiceId");
    });

    it("Should accept service ID at max length", async function () {
      const maxId = "a".repeat(100);
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          maxId,
          recipient.address,
          ONE_USDC,
          ONE_WEEK
        )
      ).to.not.be.reverted;
    });

    it("Should reject zero recipient address", async function () {
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          ethers.ZeroAddress,
          ONE_USDC,
          ONE_WEEK
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidAddress");
    });

    it("Should reject zero amount", async function () {
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          recipient.address,
          0,
          ONE_WEEK
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidAmount");
    });

    it("Should reject amount too large", async function () {
      const tooLarge = ethers.parseUnits("1000001", 6); // >1M USDC
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          recipient.address,
          tooLarge,
          ONE_WEEK
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidAmount");
    });

    it("Should accept amount at max limit", async function () {
      const maxAmount = ethers.parseUnits("1000000", 6); // Exactly 1M USDC
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          recipient.address,
          maxAmount,
          ONE_WEEK
        )
      ).to.not.be.reverted;
    });

    it("Should reject period too short", async function () {
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          recipient.address,
          ONE_USDC,
          59 // <60 seconds
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidPeriod");
    });

    it("Should reject period too long", async function () {
      const oneYearPlus = (365 * 24 * 60 * 60) + 1;
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          recipient.address,
          ONE_USDC,
          oneYearPlus
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidPeriod");
    });

    it("Should accept period at boundaries", async function () {
      // Min boundary
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test Min",
          recipient.address,
          ONE_USDC,
          60
        )
      ).to.not.be.reverted;

      // Max boundary
      const oneYear = 365 * 24 * 60 * 60;
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test Max",
          recipient.address,
          ONE_USDC,
          oneYear
        )
      ).to.not.be.reverted;
    });
  });

  describe("Subscribe - Multi-Subscriber Support", function () {
    beforeEach(async function () {
      // Create offering
      await agentSubscriptions.connect(agent).createOffering(
        "MoltDigest Weekly",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );
    });

    it("Should allow multiple users to subscribe to same offering", async function () {
      // Subscriber 1
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );
      await agentSubscriptions.connect(subscriber).subscribe(0);

      // Subscriber 2
      await mockUSDC.connect(subscriber2).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );
      await agentSubscriptions.connect(subscriber2).subscribe(0);

      // Verify both subscriptions
      const sub1 = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      const sub2 = await agentSubscriptions.getUserSubscription(0, subscriber2.address);

      expect(sub1.active).to.be.true;
      expect(sub2.active).to.be.true;
      expect(sub1.subscriber).to.equal(subscriber.address);
      expect(sub2.subscriber).to.equal(subscriber2.address);

      // Check subscriber count
      const offering = await agentSubscriptions.getOffering(0);
      expect(offering.totalSubscribers).to.equal(2);
    });

    it("Should allow user to subscribe to multiple offerings", async function () {
      // Create second offering
      await agentSubscriptions.connect(agent).createOffering(
        "Premium Service",
        recipient.address,
        ONE_USDC * 2n,
        ONE_WEEK
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      // Subscribe to both
      await agentSubscriptions.connect(subscriber).subscribe(0);
      await agentSubscriptions.connect(subscriber).subscribe(1);

      const userOfferings = await agentSubscriptions.getUserOfferingIds(subscriber.address);
      expect(userOfferings.length).to.equal(2);
      expect(userOfferings[0]).to.equal(0);
      expect(userOfferings[1]).to.equal(1);
    });

    it("Should reject double subscription", async function () {
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);

      await expect(
        agentSubscriptions.connect(subscriber).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "SubscriptionAlreadyActive");
    });

    it("Should reject owner subscribing to own offering", async function () {
      await mockUSDC.mint(agent.address, ethers.parseUnits("100", 6));
      await mockUSDC.connect(agent).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );

      await expect(
        agentSubscriptions.connect(agent).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "OwnerCannotSubscribe");
    });

    it("Should reject recipient subscribing", async function () {
      await mockUSDC.mint(recipient.address, ethers.parseUnits("100", 6));
      await mockUSDC.connect(recipient).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );

      await expect(
        agentSubscriptions.connect(recipient).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "RecipientCannotSubscribe");
    });

    it("Should reject subscription to non-existent offering", async function () {
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );

      await expect(
        agentSubscriptions.connect(subscriber).subscribe(999)
      ).to.be.revertedWithCustomError(agentSubscriptions, "OfferingNotFound");
    });

    it("Should reject subscribe without allowance", async function () {
      await expect(
        agentSubscriptions.connect(subscriber).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "InsufficientAllowance");
    });

    it("Should reject subscribe with insufficient allowance", async function () {
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ONE_USDC / 2n // Less than required
      );

      await expect(
        agentSubscriptions.connect(subscriber).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "InsufficientAllowance");
    });
  });

  describe("Re-subscription", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );
    });

    it("Should allow re-subscription after cancel", async function () {
      // Initial subscription
      await agentSubscriptions.connect(subscriber).subscribe(0);
      
      // Cancel
      await agentSubscriptions.connect(subscriber).cancelSubscription(0);
      
      // Re-subscribe
      await expect(
        agentSubscriptions.connect(subscriber).subscribe(0)
      ).to.not.be.reverted;

      const sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.active).to.be.true;
    });

    it("Should preserve totalPaid and chargeCount on re-subscription", async function () {
      // Subscribe
      await agentSubscriptions.connect(subscriber).subscribe(0);
      
      // Charge once
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);
      
      let sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.totalPaid).to.equal(ONE_USDC);
      expect(sub.chargeCount).to.equal(1);
      
      // Cancel and re-subscribe
      await agentSubscriptions.connect(subscriber).cancelSubscription(0);
      await agentSubscriptions.connect(subscriber).subscribe(0);
      
      // Metrics should be preserved
      sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.totalPaid).to.equal(ONE_USDC); // Preserved from before
      expect(sub.chargeCount).to.equal(1); // Preserved from before
      expect(sub.active).to.be.true;
    });

    it("Should reset billing period on re-subscription", async function () {
      // Subscribe and wait
      await agentSubscriptions.connect(subscriber).subscribe(0);
      await increaseTime(30);
      
      // Cancel and immediately re-subscribe
      await agentSubscriptions.connect(subscriber).cancelSubscription(0);
      await agentSubscriptions.connect(subscriber).subscribe(0);
      
      // Should not be chargeable immediately (billing period reset)
      expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.false;
    });
  });

  describe("Charge - Access Control", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);
      await increaseTime(61);
    });

    it("Should allow owner to charge", async function () {
      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.not.be.reverted;
    });

    it("Should allow recipient to charge", async function () {
      await expect(
        agentSubscriptions.connect(recipient).charge(0, subscriber.address)
      ).to.not.be.reverted;
    });

    it("Should allow subscriber to charge themselves", async function () {
      await expect(
        agentSubscriptions.connect(subscriber).charge(0, subscriber.address)
      ).to.not.be.reverted;
    });

    it("Should reject charge from unauthorized caller", async function () {
      await expect(
        agentSubscriptions.connect(other).charge(0, subscriber.address)
      ).to.be.revertedWithCustomError(agentSubscriptions, "UnauthorizedCaller");
    });
  });

  describe("Charge - Failure Scenarios", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);
    });

    it("Should reject charge before period elapsed", async function () {
      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.revertedWithCustomError(agentSubscriptions, "BillingPeriodNotElapsed");
    });

    it("Should allow charge after period elapsed", async function () {
      await increaseTime(61);

      const recipientBalanceBefore = await mockUSDC.balanceOf(recipient.address);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);
      const recipientBalanceAfter = await mockUSDC.balanceOf(recipient.address);

      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(ONE_USDC);
    });

    it("Should reject charge on canceled subscription", async function () {
      await agentSubscriptions.connect(subscriber).cancelSubscription(0);

      await increaseTime(61);

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.revertedWithCustomError(agentSubscriptions, "SubscriptionNotActive");
    });

    it("Should reject charge when subscriber has insufficient balance", async function () {
      // Transfer away all USDC
      const balance = await mockUSDC.balanceOf(subscriber.address);
      await mockUSDC.connect(subscriber).transfer(owner.address, balance);

      await increaseTime(61);

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.reverted; // SafeERC20 transfer fails
    });

    it("Should reject charge when subscriber revoked allowance", async function () {
      // Revoke allowance
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        0
      );

      await increaseTime(61);

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.reverted; // SafeERC20 insufficient allowance
    });

    it("Should allow multiple sequential charges", async function () {
      const recipientBalanceBefore = await mockUSDC.balanceOf(recipient.address);

      // First charge
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);

      // Second charge
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);

      // Third charge
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);

      const recipientBalanceAfter = await mockUSDC.balanceOf(recipient.address);

      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(ONE_USDC * 3n);
    });

    it("Should update metrics correctly on charge", async function () {
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);

      const sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.totalPaid).to.equal(ONE_USDC);
      expect(sub.chargeCount).to.equal(1);

      // Second charge
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);

      const sub2 = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub2.totalPaid).to.equal(ONE_USDC * 2n);
      expect(sub2.chargeCount).to.equal(2);
    });

    it("Should reject charge on paused offering", async function () {
      await agentSubscriptions.connect(agent).pauseOffering(0);
      
      await increaseTime(61);

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.revertedWithCustomError(agentSubscriptions, "OfferingNotActive");
    });
  });

  describe("Scheduling", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);
    });

    it("Should allow setting target charge time", async function () {
      const futureTime = (await getLatestTimestamp()) + 86400; // 1 day from now
      
      await expect(
        agentSubscriptions.connect(subscriber).setTargetChargeTime(0, futureTime)
      ).to.emit(agentSubscriptions, "TargetChargeTimeUpdated")
        .withArgs(0, subscriber.address, futureTime);

      const sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.targetChargeTime).to.equal(futureTime);
    });

    it("Should reject past target time", async function () {
      const pastTime = (await getLatestTimestamp()) - 100;

      await expect(
        agentSubscriptions.connect(subscriber).setTargetChargeTime(0, pastTime)
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidTargetTime");
    });

    it("Should allow disabling schedule with zero", async function () {
      // Set schedule first
      const futureTime = (await getLatestTimestamp()) + 86400;
      await agentSubscriptions.connect(subscriber).setTargetChargeTime(0, futureTime);

      // Disable
      await agentSubscriptions.connect(subscriber).setTargetChargeTime(0, 0);

      const sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.targetChargeTime).to.equal(0);
    });

    it("Should respect target charge time when charging", async function () {
      const futureTime = (await getLatestTimestamp()) + 86400; // 1 day from now
      await agentSubscriptions.connect(subscriber).setTargetChargeTime(0, futureTime);

      // Try to charge before target time (but after normal period would allow)
      // Only advance half a day - still before the 1 day target
      await increaseTime(43200); // 12 hours

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.revertedWithCustomError(agentSubscriptions, "BillingPeriodNotElapsed");

      // Charge at target time
      await setNextBlockTimestamp(futureTime);

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.not.be.reverted;
    });

    it("Should allow setting monthly schedule", async function () {
      await expect(
        agentSubscriptions.connect(subscriber).setMonthlySchedule(0, 1, 8) // 1st of month, 8am
      ).to.not.be.reverted;

      const sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.targetChargeTime).to.be.gt(0);
    });
  });

  describe("Batch Charging", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      // Subscribe multiple users
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );
      await agentSubscriptions.connect(subscriber).subscribe(0);

      await mockUSDC.connect(subscriber2).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );
      await agentSubscriptions.connect(subscriber2).subscribe(0);
    });

    it("Should charge all ready subscribers", async function () {
      await increaseTime(61);

      const tx = await agentSubscriptions.connect(agent).chargeAll(0);
      const receipt = await tx.wait();

      // Should have charged both subscribers
      const event = receipt.logs.find(log => {
        try {
          const parsed = agentSubscriptions.interface.parseLog(log);
          return parsed.name === 'BatchChargeCompleted';
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsed = agentSubscriptions.interface.parseLog(event);
      expect(parsed.args.successCount).to.equal(2);
      expect(parsed.args.failCount).to.equal(0);
    });

    it("Should handle partial failures gracefully", async function () {
      // Revoke one subscriber's allowance
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        0
      );

      await increaseTime(61);

      const tx = await agentSubscriptions.connect(agent).chargeAll(0);
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => {
        try {
          const parsed = agentSubscriptions.interface.parseLog(log);
          return parsed.name === 'BatchChargeCompleted';
        } catch {
          return false;
        }
      });

      const parsed = agentSubscriptions.interface.parseLog(event);
      expect(parsed.args.successCount).to.equal(1);
      expect(parsed.args.failCount).to.equal(1);
    });

    it("Should skip subscribers not ready to charge", async function () {
      // Don't advance time - no one ready
      const tx = await agentSubscriptions.connect(agent).chargeAll(0);
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => {
        try {
          const parsed = agentSubscriptions.interface.parseLog(log);
          return parsed.name === 'BatchChargeCompleted';
        } catch {
          return false;
        }
      });

      const parsed = agentSubscriptions.interface.parseLog(event);
      expect(parsed.args.successCount).to.equal(0);
      expect(parsed.args.failCount).to.equal(0);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        100 // 100 seconds
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);
    });

    describe("canCharge", function () {
      it("Should return false immediately after subscribe", async function () {
        expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.false;
      });

      it("Should return false before period elapsed", async function () {
        await increaseTime(50);
        expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.false;
      });

      it("Should return true after period elapsed", async function () {
        await increaseTime(101);
        expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.true;
      });

      it("Should return false for inactive subscription", async function () {
        await agentSubscriptions.connect(subscriber).cancelSubscription(0);
        await increaseTime(101);
        expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.false;
      });

      it("Should return false for paused offering", async function () {
        await agentSubscriptions.connect(agent).pauseOffering(0);
        await increaseTime(101);
        expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.false;
      });
    });

    describe("timeUntilNextCharge", function () {
      it("Should return approximately full period immediately after subscribe", async function () {
        const timeRemaining = await agentSubscriptions.timeUntilNextCharge(0, subscriber.address);
        expect(timeRemaining).to.be.closeTo(100, 5);
      });

      it("Should return 0 when ready to charge", async function () {
        await increaseTime(101);
        expect(await agentSubscriptions.timeUntilNextCharge(0, subscriber.address)).to.equal(0);
      });

      it("Should return correct time remaining midway", async function () {
        await increaseTime(50);
        const timeRemaining = await agentSubscriptions.timeUntilNextCharge(0, subscriber.address);
        expect(timeRemaining).to.be.closeTo(50, 5);
      });

      it("Should revert for inactive subscription", async function () {
        await agentSubscriptions.connect(subscriber).cancelSubscription(0);
        await expect(
          agentSubscriptions.timeUntilNextCharge(0, subscriber.address)
        ).to.be.revertedWithCustomError(agentSubscriptions, "SubscriptionNotActive");
      });
    });

    describe("getOfferingSubscribers", function () {
      it("Should return all subscribers", async function () {
        // Add second subscriber
        await mockUSDC.connect(subscriber2).approve(
          await agentSubscriptions.getAddress(),
          ethers.parseUnits("100", 6)
        );
        await agentSubscriptions.connect(subscriber2).subscribe(0);

        const subscribers = await agentSubscriptions.getOfferingSubscribers(0);
        expect(subscribers.length).to.equal(2);
        expect(subscribers).to.include(subscriber.address);
        expect(subscribers).to.include(subscriber2.address);
      });

      it("Should return empty array for new offering", async function () {
        await agentSubscriptions.connect(agent).createOffering(
          "New Service",
          recipient.address,
          ONE_USDC,
          100
        );

        const subscribers = await agentSubscriptions.getOfferingSubscribers(1);
        expect(subscribers.length).to.equal(0);
      });
    });

    describe("getUserOfferingIds", function () {
      it("Should return empty array for user with no subscriptions", async function () {
        const offerings = await agentSubscriptions.getUserOfferingIds(other.address);
        expect(offerings.length).to.equal(0);
      });

      it("Should return correct offering IDs", async function () {
        // Create and subscribe to another offering
        await agentSubscriptions.connect(agent).createOffering(
          "Second Service",
          recipient.address,
          ONE_USDC,
          100
        );
        await agentSubscriptions.connect(subscriber).subscribe(1);

        const offerings = await agentSubscriptions.getUserOfferingIds(subscriber.address);
        expect(offerings.length).to.equal(2);
        expect(offerings[0]).to.equal(0);
        expect(offerings[1]).to.equal(1);
      });
    });
  });

  describe("Pause/Unpause Offering", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );
    });

    it("Should allow owner to pause offering", async function () {
      await expect(
        agentSubscriptions.connect(agent).pauseOffering(0)
      ).to.emit(agentSubscriptions, "OfferingPaused");

      const offering = await agentSubscriptions.getOffering(0);
      expect(offering.active).to.be.false;
    });

    it("Should reject pause from non-owner", async function () {
      await expect(
        agentSubscriptions.connect(other).pauseOffering(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "UnauthorizedCaller");
    });

    it("Should block new subscriptions when paused", async function () {
      await agentSubscriptions.connect(agent).pauseOffering(0);

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );

      await expect(
        agentSubscriptions.connect(subscriber).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "OfferingNotActive");
    });

    it("Should allow owner to unpause offering", async function () {
      await agentSubscriptions.connect(agent).pauseOffering(0);
      
      await expect(
        agentSubscriptions.connect(agent).unpauseOffering(0)
      ).to.emit(agentSubscriptions, "OfferingUnpaused");

      const offering = await agentSubscriptions.getOffering(0);
      expect(offering.active).to.be.true;
    });
  });

  describe("Cancel Offering", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      // Add subscribers
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );
      await agentSubscriptions.connect(subscriber).subscribe(0);

      await mockUSDC.connect(subscriber2).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );
      await agentSubscriptions.connect(subscriber2).subscribe(0);
    });

    it("Should cancel offering and all subscriptions", async function () {
      await expect(
        agentSubscriptions.connect(agent).cancelOffering(0)
      ).to.emit(agentSubscriptions, "OfferingCanceled");

      const offering = await agentSubscriptions.getOffering(0);
      expect(offering.active).to.be.false;
      expect(offering.totalSubscribers).to.equal(0);

      // Check subscriptions are canceled
      const sub1 = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      const sub2 = await agentSubscriptions.getUserSubscription(0, subscriber2.address);
      expect(sub1.active).to.be.false;
      expect(sub2.active).to.be.false;
    });

    it("Should reject cancel from non-owner", async function () {
      await expect(
        agentSubscriptions.connect(other).cancelOffering(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "UnauthorizedCaller");
    });
  });

  describe("Emergency Pause", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );
    });

    it("Should allow owner to pause contract", async function () {
      await agentSubscriptions.connect(owner).pause();
      expect(await agentSubscriptions.paused()).to.be.true;
    });

    it("Should reject pause from non-owner", async function () {
      await expect(
        agentSubscriptions.connect(other).pause()
      ).to.be.revertedWithCustomError(agentSubscriptions, "OwnableUnauthorizedAccount");
    });

    it("Should block operations when paused", async function () {
      await agentSubscriptions.connect(owner).pause();

      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Another Service",
          recipient.address,
          ONE_USDC,
          ONE_MINUTE
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "EnforcedPause");
    });

    it("Should allow owner to unpause", async function () {
      await agentSubscriptions.connect(owner).pause();
      await agentSubscriptions.connect(owner).unpause();
      expect(await agentSubscriptions.paused()).to.be.false;
    });
  });

  describe("Gas Usage", function () {
    beforeEach(async function () {
      await mockUSDC.mint(subscriber.address, ethers.parseUnits("1000", 6));
    });

    it("Should measure createOffering gas", async function () {
      const tx = await agentSubscriptions.connect(agent).createOffering(
        "MoltDigest Weekly",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );
      const receipt = await tx.wait();

      console.log("      createOffering gas:", receipt.gasUsed.toString());
      expect(receipt.gasUsed).to.be.lessThan(220000); // Adjusted for v2 features
    });

    it("Should measure subscribe gas", async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      const tx = await agentSubscriptions.connect(subscriber).subscribe(0);
      const receipt = await tx.wait();

      console.log("      subscribe gas:", receipt.gasUsed.toString());
      expect(receipt.gasUsed).to.be.lessThan(230000); // Adjusted for subscriber array tracking
    });

    it("Should measure charge gas", async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);
      await increaseTime(61);

      const tx = await agentSubscriptions.connect(agent).charge(0, subscriber.address);
      const receipt = await tx.wait();

      console.log("      charge gas:", receipt.gasUsed.toString());
      expect(receipt.gasUsed).to.be.lessThan(140000); // Adjusted for metrics tracking
    });

    it("Should measure cancelSubscription gas", async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);

      const tx = await agentSubscriptions.connect(subscriber).cancelSubscription(0);
      const receipt = await tx.wait();

      console.log("      cancelSubscription gas:", receipt.gasUsed.toString());
      expect(receipt.gasUsed).to.be.lessThan(80000);
    });
  });
});
