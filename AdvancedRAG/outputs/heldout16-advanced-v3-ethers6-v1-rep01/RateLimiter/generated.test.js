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

    it("Should allow multiple users to deposit independently", async function () {
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });
      await rateLimiter.connect(user2).deposit({ value: ethers.parseEther("2") });

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(ethers.parseEther("1"));
      expect(await rateLimiter.vaultBalance(user2.address)).to.equal(ethers.parseEther("2"));
    });
  });

  describe("Withdraw", function () {
    it("Should allow withdrawal when tokens are available and balance suffices", async function () {
      const depositAmount = ethers.parseEther("1");
      const withdrawAmount = ethers.parseEther("0.5");

      await rateLimiter.connect(user1).deposit({ value: depositAmount });

      await expect(rateLimiter.connect(user1).withdraw(withdrawAmount))
        .to.emit(rateLimiter, "Withdrawn")
        .withArgs(user1.address, withdrawAmount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(depositAmount - withdrawAmount);
    });

    it("Should revert when rate limit is exceeded", async function () {
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // First withdrawal should succeed
      await rateLimiter.connect(user1).withdraw(ethers.parseEther("0.5"));

      // Second withdrawal should fail due to rate limit
      await expect(rateLimiter.connect(user1).withdraw(ethers.parseEther("0.5")))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should revert when balance is insufficient", async function () {
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      await expect(rateLimiter.connect(user1).withdraw(ethers.parseEther("2")))
        .to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Token Refill", function () {
    it("Should refill tokens over time", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Check initial tokens
      const initialTokens = await rateLimiter.availableTokens(user1.address);
      expect(initialTokens).to.equal(capacity - costPerCall);

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [1]); // 1 second
      await ethers.provider.send("evm_mine");

      // Check refilled tokens
      const refilledTokens = await rateLimiter.availableTokens(user1.address);
      expect(refilledTokens).to.equal(initialTokens + refillRate);
    });

    it("Should not exceed capacity when refilling", async function () {
      // First call consumes tokens
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Fast forward time to exceed capacity
      await ethers.provider.send("evm_increaseTime", [100]); // 100 seconds
      await ethers.provider.send("evm_mine");

      // Check tokens don't exceed capacity
      const tokens = await rateLimiter.availableTokens(user1.address);
      expect(tokens).to.equal(capacity);
    });
  });

  describe("Token Availability", function () {
    it("Should return full capacity for new users", async function () {
      const tokens = await rateLimiter.availableTokens(user1.address);
      expect(tokens).to.equal(capacity);
    });

    it("Should return correct tokens after consumption", async function () {
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });
      const tokens = await rateLimiter.availableTokens(user1.address);
      expect(tokens).to.equal(capacity - costPerCall);
    });
  });
});