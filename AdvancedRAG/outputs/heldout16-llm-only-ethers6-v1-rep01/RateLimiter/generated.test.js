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

  describe("Deposit", function () {
    it("Should allow deposit when tokens are available", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(rateLimiter.connect(user1).deposit({ value: depositAmount }))
        .to.emit(rateLimiter, "Deposited")
        .withArgs(user1.address, depositAmount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(depositAmount);
    });

    it("Should consume tokens on deposit", async function () {
      const initialTokens = await rateLimiter.availableTokens(user1.address);
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });
      const newTokens = await rateLimiter.availableTokens(user1.address);
      expect(newTokens).to.equal(initialTokens - COST_PER_CALL);
    });

    it("Should revert when rate limit exceeded", async function () {
      // First call should work
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Second call should fail if not enough time has passed
      await expect(rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") }))
        .to.be.revertedWith("Rate limit exceeded");
    });
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("2") });
    });

    it("Should allow withdrawal when tokens are available", async function () {
      const withdrawAmount = ethers.parseEther("1");
      await expect(rateLimiter.connect(user1).withdraw(withdrawAmount))
        .to.emit(rateLimiter, "Withdrawn")
        .withArgs(user1.address, withdrawAmount);

      expect(await rateLimiter.vaultBalance(user1.address)).to.equal(ethers.parseEther("1"));
    });

    it("Should consume tokens on withdrawal", async function () {
      const initialTokens = await rateLimiter.availableTokens(user1.address);
      await rateLimiter.connect(user1).withdraw(ethers.parseEther("1"));
      const newTokens = await rateLimiter.availableTokens(user1.address);
      expect(newTokens).to.equal(initialTokens - COST_PER_CALL);
    });

    it("Should revert when rate limit exceeded", async function () {
      // First call should work
      await rateLimiter.connect(user1).withdraw(ethers.parseEther("1"));

      // Second call should fail if not enough time has passed
      await expect(rateLimiter.connect(user1).withdraw(ethers.parseEther("1")))
        .to.be.revertedWith("Rate limit exceeded");
    });

    it("Should revert when insufficient balance", async function () {
      await expect(rateLimiter.connect(user1).withdraw(ethers.parseEther("3")))
        .to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Token Refill", function () {
    it("Should refill tokens over time", async function () {
      // First call to consume tokens
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [1]); // 1 second
      await ethers.provider.send("evm_mine");

      const tokensAfterRefill = await rateLimiter.availableTokens(user1.address);
      expect(tokensAfterRefill).to.be.gt(CAPACITY - COST_PER_CALL);
    });

    it("Should not exceed capacity", async function () {
      // First call to consume tokens
      await rateLimiter.connect(user1).deposit({ value: ethers.parseEther("1") });

      // Fast forward time to refill beyond capacity
      await ethers.provider.send("evm_increaseTime", [100]); // 100 seconds
      await ethers.provider.send("evm_mine");

      const tokensAfterRefill = await rateLimiter.availableTokens(user1.address);
      expect(tokensAfterRefill).to.equal(CAPACITY);
    });
  });

  describe("New Users", function () {
    it("Should start with full tokens for new users", async function () {
      const tokens = await rateLimiter.availableTokens(user2.address);
      expect(tokens).to.equal(CAPACITY);
    });
  });
});