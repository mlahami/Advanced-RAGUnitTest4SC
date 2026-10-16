const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RateLimiter", function () {
  let rateLimiter;
  let owner;
  let user1;
  let user2;

  const CAPACITY = 100n;
  const REFILL_RATE = 10n; // tokens per second
  const COST_PER_CALL = 20n;

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

  describe("Token Bucket", function () {
    it("Should initialize new users with full capacity", async function () {
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(CAPACITY);
    });

    it("Should refill tokens over time", async function () {
      // Consume some tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const expectedTokens = 20n + (10n * REFILL_RATE); // 20n (remaining) + 10 seconds * 10 tokens/sec
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(expectedTokens);
    });

    it("Should cap tokens at capacity", async function () {
      // Consume all tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Fast forward time beyond capacity
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      expect(await rateLimiter.availableTokens(user1.address)).to.equal(CAPACITY);
    });
  });

  describe("Rate Limiting", function () {
    it("Should allow deposits when tokens available", async function () {
      const initialBalance = await ethers.provider.getBalance(rateLimiter.getAddress());
      await expect(rateLimiter.connect(user1).deposit({ value: 1n }))
        .to.emit(rateLimiter, "Deposited")
        .withArgs(user1.address, 1n);

      const finalBalance = await ethers.provider.getBalance(rateLimiter.getAddress());
      expect(finalBalance - initialBalance).to.equal(1n);
    });

    it("Should revert when tokens insufficient", async function () {
      // Consume all tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Try to deposit again (should fail)
      await expect(rateLimiter.connect(user1).deposit({ value: 1n }))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should allow withdrawals when tokens available", async function () {
      // Deposit first to have something to withdraw
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Withdraw
      await expect(rateLimiter.connect(user1).withdraw(ethers.parseEther("0.5")))
        .to.emit(rateLimiter, "Withdrawn")
        .withArgs(user1.address, ethers.parseEther("0.5"));
    });

    it("Should revert withdrawal when tokens insufficient", async function () {
      // Try to withdraw without depositing first
      await expect(rateLimiter.connect(user1).withdraw(1n))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should revert withdrawal when balance insufficient", async function () {
      // Deposit first
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Try to withdraw more than balance
      await expect(rateLimiter.connect(user1).withdraw(ethers.parseEther("2")))
        .to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Independent Buckets", function () {
    it("Should maintain separate buckets for different users", async function () {
      // User1 consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // User2 should still have full capacity
      expect(await rateLimiter.availableTokens(user2.address)).to.equal(CAPACITY);
    });

    it("Should allow multiple users to use the contract", async function () {
      // User1 deposits
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // User2 deposits
      await rateLimiter.connect(user2).deposit({ value: 1n });

      // Both should have their own buckets
      expect(await rateLimiter.availableTokens(user1.address)).to.be.lessThan(CAPACITY);
      expect(await rateLimiter.availableTokens(user2.address)).to.be.lessThan(CAPACITY);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero cost per call (should never revert)", async function () {
      const RateLimiter = await ethers.getContractFactory("RateLimiter");
      const zeroCostLimiter = await RateLimiter.deploy(CAPACITY, REFILL_RATE, 0n);
      await zeroCostLimiter.waitForDeployment();

      // Should not revert even with zero cost
      await expect(zeroCostLimiter.connect(user1).deposit({ value: 1n }))
        .to.emit(zeroCostLimiter, "Deposited")
        .withArgs(user1.address, 1n);
    });

    it("Should handle max uint256 values", async function () {
      const maxCapacity = ethers.MaxUint256;
      const maxRefill = ethers.MaxUint256;
      const maxCost = ethers.MaxUint256;

      const RateLimiter = await ethers.getContractFactory("RateLimiter");
      const maxLimiter = await RateLimiter.deploy(maxCapacity, maxRefill, maxCost);
      await maxLimiter.waitForDeployment();

      // Should not revert with max values
      await expect(maxLimiter.connect(user1).deposit({ value: 1n }))
        .to.emit(maxLimiter, "Deposited")
        .withArgs(user1.address, 1n);
    });
  });
});