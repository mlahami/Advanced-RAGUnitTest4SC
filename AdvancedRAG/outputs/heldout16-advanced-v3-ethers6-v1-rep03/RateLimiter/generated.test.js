const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RateLimiter", function () {
  let rateLimiter;
  let owner, user1, user2;
  const capacity = 100n;
  const refillRate = 10n; // tokens per second
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
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Second call should fail due to rate limit
      await expect(rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") }))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should allow multiple deposits after refill", async function () {
      // First deposit
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Wait for tokens to refill
      await ethers.provider.send("evm_increaseTime", [10]); // 10 seconds
      await ethers.provider.send("evm_mine");

      // Second deposit should succeed
      await expect(rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") }))
        .to.emit(rateLimiter, "Deposited");
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

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(ethers.parseEther("1"));
    });

    it("Should revert when rate limit is exceeded", async function () {
      const depositAmount = ethers.parseEther("2");

      await rateLimiter.connect(user1).deposit({ value: depositAmount });

      // First withdraw should succeed
      await rateLimiter.connect(user1).withdraw(ethers.parseEther("1"));

      // Second withdraw should fail due to rate limit
      await expect(rateLimiter.connect(user1).withdraw(ethers.parseEther("1")))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should revert when insufficient balance", async function () {
      const depositAmount = ethers.parseEther("1");
      const withdrawAmount = ethers.parseEther("2");

      await rateLimiter.connect(user1).deposit({ value: depositAmount });

      await expect(rateLimiter.connect(user1).withdraw(withdrawAmount))
        .to.be.revertedWith("Insufficient balance");
    });

    it("Should allow multiple withdrawals after refill", async function () {
      const depositAmount = ethers.parseEther("2");

      await rateLimiter.connect(user1).deposit({ value: depositAmount });

      // First withdraw
      await rateLimiter.connect(user1).withdraw(ethers.parseEther("1"));

      // Wait for tokens to refill
      await ethers.provider.send("evm_increaseTime", [10]); // 10 seconds
      await ethers.provider.send("evm_mine");

      // Second withdraw should succeed
      await expect(rateLimiter.connect(user1).withdraw(ethers.parseEther("1")))
        .to.emit(rateLimiter, "Withdrawn");
    });
  });

  describe("Token Management", function () {
    it("Should return correct available tokens for new user", async function () {
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity);
    });

    it("Should return correct available tokens after consumption", async function () {
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity - costPerCall);
    });

    it("Should cap tokens at capacity after refill", async function () {
      // Consume all tokens
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Wait for tokens to refill beyond capacity
      await ethers.provider.send("evm_increaseTime", [20]); // 20 seconds
      await ethers.provider.send("evm_mine");

      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity);
    });
  });

  describe("Bucket Refill", function () {
    it("Should emit BucketRefilled event when tokens are refilled", async function () {
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Wait for tokens to refill
      await ethers.provider.send("evm_increaseTime", [10]); // 10 seconds
      await ethers.provider.send("evm_mine");

      // Trigger refill by making another call
      await expect(rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") }))
        .to.emit(rateLimiter, "BucketRefilled")
        .withArgs(user1.address, refillRate * 10n);
    });

    it("Should not emit BucketRefilled event when no tokens are refilled", async function () {
      // No time has passed
      await expect(rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") }))
        .not.to.emit(rateLimiter, "BucketRefilled");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple users independently", async function () {
      // User1 makes a call
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // User2 should have full capacity
      expect(await rateLimiter.availableTokens(user2.address)).to.equal(capacity);

      // User2 makes a call
      await rateLimiter.connect(user2).deposit({ value: ethers.parseEther("1") });

      // User1's tokens should be reduced
      expect(await rateLimiter.availableTokens(user1.address)).to.equal(capacity - costPerCall);
    });

    it("Should handle maximum uint256 values", async function () {
      const maxRateLimiter = await ethers.getContractFactory("RateLimiter");
      const maxInstance = await maxRateLimiter.deploy(ethers.MaxUint256, ethers.MaxUint256, 1n);
      await maxInstance.waitForDeployment();

      // Should not overflow when calculating tokens
      await maxInstance.connect(user1).deposit({ value: ethers.parseEther("1") });
      expect(await maxInstance.availableTokens(user1.address)).to.equal(ethers.MaxUint256 - 1n);
    });
  });
});