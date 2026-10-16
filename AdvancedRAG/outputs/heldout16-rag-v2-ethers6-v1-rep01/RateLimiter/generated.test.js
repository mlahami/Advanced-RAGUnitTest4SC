const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RateLimiter", function () {
  let rateLimiter;
  let owner;
  let user1;
  let user2;

  const CAPACITY = 100n;
  const REFILL_RATE = 10n; // tokens per second
  const COST_PER_CALL = 10n;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const RateLimiter = await ethers.getContractFactory("RateLimiter");
    rateLimiter = await RateLimiter.deploy(CAPACITY, REFILL_RATE, COST_PER_CALL);
    await rateLimiter.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await rateLimiter.owner()).to.equal(owner.address);
    });

    it("Should set the correct parameters", async function () {
      expect(await rateLimiter.capacity()).to.equal(CAPACITY);
      expect(await rateLimiter.refillRate()).to.equal(REFILL_RATE);
      expect(await rateLimiter.costPerCall()).to.equal(COST_PER_CALL);
    });

    it("Should revert with zero parameters", async function () {
      const RateLimiter = await ethers.getContractFactory("RateLimiter");
      await expect(RateLimiter.deploy(0, REFILL_RATE, COST_PER_CALL)).to.be.revertedWith("Zero param");
      await expect(RateLimiter.deploy(CAPACITY, 0, COST_PER_CALL)).to.be.revertedWith("Zero param");
      await expect(RateLimiter.deploy(CAPACITY, REFILL_RATE, 0)).to.be.revertedWith("Zero param");
    });
  });

  describe("Token Bucket Mechanics", function () {
    it("Should start with full capacity for new users", async function () {
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(CAPACITY);
    });

    it("Should correctly calculate refilled tokens", async function () {
      // First call consumes all tokens
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Wait 1 second
      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine");

      // Should have 10 tokens refilled (10 tokens per second)
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(10n);
    });

    it("Should cap tokens at capacity", async function () {
      // First call consumes all tokens
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Wait 11 seconds (should refill to capacity)
      await ethers.provider.send("evm_increaseTime", [11]);
      await ethers.provider.send("evm_mine");

      expect(await rateLimiter.availableTokens(user1.address)).to.equal(CAPACITY);
    });

    it("Should track independent buckets for different users", async function () {
      // User1 consumes tokens
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // User2 should still have full capacity
      expect(await rateLimiter.availableTokens(user2.address)).to.equal(CAPACITY);
    });
  });

  describe("Rate Limited Actions", function () {
    it("Should allow deposit when tokens available", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(rateLimiter.connect(user1).deposit({ value: depositAmount }))
        .to.emit(rateLimiter, "Deposited")
        .withArgs(user1.address, depositAmount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(depositAmount);
    });

    it("Should revert when rate limit exceeded", async function () {
      // First call consumes all tokens
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Second call should fail
      await expect(rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") }))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should allow withdraw when tokens available", async function () {
      // Deposit first to have balance
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Withdraw
      const withdrawAmount = ethers.parseEther("0.5");
      await expect(rateLimiter.connect(user1).withdraw(withdrawAmount))
        .to.emit(rateLimiter, "Withdrawn")
        .withArgs(user1.address, withdrawAmount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(ethers.parseEther("0.5"));
    });

    it("Should revert withdraw with insufficient balance", async function () {
      // Deposit first
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Try to withdraw more than balance
      await expect(rateLimiter.connect(user1).withdraw(ethers.parseEther("2")))
        .to.be.revertedWith("Insufficient balance");
    });

    it("Should revert withdraw when rate limit exceeded", async function () {
      // First call consumes all tokens
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Second call should fail
      await expect(rateLimiter.connect(user1).withdraw(ethers.parseEther("0.5")))
        .to.be.revertedWith("Rate limit exceeded");
    });
  });

  describe("Token Consumption", function () {
    it("Should correctly consume tokens", async function () {
      const initialTokens = await rateLimiter.availableTokens(user1.address);
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });
      const newTokens = await rateLimiter.availableTokens(user1.address);

      expect(newTokens).to.equal(initialTokens - COST_PER_CALL);
    });

    it("Should update lastRefill timestamp", async function () {
      const initialBucket = await rateLimiter.buckets(user1.address);
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });
      const updatedBucket = await rateLimiter.buckets(user1.address);

      expect(updatedBucket.lastRefill).to.be.gt(initialBucket.lastRefill);
    });
  });
});