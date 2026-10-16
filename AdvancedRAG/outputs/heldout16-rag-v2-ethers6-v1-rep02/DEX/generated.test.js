const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function () {
  let tokenA, tokenB, dex;
  let owner, user1, user2;
  const initialAmount = ethers.parseEther("1000");

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy token fixtures
    const BenchmarkERC20Factory = await ethers.getContractFactory("BenchmarkERC20");
    tokenA = await BenchmarkERC20Factory.deploy("Token A", "TKA");
    tokenB = await BenchmarkERC20Factory.deploy("Token B", "TKB");

    // Mint initial tokens
    await tokenA.mint(owner.address, initialAmount);
    await tokenB.mint(owner.address, initialAmount);

    // Deploy DEX
    const DEXFactory = await ethers.getContractFactory("DEX");
    dex = await DEXFactory.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    await dex.waitForDeployment();

    // Approve DEX to spend tokens
    await tokenA.approve(await dex.getAddress(), ethers.MaxUint256);
    await tokenB.approve(await dex.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("should set the correct token addresses", async function () {
      expect(await dex.tokenA()).to.equal(await tokenA.getAddress());
      expect(await dex.tokenB()).to.equal(await tokenB.getAddress());
    });

    it("should initialize reserves to zero", async function () {
      expect(await dex.reserveA()).to.equal(0n);
      expect(await dex.reserveB()).to.equal(0n);
    });
  });

  describe("addLiquidity", function () {
    it("should add initial liquidity correctly", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("100");

      await tokenA.approve(await dex.getAddress(), amountA);
      await tokenB.approve(await dex.getAddress(), amountB);

      const tx = await dex.addLiquidity(amountA, amountB);
      const receipt = await tx.wait();

      // Check event emission
      const event = receipt.logs.find(log => log.fragment.name === "LiquidityAdded");
      expect(event.args.provider).to.equal(owner.address);
      expect(event.args.sharesIssued).to.equal(ethers.parseEther("10000")); // sqrt(100 * 100)

      // Check state changes
      expect(await dex.reserveA()).to.equal(amountA);
      expect(await dex.reserveB()).to.equal(amountB);
      expect(await dex.totalShares()).to.equal(ethers.parseEther("10000"));
      expect(await dex.shares(owner.address)).to.equal(ethers.parseEther("10000"));
    });

    it("should add subsequent liquidity proportionally", async function () {
      // Initial liquidity
      await dex.addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));

      // Add more liquidity
      const tx = await dex.addLiquidity(ethers.parseEther("50"), ethers.parseEther("50"));
      const receipt = await tx.wait();

      // Check event emission
      const event = receipt.logs.find(log => log.fragment.name === "LiquidityAdded");
      expect(event.args.provider).to.equal(owner.address);
      expect(event.args.sharesIssued).to.be.closeTo(ethers.parseEther("5000"), ethers.parseEther("1")); // sqrt(50 * 50)

      // Check state changes
      expect(await dex.reserveA()).to.equal(ethers.parseEther("150"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("150"));
      expect(await dex.totalShares()).to.equal(ethers.parseEther("15000"));
      expect(await dex.shares(owner.address)).to.equal(ethers.parseEther("15000"));
    });

    it("should revert when adding zero liquidity", async function () {
      await expect(dex.addLiquidity(0, ethers.parseEther("100")))
        .to.be.revertedWith("Insufficient liquidity minted");

      await expect(dex.addLiquidity(ethers.parseEther("100"), 0))
        .to.be.revertedWith("Insufficient liquidity minted");
    });
  });

  describe("removeLiquidity", function () {
    beforeEach(async function () {
      await dex.addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("should remove liquidity correctly", async function () {
      const sharesToRemove = ethers.parseEther("5000"); // 50% of total shares

      const tx = await dex.removeLiquidity(sharesToRemove);
      const receipt = await tx.wait();

      // Check event emission
      const event = receipt.logs.find(log => log.fragment.name === "LiquidityRemoved");
      expect(event.args.provider).to.equal(owner.address);
      expect(event.args.sharesBurned).to.equal(sharesToRemove);

      // Check state changes
      expect(await dex.reserveA()).to.equal(ethers.parseEther("50"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("50"));
      expect(await dex.totalShares()).to.equal(ethers.parseEther("5000"));
      expect(await dex.shares(owner.address)).to.equal(ethers.parseEther("5000"));
    });

    it("should revert when removing more shares than owned", async function () {
      const sharesToRemove = ethers.parseEther("10001"); // More than owned
      await expect(dex.removeLiquidity(sharesToRemove))
        .to.be.revertedWith("Insufficient shares");
    });

    it("should revert when removing zero shares", async function () {
      await expect(dex.removeLiquidity(0))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("swapAforB", function () {
    beforeEach(async function () {
      await dex.addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("should swap tokenA for tokenB correctly", async function () {
      const amountIn = ethers.parseEther("10");
      const expectedOut = (amountIn * 997n * ethers.parseEther("100")) / ((ethers.parseEther("100") * 1000n) + (amountIn * 997n));

      await tokenA.approve(await dex.getAddress(), amountIn);
      const tx = await dex.swapAforB(amountIn);
      const receipt = await tx.wait();

      // Check event emission
      const event = receipt.logs.find(log => log.fragment.name === "Swapped");
      expect(event.args.user).to.equal(owner.address);
      expect(event.args.tokenIn).to.equal(await tokenA.getAddress());
      expect(event.args.amountIn).to.equal(amountIn);
      expect(event.args.amountOut).to.equal(expectedOut);

      // Check state changes
      expect(await dex.reserveA()).to.equal(ethers.parseEther("110"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("100") - expectedOut);
    });

    it("should revert when swapping zero amount", async function () {
      await expect(dex.swapAforB(0))
        .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should revert when swapping exceeds reserves", async function () {
      const amountIn = ethers.parseEther("1000"); // More than available
      await tokenA.approve(await dex.getAddress(), amountIn);
      await expect(dex.swapAforB(amountIn))
        .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });

  describe("swapBforA", function () {
    beforeEach(async function () {
      await dex.addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("should swap tokenB for tokenA correctly", async function () {
      const amountIn = ethers.parseEther("10");
      const expectedOut = (amountIn * 997n * ethers.parseEther("100")) / ((ethers.parseEther("100") * 1000n) + (amountIn * 997n));

      await tokenB.approve(await dex.getAddress(), amountIn);
      const tx = await dex.swapBforA(amountIn);
      const receipt = await tx.wait();

      // Check event emission
      const event = receipt.logs.find(log => log.fragment.name === "Swapped");
      expect(event.args.user).to.equal(owner.address);
      expect(event.args.tokenIn).to.equal(await tokenB.getAddress());
      expect(event.args.amountIn).to.equal(amountIn);
      expect(event.args.amountOut).to.equal(expectedOut);

      // Check state changes
      expect(await dex.reserveB()).to.equal(ethers.parseEther("110"));
      expect(await dex.reserveA()).to.equal(ethers.parseEther("100") - expectedOut);
    });

    it("should revert when swapping zero amount", async function () {
      await expect(dex.swapBforA(0))
        .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should revert when swapping exceeds reserves", async function () {
      const amountIn = ethers.parseEther("1000"); // More than available
      await tokenB.approve(await dex.getAddress(), amountIn);
      await expect(dex.swapBforA(amountIn))
        .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });

  describe("Edge Cases", function () {
    it("should handle very small swaps", async function () {
      await dex.addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));

      const amountIn = 1n; // 1 wei
      await tokenA.approve(await dex.getAddress(), amountIn);
      const tx = await dex.swapAforB(amountIn);
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => log.fragment.name === "Swapped");
      expect(event.args.amountOut).to.be.gt(0n);
    });

    it("should handle very large swaps", async function () {
      await dex.addLiquidity(ethers.parseEther("1000000"), ethers.parseEther("1000000"));

      const amountIn = ethers.parseEther("100000"); // Large amount
      await tokenA.approve(await dex.getAddress(), amountIn);
      const tx = await dex.swapAforB(amountIn);
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => log.fragment.name === "Swapped");
      expect(event.args.amountOut).to.be.gt(0n);
    });
  });
});