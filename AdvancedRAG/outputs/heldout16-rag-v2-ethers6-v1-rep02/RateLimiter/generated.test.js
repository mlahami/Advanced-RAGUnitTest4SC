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

  describe("Token Bucket Mechanics", function () {
    it("Should initialize new users with full capacity", async function () {
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(CAPACITY);
    });

    it("Should refill tokens over time", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Get current tokens before refill
      const initialTokens = await rateLimiter.availableTokens(user1.address);

      // Wait 1 second
      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine");

      // Check refill
      const expectedRefill = initialTokens + REFILL_RATE;
      const actualTokens = await rateLimiter.availableTokens(user1.address);
      expect(actualTokens).to.be.closeTo(expectedRefill, 1n); // Allow small rounding differences
    });

    it("Should not exceed capacity", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Wait enough time to exceed capacity
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      // Should be capped at capacity
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(CAPACITY);
    });
  });

  describe("Vault Operations", function () {
    it("Should allow deposit when tokens available", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(rateLimiter.connect(user1).deposit({ value: depositAmount }))
        .to.emit(rateLimiter, "Deposited")
        .withArgs(user1.address, depositAmount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(depositAmount);
    });

    it("Should revert deposit when rate limit exceeded", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Second call should fail if not enough time passed
      await expect(rateLimiter.connect(user1).deposit({ value: 1n }))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should allow withdraw when tokens available", async function () {
      const depositAmount = ethers.parseEther("1");
      await rateLimiter.connect(user1).deposit({ value: depositAmount });

      const withdrawAmount = ethers.parseEther("0.5");
      await expect(rateLimiter.connect(user1).withdraw(withdrawAmount))
        .to.emit(rateLimiter, "Withdrawn")
        .withArgs(user1.address, withdrawAmount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(depositAmount - withdrawAmount);
    });

    it("Should revert withdraw when insufficient balance", async function () {
      const depositAmount = ethers.parseEther("1");
      await rateLimiter.connect(user1).deposit({ value: depositAmount });

      const withdrawAmount = ethers.parseEther("2");
      await expect(rateLimiter.connect(user1).withdraw(withdrawAmount))
        .to.be.revertedWith("Insufficient balance");
    });

    it("Should revert withdraw when rate limit exceeded", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Second call should fail if not enough time passed
      await expect(rateLimiter.connect(user1).withdraw(1n))
        .to.be.revertedWith("Rate limit exceeded");
    });
  });

  describe("Independent Buckets", function () {
    it("Should maintain separate buckets for different users", async function () {
      // User1 makes a call
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // User2 should still have full capacity
      expect(await rateLimiter.availableTokens(user2.address)).to.equal(CAPACITY);

      // User1's tokens should be reduced
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(CAPACITY - COST_PER_CALL);
    });

    it("Should allow multiple users to use the contract", async function () {
      // User1 makes a call
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // User2 makes a call
      await rateLimiter.connect(user2).deposit({ value: 1n });

      // Both should have reduced tokens
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(CAPACITY - COST_PER_CALL);
      expect(await rateLimiter.availableTokens(user2.address)).to.equal(CAPACITY - COST_PER_CALL);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle maximum uint256 values correctly", async function () {
      const maxCapacity = ethers.MaxUint256;
      const maxRefill = ethers.MaxUint256;
      const maxCost = ethers.MaxUint256;

      const RateLimiter = await ethers.getContractFactory("RateLimiter");
      const maxRateLimiter = await RateLimiter.deploy(maxCapacity, maxRefill, maxCost);
      await maxRateLimiter.waitForDeployment();

      // Check initial state
      expect(await maxRateLimiter.availableTokens(user1.address)).to.equal(maxCapacity);

      // First call should consume all tokens
      await maxRateLimiter.connect(user1).deposit({ value: 1n });

      // Should be at zero
      expect(await maxRateLimiter.availableTokens(user1.address)).to.equal(0n);
    });

    it("Should handle very large time jumps correctly", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Wait a very long time (1 year)
      await ethers.provider.send("evm_increaseTime", [31536000]);
      await ethers.provider.send("evm_mine");

      // Should be capped at capacity
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(CAPACITY);
    });
  });
});