const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function () {
  let dex;
  let tokenA;
  let tokenB;
  let owner;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock tokens
    const TokenFactory = await ethers.getContractFactory("BenchmarkERC20");
    tokenA = await TokenFactory.deploy("Token A", "TKA");
    await tokenA.waitForDeployment();
    tokenB = await TokenFactory.deploy("Token B", "TKB");
    await tokenB.waitForDeployment();

    // Mint tokens to users
    await tokenA.mint(user1.address, ethers.parseEther("1000"));
    await tokenB.mint(user1.address, ethers.parseEther("1000"));
    await tokenA.mint(user2.address, ethers.parseEther("1000"));
    await tokenB.mint(user2.address, ethers.parseEther("1000"));

    // Approve DEX to spend tokens
    await tokenA.connect(user1).approve(await tokenA.getAddress(), ethers.MaxUint256);
    await tokenB.connect(user1).approve(await tokenB.getAddress(), ethers.MaxUint256);
    await tokenA.connect(user2).approve(await tokenA.getAddress(), ethers.MaxUint256);
    await tokenB.connect(user2).approve(await tokenB.getAddress(), ethers.MaxUint256);

    // Deploy DEX
    const DEXFactory = await ethers.getContractFactory("DEX");
    dex = await DEXFactory.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    await dex.waitForDeployment();
  });

  describe("Liquidity Management", function () {
    it("should add initial liquidity", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("200");

      // Approve DEX to spend user's tokens
      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);

      // Add liquidity
      const tx = await dex.connect(user1).addLiquidity(amountA, amountB);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => {
        try {
          return dex.interface.parseLog(log).name === "LiquidityAdded";
        } catch {
          return false;
        }
      });
      const parsedEvent = dex.interface.parseLog(event);
      expect(parsedEvent.args.provider).to.equal(user1.address);
      expect(parsedEvent.args.sharesIssued).to.be.gt(0n);

      // Check state
      expect(await dex.reserveA()).to.equal(amountA);
      expect(await dex.reserveB()).to.equal(amountB);
      expect(await dex.totalShares()).to.equal(parsedEvent.args.sharesIssued);
      expect(await dex.shares(user1.address)).to.equal(parsedEvent.args.sharesIssued);
    });

    it("should add subsequent liquidity", async function () {
      // Initial liquidity
      const initialA = ethers.parseEther("100");
      const initialB = ethers.parseEther("200");
      await tokenA.connect(user1).approve(await dex.getAddress(), initialA);
      await tokenB.connect(user1).approve(await dex.getAddress(), initialB);
      await dex.connect(user1).addLiquidity(initialA, initialB);

      // Additional liquidity
      const amountA = ethers.parseEther("50");
      const amountB = ethers.parseEther("100");
      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);

      const tx = await dex.connect(user1).addLiquidity(amountA, amountB);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => {
        try {
          return dex.interface.parseLog(log).name === "LiquidityAdded";
        } catch {
          return false;
        }
      });
      const parsedEvent = dex.interface.parseLog(event);
      expect(parsedEvent.args.provider).to.equal(user1.address);
      expect(parsedEvent.args.sharesIssued).to.be.gt(0n);

      // Check state
      expect(await dex.reserveA()).to.equal(initialA + amountA);
      expect(await dex.reserveB()).to.equal(initialB + amountB);
      expect(await dex.totalShares()).to.equal(parsedEvent.args.sharesIssued + (initialA * initialB) ** 0.5n);
      expect(await dex.shares(user1.address)).to.equal(parsedEvent.args.sharesIssued + (initialA * initialB) ** 0.5n);
    });

    it("should remove liquidity", async function () {
      // Add initial liquidity
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("200");
      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);
      await dex.connect(user1).addLiquidity(amountA, amountB);

      const shares = await dex.shares(user1.address);

      // Remove liquidity
      const tx = await dex.connect(user1).removeLiquidity(shares);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => {
        try {
          return dex.interface.parseLog(log).name === "LiquidityRemoved";
        } catch {
          return false;
        }
      });
      const parsedEvent = dex.interface.parseLog(event);
      expect(parsedEvent.args.provider).to.equal(user1.address);
      expect(parsedEvent.args.sharesBurned).to.equal(shares);

      // Check state
      expect(await dex.reserveA()).to.equal(0n);
      expect(await dex.reserveB()).to.equal(0n);
      expect(await dex.totalShares()).to.equal(0n);
      expect(await dex.shares(user1.address)).to.equal(0n);
    });

    it("should revert when removing more liquidity than owned", async function () {
      // Add initial liquidity
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("200");
      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);
      await dex.connect(user1).addLiquidity(amountA, amountB);

      const shares = await dex.shares(user1.address);

      // Try to remove more than owned
      await expect(dex.connect(user1).removeLiquidity(shares + 1n))
        .to.be.revertedWith("Insufficient shares");
    });

    it("should revert when adding liquidity with zero amount", async function () {
      await expect(dex.connect(user1).addLiquidity(0n, ethers.parseEther("100")))
        .to.be.revertedWith("Insufficient liquidity minted");

      await expect(dex.connect(user1).addLiquidity(ethers.parseEther("100"), 0n))
        .to.be.revertedWith("Insufficient liquidity minted");
    });
  });

  describe("Swapping", function () {
    beforeEach(async function () {
      // Add initial liquidity
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("200");
      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);
      await dex.connect(user1).addLiquidity(amountA, amountB);
    });

    it("should swap tokenA for tokenB", async function () {
      const amountIn = ethers.parseEther("10");
      await tokenA.connect(user2).approve(await dex.getAddress(), amountIn);

      const reserveA = await dex.reserveA();
      const reserveB = await dex.reserveB();

      const tx = await dex.connect(user2).swapAforB(amountIn);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => {
        try {
          return dex.interface.parseLog(log).name === "Swapped";
        } catch {
          return false;
        }
      });
      const parsedEvent = dex.interface.parseLog(event);
      expect(parsedEvent.args.user).to.equal(user2.address);
      expect(parsedEvent.args.tokenIn).to.equal(await tokenA.getAddress());
      expect(parsedEvent.args.amountIn).to.equal(amountIn);
      expect(parsedEvent.args.amountOut).to.be.gt(0n);

      // Check state
      expect(await dex.reserveA()).to.equal(reserveA + amountIn);
      expect(await dex.reserveB()).to.be.lt(reserveB);
    });

    it("should swap tokenB for tokenA", async function () {
      const amountIn = ethers.parseEther("20");
      await tokenB.connect(user2).approve(await dex.getAddress(), amountIn);

      const reserveA = await dex.reserveA();
      const reserveB = await dex.reserveB();

      const tx = await dex.connect(user2).swapBforA(amountIn);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => {
        try {
          return dex.interface.parseLog(log).name === "Swapped";
        } catch {
          return false;
        }
      });
      const parsedEvent = dex.interface.parseLog(event);
      expect(parsedEvent.args.user).to.equal(user2.address);
      expect(parsedEvent.args.tokenIn).to.equal(await tokenB.getAddress());
      expect(parsedEvent.args.amountIn).to.equal(amountIn);
      expect(parsedEvent.args.amountOut).to.be.gt(0n);

      // Check state
      expect(await dex.reserveB()).to.equal(reserveB + amountIn);
      expect(await dex.reserveA()).to.be.lt(reserveA);
    });

    it("should revert when swapping with zero amount", async function () {
      await expect(dex.connect(user2).swapAforB(0n))
        .to.be.reverted;

      await expect(dex.connect(user2).swapBforA(0n))
        .to.be.reverted;
    });
  });
});