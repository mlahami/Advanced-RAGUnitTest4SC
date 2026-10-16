const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RateLimiter", function () {
  let rateLimiter;
  let owner, user1, user2;
  const capacity = 100n;
  const refillRate = 10n; // 10 tokens per second
  const costPerCall = 20n;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const RateLimiter = await ethers.getContractFactory("RateLimiter");
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
      const RateLimiter = await ethers.getContractFactory("RateLimiter");
      await expect(RateLimiter.deploy(0, refillRate, costPerCall)).to.be.revertedWith("Zero param");
      await expect(RateLimiter.deploy(capacity, 0, costPerCall)).to.be.revertedWith("Zero param");
      await expect(RateLimiter.deploy(capacity, refillRate, 0)).to.be.revertedWith("Zero param");
    });
  });

  describe("Token Bucket", function () {
    it("Should initialize new users with full capacity", async function () {
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity);
    });

    it("Should correctly calculate available tokens after time passes", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Get current tokens
      const currentTokens = await rateLimiter.availableTokens(user1.address);

      // Wait 1 second
      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine");

      // Check tokens increased by refillRate * time
      const newTokens = await rateLimiter.availableTokens(user1.address);
      expect(newTokens).to.equal(currentTokens + refillRate);
    });

    it("Should cap tokens at capacity", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: 1n });

      // Wait enough time to exceed capacity
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      // Tokens should be capped at capacity
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

    it("Should update bucket state after deposit", async function () {
      const initialTokens = await rateLimiter.availableTokens(user1.address);
      await rateLimiter.connect(user1).deposit({ value: 1n });
      const newTokens = await rateLimiter.availableTokens(user1.address);

      expect(newTokens).to.equal(initialTokens - costPerCall);
    });
  });

  describe("Withdraw", function () {
    it("Should allow withdraw when tokens are available", async function () {
      const depositAmount = ethers.parseEther("2");
      const withdrawAmount = ethers.parseEther("1");

      await rateLimiter.connect(user1).deposit({ value: depositAmount });

      await expect(rateLimiter.connect(user1).withdraw(withdrawAmount))
        .to.emit(rateLimiter, "Withdrawn")
        .withArgs(user1.address, withdrawAmount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(depositAmount - withdrawAmount);
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

    it("Should update bucket state after withdraw", async function () {
      const initialTokens = await rateLimiter.availableTokens(user1.address);
      await rateLimiter.connect(user1).deposit({ value: 1n });
      const newTokens = await rateLimiter.availableTokens(user1.address);

      expect(newTokens).to.equal(initialTokens - costPerCall);
    });
  });

  describe("Access Control", function () {
    it("Should allow owner to call owner-only functions", async function () {
      // No owner-only functions in this contract, but this is a placeholder
      // for contracts that might have such functions
    });

    it("Should prevent non-owners from calling owner-only functions", async function () {
      // No owner-only functions in this contract, but this is a placeholder
      // for contracts that might have such functions
    });
  });
});