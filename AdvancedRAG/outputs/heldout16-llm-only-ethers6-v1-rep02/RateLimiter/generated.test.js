const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RateLimiter", function () {
  let RateLimiter, rateLimiter, owner, user1, user2;
  const capacity = 100n;
  const refillRate = 10n; // tokens per second
  const costPerCall = 20n;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    RateLimiter = await ethers.getContractFactory("RateLimiter");
    rateLimiter = await RateLimiter.deploy(capacity, refillRate, costPerCall);
    await rateLimiter.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await rateLimiter.owner()).to.equal(owner.address);
    });

    it("Should set the correct parameters", async function () {
      expect(await rateLimiter.capacity()).to.equal(capacity);
      expect(await rateLimiter.refillRate()).to.equal(refillRate);
      expect(await rateLimiter.costPerCall()).to.equal(costPerCall);
    });

    it("Should revert with zero parameters", async function () {
      await expect(RateLimiter.deploy(0n, refillRate, costPerCall)).to.be.revertedWith("Zero param");
      await expect(RateLimiter.deploy(capacity, 0n, costPerCall)).to.be.revertedWith("Zero param");
      await expect(RateLimiter.deploy(capacity, refillRate, 0n)).to.be.revertedWith("Zero param");
    });
  });

  describe("Token Bucket", function () {
    it("Should initialize new users with full capacity", async function () {
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity);
    });

    it("Should refill tokens over time", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Get current tokens before waiting
      const initialTokens = await rateLimiter.availableTokens(user1.address);

      // Wait for 1 second
      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine");

      // Check that tokens have increased
      const newTokens = await rateLimiter.availableTokens(user1.address);
      expect(newTokens).to.be.gt(initialTokens);
      expect(newTokens).to.be.lte(capacity);
    });

    it("Should not exceed capacity", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Wait for enough time to exceed capacity
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      // Tokens should be at capacity
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity);
    });
  });

  describe("Deposit", function () {
    it("Should allow deposit when tokens are available", async function () {
      const amount = ethers.parseEther("1");
      await expect(rateLimiter.connect(user1).deposit({ value: amount }))
        .to.emit(rateLimiter, "Deposited")
        .withArgs(user1.address, amount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(amount);
    });

    it("Should revert when rate limit is exceeded", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Try to make another call before tokens refill
      await expect(rateLimiter.connect(user1).deposit({ value: 1n }))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should consume tokens on deposit", async function () {
      const initialTokens = await rateLimiter.availableTokens(user1.address);
      await rateLimiter.connect(user1).deposit({ value: 1n });
      const newTokens = await rateLimiter.availableTokens(user1.address);

      expect(newTokens).to.equal(initialTokens - costPerCall);
    });
  });

  describe("Withdraw", function () {
    it("Should allow withdraw when tokens are available", async function () {
      const amount = ethers.parseEther("1");
      await rateLimiter.connect(user1).deposit({ value: amount });

      await expect(rateLimiter.connect(user1).withdraw(amount))
        .to.emit(rateLimiter, "Withdrawn")
        .withArgs(user1.address, amount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(0n);
    });

    it("Should revert when rate limit is exceeded", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Try to make another call before tokens refill
      await expect(rateLimiter.connect(user1).withdraw(1n))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should revert when insufficient balance", async function () {
      await expect(rateLimiter.connect(user1).withdraw(1n))
        .to.be.revertedWith("Insufficient balance");
    });

    it("Should consume tokens on withdraw", async function () {
      const amount = ethers.parseEther("1");
      await rateLimiter.connect(user1).deposit({ value: amount });

      const initialTokens = await rateLimiter.availableTokens(user1.address);
      await rateLimiter.connect(user1).withdraw(amount);
      const newTokens = await rateLimiter.availableTokens(user1.address);

      expect(newTokens).to.equal(initialTokens - costPerCall);
    });
  });

  describe("Token Consumption", function () {
    it("Should correctly calculate available tokens", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Wait for 1 second
      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine");

      // Calculate expected tokens
      const expectedTokens = capacity - costPerCall + refillRate;

      expect(await rateLimiter.availableTokens(user1.address)).to.equal(expectedTokens);
    });

    it("Should handle multiple users independently", async function () {
      // User1 makes a call
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // User2 should still have full capacity
      expect(await rateLimiter.availableTokens(user2.address)).to.equal(capacity);
    });
  });
});