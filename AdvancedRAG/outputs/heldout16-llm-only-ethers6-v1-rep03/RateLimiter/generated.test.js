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

  describe("Deposit", function () {
    it("Should allow deposit when tokens are available", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(rateLimiter.connect(user1).deposit({ value: depositAmount }))
        .to.emit(rateLimiter, "Deposited")
        .withArgs(user1.address, depositAmount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(depositAmount);
    });

    it("Should revert when rate limit is exceeded", async function () {
      // First call should succeed
      await rateLimiter.connect(user1).deposit({ value: 0n });

      // Second call should fail due to rate limit
      await expect(rateLimiter.connect(user1).deposit({ value: 0n }))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should allow multiple deposits after refill", async function () {
      // First deposit
      await rateLimiter.connect(user1).deposit({ value: 0n });

      // Wait for tokens to refill
      await ethers.provider.send("evm_increaseTime", [10]); // 10 seconds
      await ethers.provider.send("evm_mine");

      // Second deposit should succeed
      await expect(rateLimiter.connect(user1).deposit({ value: 0n }))
        .to.emit(rateLimiter, "Deposited");
    });
  });

  describe("Withdraw", function () {
    it("Should allow withdraw when tokens are available", async function () {
      const depositAmount = ethers.parseEther("1");
      await rateLimiter.connect(user1).deposit({ value: depositAmount });

      // Reset tokens for withdraw
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const withdrawAmount = ethers.parseEther("0.5");
      await expect(rateLimiter.connect(user1).withdraw(withdrawAmount))
        .to.emit(rateLimiter, "Withdrawn")
        .withArgs(user1.address, withdrawAmount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(depositAmount - withdrawAmount);
    });

    it("Should revert when rate limit is exceeded", async function () {
      // First withdraw should succeed
      await rateLimiter.connect(user1).deposit({ value: 0n });

      // Reset tokens for withdraw
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      // Second withdraw should fail due to rate limit
      await expect(rateLimiter.connect(user1).withdraw(0n))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should revert when insufficient balance", async function () {
      const depositAmount = ethers.parseEther("1");
      await rateLimiter.connect(user1).deposit({ value: depositAmount });

      // Reset tokens for withdraw
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      await expect(rateLimiter.connect(user1).withdraw(depositAmount + 1n))
        .to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Token Management", function () {
    it("Should return correct available tokens for new user", async function () {
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity);
    });

    it("Should return correct available tokens after consumption", async function () {
      await rateLimiter.connect(user1).deposit({ value: 0n });
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity - costPerCall);
    });

    it("Should cap tokens at capacity after refill", async function () {
      // Consume all tokens
      await rateLimiter.connect(user1).deposit({ value: 0n });

      // Wait for tokens to refill beyond capacity
      await ethers.provider.send("evm_increaseTime", [20]); // 20 seconds
      await ethers.provider.send("evm_mine");

      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity);
    });
  });

  describe("Rate Limiting", function () {
    it("Should correctly calculate tokens after time passes", async function () {
      // First call
      await rateLimiter.connect(user1).deposit({ value: 0n });

      // Wait 5 seconds
      await ethers.provider.send("evm_increaseTime", [5]);
      await ethers.provider.send("evm_mine");

      // Should have 50 tokens (5 seconds * 10 tokens/second)
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity - costPerCall + 50n);
    });

    it("Should not allow more than capacity tokens", async function () {
      // Consume all tokens
      await rateLimiter.connect(user1).deposit({ value: 0n });

      // Wait for tokens to refill beyond capacity
      await ethers.provider.send("evm_increaseTime", [20]); // 20 seconds
      await ethers.provider.send("evm_mine");

      // Should be capped at capacity
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity);
    });
  });
});