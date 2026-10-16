const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SubscriptionPaymentSystem", function () {
    let subscriptionSystem;
    let mockToken;
    let owner, subscriber, recipient, other;
    
    const INITIAL_SUPPLY = ethers.parseEther("1000000");
    const PAYMENT_AMOUNT = ethers.parseEther("100");
    const PAYMENT_INTERVAL = 86400; // 1 day in seconds

    beforeEach(async function () {
        [owner, subscriber, recipient, other] = await ethers.getSigners();

        // Deploy MockERC20
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = await MockERC20.deploy("Test Token", "TEST", 1000000);
        await mockToken.waitForDeployment();

        // Deploy SubscriptionPaymentSystem
        const SubscriptionPaymentSystem = await ethers.getContractFactory("SubscriptionPaymentSystem");
        subscriptionSystem = await SubscriptionPaymentSystem.deploy();
        await subscriptionSystem.waitForDeployment();

        // Mint tokens to subscriber
        await mockToken.mint(subscriber.address, INITIAL_SUPPLY);
    });

    describe("Subscription Creation", function () {
        it("Should create a subscription successfully", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);

            const tx = await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address,
                mockToken.target,
                PAYMENT_AMOUNT,
                PAYMENT_INTERVAL,
                0, // unlimited payments
                0  // no expiration
            );

            await expect(tx)
                .to.emit(subscriptionSystem, "SubscriptionCreated")
                .withArgs(0, subscriber.address, recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL);

            const subscription = await subscriptionSystem.getSubscription(0);
            expect(subscription.subscriber).to.equal(subscriber.address);
            expect(subscription.recipient).to.equal(recipient.address);
            expect(subscription.amount).to.equal(PAYMENT_AMOUNT);
            expect(subscription.status).to.equal(0); // Active
        });

        it("Should revert with invalid parameters", async function () {
            await expect(
                subscriptionSystem.connect(subscriber).createSubscription(
                    ethers.ZeroAddress,
                    mockToken.target,
                    PAYMENT_AMOUNT,
                    PAYMENT_INTERVAL,
                    0,
                    0
                )
            ).to.be.revertedWith("Invalid recipient");

            await expect(
                subscriptionSystem.connect(subscriber).createSubscription(
                    recipient.address,
                    ethers.ZeroAddress,
                    PAYMENT_AMOUNT,
                    PAYMENT_INTERVAL,
                    0,
                    0
                )
            ).to.be.revertedWith("Invalid token");

            await expect(
                subscriptionSystem.connect(subscriber).createSubscription(
                    recipient.address,
                    mockToken.target,
                    0,
                    PAYMENT_INTERVAL,
                    0,
                    0
                )
            ).to.be.revertedWith("Amount must be greater than 0");
        });
    });

    describe("Payment Pulling", function () {
        let subscriptionId;

        beforeEach(async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            const tx = await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address,
                mockToken.target,
                PAYMENT_AMOUNT,
                PAYMENT_INTERVAL,
                0,
                0
            );
            
            const receipt = await tx.wait();
            subscriptionId = 0; // First subscription
        });

        it("Should pull payment when due", async function () {
            // Fast forward time to make payment due
            await time.increase(PAYMENT_INTERVAL);

            const recipientBalanceBefore = await mockToken.balanceOf(recipient.address);
            const subscriberBalanceBefore = await mockToken.balanceOf(subscriber.address);

            await expect(subscriptionSystem.pullPayment(subscriptionId))
                .to.emit(subscriptionSystem, "PaymentPulled")
                .withArgs(subscriptionId, subscriber.address, recipient.address, PAYMENT_AMOUNT, 1);

            const recipientBalanceAfter = await mockToken.balanceOf(recipient.address);
            const subscriberBalanceAfter = await mockToken.balanceOf(subscriber.address);

            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(PAYMENT_AMOUNT);
            expect(subscriberBalanceBefore - subscriberBalanceAfter).to.equal(PAYMENT_AMOUNT);
        });

        it("Should revert if payment not due yet", async function () {
            await expect(subscriptionSystem.pullPayment(subscriptionId))
                .to.be.revertedWith("Payment not due yet");
        });

        it("Should handle insufficient allowance gracefully", async function () {
            // Reset allowance to 0
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, 0);
            
            // Fast forward time
            await time.increase(PAYMENT_INTERVAL);

            await expect(subscriptionSystem.pullPayment(subscriptionId))
                .to.be.revertedWith("Token transfer failed");
        });
    });

    describe("Subscription Management", function () {
        let subscriptionId;

        beforeEach(async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address,
                mockToken.target,
                PAYMENT_AMOUNT,
                PAYMENT_INTERVAL,
                0,
                0
            );
            
            subscriptionId = 0;
        });

        it("Should pause subscription", async function () {
            await expect(subscriptionSystem.connect(subscriber).pauseSubscription(subscriptionId))
                .to.emit(subscriptionSystem, "SubscriptionPaused")
                .withArgs(subscriptionId, subscriber.address);

            const subscription = await subscriptionSystem.getSubscription(subscriptionId);
            expect(subscription.status).to.equal(1); // Paused
        });

        it("Should resume subscription", async function () {
            await subscriptionSystem.connect(subscriber).pauseSubscription(subscriptionId);
            
            await expect(subscriptionSystem.connect(subscriber).resumeSubscription(subscriptionId))
                .to.emit(subscriptionSystem, "SubscriptionResumed")
                .withArgs(subscriptionId, subscriber.address);

            const subscription = await subscriptionSystem.getSubscription(subscriptionId);
            expect(subscription.status).to.equal(0); // Active
        });

        it("Should cancel subscription", async function () {
            await expect(subscriptionSystem.connect(subscriber).cancelSubscription(subscriptionId))
                .to.emit(subscriptionSystem, "SubscriptionCancelled")
                .withArgs(subscriptionId, subscriber.address);

            const subscription = await subscriptionSystem.getSubscription(subscriptionId);
            expect(subscription.status).to.equal(2); // Cancelled
        });

        it("Should only allow subscriber to manage subscription", async function () {
            await expect(
                subscriptionSystem.connect(other).pauseSubscription(subscriptionId)
            ).to.be.revertedWith("Not the subscriber");

            await expect(
                subscriptionSystem.connect(recipient).cancelSubscription(subscriptionId)
            ).to.be.revertedWith("Not the subscriber");
        });
    });

    describe("Subscription Expiration", function () {
        it("Should expire subscription after max payments", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            // Create subscription with max 2 payments
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address,
                mockToken.target,
                PAYMENT_AMOUNT,
                PAYMENT_INTERVAL,
                2, // max payments
                0  // no time expiration
            );

            const subscriptionId = 0;

            // First payment
            await time.increase(PAYMENT_INTERVAL);
            await subscriptionSystem.pullPayment(subscriptionId);

            // Second payment - should expire after this
            await time.increase(PAYMENT_INTERVAL);
            await expect(subscriptionSystem.pullPayment(subscriptionId))
                .to.emit(subscriptionSystem, "SubscriptionExpired")
                .withArgs(subscriptionId, subscriber.address);

            const subscription = await subscriptionSystem.getSubscription(subscriptionId);
            expect(subscription.status).to.equal(3); // Expired
        });

        it("Should expire subscription after expiration date", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            // Get current blockchain time and add future offset
            const currentTime = await time.latest();
            const expirationDate = currentTime + PAYMENT_INTERVAL * 2;
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address,
                mockToken.target,
                PAYMENT_AMOUNT,
                PAYMENT_INTERVAL,
                0, // unlimited payments
                expirationDate
            );

            const subscriptionId = 0;

            // Fast forward past expiration
            await time.increaseTo(expirationDate + 1);
            
            await expect(subscriptionSystem.pullPayment(subscriptionId))
                .to.emit(subscriptionSystem, "SubscriptionExpired")
                .withArgs(subscriptionId, subscriber.address);
        });
    });

    describe("Batch Operations", function () {
        it("Should batch pull multiple payments", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            // Create multiple subscriptions
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );

            // Fast forward time
            await time.increase(PAYMENT_INTERVAL);

            const recipientBalanceBefore = await mockToken.balanceOf(recipient.address);
            
            await subscriptionSystem.batchPullPayments([0, 1]);
            
            const recipientBalanceAfter = await mockToken.balanceOf(recipient.address);
            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(PAYMENT_AMOUNT * 2n);
        });
    });

    describe("Chainlink Keeper Integration", function () {
        beforeEach(async function () {
            // Enable automation for Chainlink Keeper tests
            await subscriptionSystem.setAutomationEnabled(true);
        });

        it("Should return correct upkeep data", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );

            // Before payment is due
            let [upkeepNeeded] = await subscriptionSystem.checkUpkeep("0x");
            expect(upkeepNeeded).to.be.false;

            // After payment is due
            await time.increase(PAYMENT_INTERVAL);
            [upkeepNeeded] = await subscriptionSystem.checkUpkeep("0x");
            expect(upkeepNeeded).to.be.true;
        });

        it("Should perform upkeep correctly", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );

            await time.increase(PAYMENT_INTERVAL);
            
            const [, performData] = await subscriptionSystem.checkUpkeep("0x");
            
            const recipientBalanceBefore = await mockToken.balanceOf(recipient.address);
            await subscriptionSystem.performUpkeep(performData);
            const recipientBalanceAfter = await mockToken.balanceOf(recipient.address);
            
            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(PAYMENT_AMOUNT);
        });
    });

    describe("View Functions", function () {
        it("Should return user subscriptions", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );

            const userSubs = await subscriptionSystem.getUserSubscriptions(subscriber.address);
            expect(userSubs.length).to.equal(2);
            expect(userSubs[0]).to.equal(0);
            expect(userSubs[1]).to.equal(1);
        });

        it("Should return recipient subscriptions", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );

            const recipientSubs = await subscriptionSystem.getRecipientSubscriptions(recipient.address);
            expect(recipientSubs.length).to.equal(1);
            expect(recipientSubs[0]).to.equal(0);
        });
    });
});
