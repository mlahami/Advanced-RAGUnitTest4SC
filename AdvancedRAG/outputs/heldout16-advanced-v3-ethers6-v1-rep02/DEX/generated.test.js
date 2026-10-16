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

      // Approve DEX to spend tokens
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
      await tokenA.connect(user1).approve(await dex.getAddress(), ethers.parseEther("100"));
      await tokenB.connect(user1).approve(await dex.getAddress(), ethers.parseEther("200"));
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));

      // Add more liquidity
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
      expect(await dex.reserveA()).to.equal(ethers.parseEther("150"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("300"));
      expect(await dex.totalShares()).to.be.gt(ethers.parseEther("200"));
      expect(await dex.shares(user1.address)).to.be.gt(ethers.parseEther("200"));
    });

    it("should remove liquidity", async function () {
      // Add initial liquidity
      await tokenA.connect(user1).approve(await dex.getAddress(), ethers.parseEther("100"));
      await tokenB.connect(user1).approve(await dex.getAddress(), ethers.parseEther("200"));
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));

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

    it("should revert when removing more liquidity than available", async function () {
      // Add initial liquidity
      await tokenA.connect(user1).approve(await dex.getAddress(), ethers.parseEther("100"));
      await tokenB.connect(user1).approve(await dex.getAddress(), ethers.parseEther("200"));
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));

      const shares = await dex.shares(user1.address);

      // Try to remove more than available
      await expect(dex.connect(user1).removeLiquidity(shares + 1n))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("Swapping", function () {
    beforeEach(async function () {
      // Add initial liquidity
      await tokenA.connect(user1).approve(await dex.getAddress(), ethers.parseEther("100"));
      await tokenB.connect(user1).approve(await dex.getAddress(), ethers.parseEther("200"));
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));
    });

    it("should swap tokenA for tokenB", async function () {
      const amountIn = ethers.parseEther("10");
      const balanceBefore = await tokenB.balanceOf(user2.address);

      // Approve DEX to spend tokenA
      await tokenA.connect(user2).approve(await dex.getAddress(), amountIn);

      // Swap
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
      expect(await tokenB.balanceOf(user2.address)).to.equal(balanceBefore + parsedEvent.args.amountOut);
      expect(await dex.reserveA()).to.equal(ethers.parseEther("110"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("200") - parsedEvent.args.amountOut);
    });

    it("should swap tokenB for tokenA", async function () {
      const amountIn = ethers.parseEther("20");
      const balanceBefore = await tokenA.balanceOf(user2.address);

      // Approve DEX to spend tokenB
      await tokenB.connect(user2).approve(await dex.getAddress(), amountIn);

      // Swap
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
      expect(await tokenA.balanceOf(user2.address)).to.equal(balanceBefore + parsedEvent.args.amountOut);
      expect(await dex.reserveB()).to.equal(ethers.parseEther("220"));
      expect(await dex.reserveA()).to.equal(ethers.parseEther("100") - parsedEvent.args.amountOut);
    });

    it("should revert when swapping with zero amount", async function () {
      await expect(dex.connect(user2).swapAforB(0n))
        .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });

  describe("Edge Cases", function () {
    it("should handle zero liquidity case", async function () {
      // No liquidity added yet
      expect(await dex.reserveA()).to.equal(0n);
      expect(await dex.reserveB()).to.equal(0n);
      expect(await dex.totalShares()).to.equal(0n);

      // Try to add liquidity with zero amounts
      await expect(dex.connect(user1).addLiquidity(0n, 0n))
        .to.be.revertedWith("Insufficient liquidity minted");
    });

    it("should handle large numbers", async function () {
      const largeAmount = ethers.parseEther("1000000000");

      // Mint large amounts
      await tokenA.mint(user1.address, largeAmount);
      await tokenB.mint(user1.address, largeAmount);

      // Approve DEX
      await tokenA.connect(user1).approve(await dex.getAddress(), largeAmount);
      await tokenB.connect(user1).approve(await dex.getAddress(), largeAmount);

      // Add large liquidity
      await dex.connect(user1).addLiquidity(largeAmount, largeAmount);

      // Check state
      expect(await dex.reserveA()).to.equal(largeAmount);
      expect(await dex.reserveB()).to.equal(largeAmount);
      expect(await dex.totalShares()).to.be.gt(0n);
    });
  });
});