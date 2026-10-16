const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function () {
  let dex, tokenA, tokenB, owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy BenchmarkERC20 tokens
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    tokenA = await BenchmarkERC20.deploy("Token A", "TKA");
    await tokenA.waitForDeployment();
    tokenB = await BenchmarkERC20.deploy("Token B", "TKB");
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
    const DEX = await ethers.getContractFactory("DEX");
    dex = await DEX.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    await dex.waitForDeployment();

    // Approve DEX to spend tokens from users
    await tokenA.connect(user1).approve(await dex.getAddress(), ethers.MaxUint256);
    await tokenB.connect(user1).approve(await dex.getAddress(), ethers.MaxUint256);
    await tokenA.connect(user2).approve(await dex.getAddress(), ethers.MaxUint256);
    await tokenB.connect(user2).approve(await dex.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct token addresses", async function () {
      expect(await dex.tokenA()).to.equal(await tokenA.getAddress());
      expect(await dex.tokenB()).to.equal(await tokenB.getAddress());
    });

    it("Should initialize reserves to zero", async function () {
      expect(await dex.reserveA()).to.equal(0n);
      expect(await dex.reserveB()).to.equal(0n);
    });
  });

  describe("addLiquidity", function () {
    it("Should add initial liquidity", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("100");

      await expect(dex.connect(user1).addLiquidity(amountA, amountB))
        .to.emit(dex, "LiquidityAdded")
        .withArgs(user1.address, amountA * amountB / ethers.parseEther("1"));

      expect(await dex.reserveA()).to.equal(amountA);
      expect(await dex.reserveB()).to.equal(amountB);
      expect(await dex.totalShares()).to.equal(amountA * amountB / ethers.parseEther("1"));
      expect(await dex.shares(user1.address)).to.equal(amountA * amountB / ethers.parseEther("1"));
    });

    it("Should add subsequent liquidity", async function () {
      // Initial liquidity
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));

      // Add more liquidity
      const amountA = ethers.parseEther("50");
      const amountB = ethers.parseEther("50");
      const expectedShares = (amountA * (await dex.totalShares())) / (await dex.reserveA());

      await expect(dex.connect(user1).addLiquidity(amountA, amountB))
        .to.emit(dex, "LiquidityAdded")
        .withArgs(user1.address, expectedShares);

      expect(await dex.reserveA()).to.equal(ethers.parseEther("150"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("150"));
      expect(await dex.totalShares()).to.equal(expectedShares + (await dex.totalShares()) - expectedShares);
      expect(await dex.shares(user1.address)).to.equal(expectedShares + (await dex.shares(user1.address)) - expectedShares);
    });

    it("Should revert when adding insufficient liquidity", async function () {
      await expect(dex.connect(user1).addLiquidity(ethers.parseEther("1"), ethers.parseEther("0")))
        .to.be.revertedWith("Insufficient liquidity minted");
    });
  });

  describe("removeLiquidity", function () {
    beforeEach(async function () {
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("Should remove liquidity", async function () {
      const shares = await dex.shares(user1.address);
      const expectedAmountA = (shares * (await dex.reserveA())) / (await dex.totalShares());
      const expectedAmountB = (shares * (await dex.reserveB())) / (await dex.totalShares());

      await expect(dex.connect(user1).removeLiquidity(shares))
        .to.emit(dex, "LiquidityRemoved")
        .withArgs(user1.address, shares);

      expect(await dex.reserveA()).to.equal(0n);
      expect(await dex.reserveB()).to.equal(0n);
      expect(await dex.totalShares()).to.equal(0n);
      expect(await dex.shares(user1.address)).to.equal(0n);
      expect(await tokenA.balanceOf(user1.address)).to.equal(ethers.parseEther("1000"));
      expect(await tokenB.balanceOf(user1.address)).to.equal(ethers.parseEther("1000"));
    });

    it("Should revert when removing more shares than owned", async function () {
      const shares = await dex.shares(user1.address);
      await expect(dex.connect(user1).removeLiquidity(shares + 1n))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("swapAforB", function () {
    beforeEach(async function () {
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("Should swap tokenA for tokenB", async function () {
      const amountIn = ethers.parseEther("10");
      const reserveA = await dex.reserveA();
      const reserveB = await dex.reserveB();
      const amountInWithFee = amountIn * 997n;
      const amountOut = (amountInWithFee * reserveB) / ((reserveA * 1000n) + amountInWithFee);

      await expect(dex.connect(user1).swapAforB(amountIn))
        .to.emit(dex, "Swapped")
        .withArgs(user1.address, await tokenA.getAddress(), amountIn, amountOut);

      expect(await dex.reserveA()).to.equal(reserveA + amountIn);
      expect(await dex.reserveB()).to.equal(reserveB - amountOut);
      expect(await tokenA.balanceOf(user1.address)).to.equal(ethers.parseEther("990"));
      expect(await tokenB.balanceOf(user1.address)).to.equal(ethers.parseEther("1000") + amountOut);
    });

    it("Should revert when swapping zero amount", async function () {
      await expect(dex.connect(user1).swapAforB(0n))
        .to.be.reverted;
    });
  });

  describe("swapBforA", function () {
    beforeEach(async function () {
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("Should swap tokenB for tokenA", async function () {
      const amountIn = ethers.parseEther("10");
      const reserveA = await dex.reserveA();
      const reserveB = await dex.reserveB();
      const amountInWithFee = amountIn * 997n;
      const amountOut = (amountInWithFee * reserveA) / ((reserveB * 1000n) + amountInWithFee);

      await expect(dex.connect(user1).swapBforA(amountIn))
        .to.emit(dex, "Swapped")
        .withArgs(user1.address, await tokenB.getAddress(), amountIn, amountOut);

      expect(await dex.reserveA()).to.equal(reserveA - amountOut);
      expect(await dex.reserveB()).to.equal(reserveB + amountIn);
      expect(await tokenA.balanceOf(user1.address)).to.equal(ethers.parseEther("1000") + amountOut);
      expect(await tokenB.balanceOf(user1.address)).to.equal(ethers.parseEther("990"));
    });

    it("Should revert when swapping zero amount", async function () {
      await expect(dex.connect(user1).swapBforA(0n))
        .to.be.reverted;
    });
  });
});