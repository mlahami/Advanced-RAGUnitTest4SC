const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function () {
  let dex;
  let tokenA;
  let tokenB;
  let owner;
  let user1;
  let user2;

  const INITIAL_AMOUNT = ethers.parseEther("1000");

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy tokenA
    const TokenAFactory = await ethers.getContractFactory("BenchmarkERC20");
    tokenA = await TokenAFactory.deploy("Token A", "TKA");
    await tokenA.waitForDeployment();

    // Deploy tokenB
    const TokenBFactory = await ethers.getContractFactory("BenchmarkERC20");
    tokenB = await TokenBFactory.deploy("Token B", "TKB");
    await tokenB.waitForDeployment();

    // Deploy DEX
    const DEXFactory = await ethers.getContractFactory("DEX");
    dex = await DEXFactory.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    await dex.waitForDeployment();

    // Mint initial tokens to users
    await tokenA.mint(owner.address, INITIAL_AMOUNT);
    await tokenB.mint(owner.address, INITIAL_AMOUNT);
    await tokenA.mint(user1.address, INITIAL_AMOUNT);
    await tokenB.mint(user1.address, INITIAL_AMOUNT);
    await tokenA.mint(user2.address, INITIAL_AMOUNT);
    await tokenB.mint(user2.address, INITIAL_AMOUNT);

    // Approve DEX to spend tokens
    await tokenA.connect(owner).approve(await dex.getAddress(), ethers.MaxUint256);
    await tokenB.connect(owner).approve(await dex.getAddress(), ethers.MaxUint256);
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
    it("Should add initial liquidity correctly", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("100");

      await expect(dex.connect(owner).addLiquidity(amountA, amountB))
        .to.emit(dex, "LiquidityAdded")
        .withArgs(owner.address, amountA * amountB / 1n);

      expect(await dex.reserveA()).to.equal(amountA);
      expect(await dex.reserveB()).to.equal(amountB);
      expect(await dex.totalShares()).to.equal(amountA * amountB / 1n);
      expect(await dex.shares(owner.address)).to.equal(amountA * amountB / 1n);
    });

    it("Should add subsequent liquidity proportionally", async function () {
      // Initial liquidity
      await dex.connect(owner).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));

      // Add more liquidity
      const amountA = ethers.parseEther("50");
      const amountB = ethers.parseEther("50");
      const expectedShares = (amountA * (await dex.totalShares())) / (await dex.reserveA());

      await expect(dex.connect(owner).addLiquidity(amountA, amountB))
        .to.emit(dex, "LiquidityAdded")
        .withArgs(owner.address, expectedShares);

      expect(await dex.reserveA()).to.equal(ethers.parseEther("150"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("150"));
      expect(await dex.totalShares()).to.equal(ethers.parseEther("100") * ethers.parseEther("100") / 1n + expectedShares);
    });

    it("Should revert when adding zero liquidity", async function () {
      await expect(dex.connect(owner).addLiquidity(0, ethers.parseEther("100")))
        .to.be.revertedWith("Insufficient liquidity minted");

      await expect(dex.connect(owner).addLiquidity(ethers.parseEther("100"), 0))
        .to.be.revertedWith("Insufficient liquidity minted");
    });
  });

  describe("removeLiquidity", function () {
    beforeEach(async function () {
      await dex.connect(owner).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("Should remove liquidity correctly", async function () {
      const shares = await dex.shares(owner.address);
      const expectedAmountA = (shares * (await dex.reserveA())) / (await dex.totalShares());
      const expectedAmountB = (shares * (await dex.reserveB())) / (await dex.totalShares());

      await expect(dex.connect(owner).removeLiquidity(shares))
        .to.emit(dex, "LiquidityRemoved")
        .withArgs(owner.address, shares);

      expect(await dex.reserveA()).to.equal(0n);
      expect(await dex.reserveB()).to.equal(0n);
      expect(await dex.totalShares()).to.equal(0n);
      expect(await dex.shares(owner.address)).to.equal(0n);

      // Check user received tokens
      expect(await tokenA.balanceOf(owner.address)).to.equal(INITIAL_AMOUNT + expectedAmountA);
      expect(await tokenB.balanceOf(owner.address)).to.equal(INITIAL_AMOUNT + expectedAmountB);
    });

    it("Should revert when removing more shares than owned", async function () {
      const shares = await dex.shares(owner.address);
      await expect(dex.connect(owner).removeLiquidity(shares + 1n))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("swapAforB", function () {
    beforeEach(async function () {
      await dex.connect(owner).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("Should swap tokenA for tokenB correctly", async function () {
      const amountIn = ethers.parseEther("10");
      const reserveA = await dex.reserveA();
      const reserveB = await dex.reserveB();
      const amountInWithFee = amountIn * 997n;
      const expectedAmountOut = (amountInWithFee * reserveB) / (reserveA * 1000n + amountInWithFee);

      await expect(dex.connect(user1).swapAforB(amountIn))
        .to.emit(dex, "Swapped")
        .withArgs(user1.address, await tokenA.getAddress(), amountIn, expectedAmountOut);

      // Check reserves
      expect(await dex.reserveA()).to.equal(reserveA + amountIn);
      expect(await dex.reserveB()).to.equal(reserveB - expectedAmountOut);

      // Check user balances
      expect(await tokenA.balanceOf(user1.address)).to.equal(INITIAL_AMOUNT - amountIn);
      expect(await tokenB.balanceOf(user1.address)).to.equal(INITIAL_AMOUNT + expectedAmountOut);
    });

    it("Should revert when swapping zero amount", async function () {
      await expect(dex.connect(user1).swapAforB(0))
        .to.be.reverted;
    });

    it("Should revert when swapping more than available", async function () {
      await expect(dex.connect(user1).swapAforB(ethers.parseEther("1000")))
        .to.be.reverted;
    });
  });

  describe("swapBforA", function () {
    beforeEach(async function () {
      await dex.connect(owner).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("Should swap tokenB for tokenA correctly", async function () {
      const amountIn = ethers.parseEther("10");
      const reserveA = await dex.reserveA();
      const reserveB = await dex.reserveB();
      const amountInWithFee = amountIn * 997n;
      const expectedAmountOut = (amountInWithFee * reserveA) / (reserveB * 1000n + amountInWithFee);

      await expect(dex.connect(user1).swapBforA(amountIn))
        .to.emit(dex, "Swapped")
        .withArgs(user1.address, await tokenB.getAddress(), amountIn, expectedAmountOut);

      // Check reserves
      expect(await dex.reserveA()).to.equal(reserveA - expectedAmountOut);
      expect(await dex.reserveB()).to.equal(reserveB + amountIn);

      // Check user balances
      expect(await tokenA.balanceOf(user1.address)).to.equal(INITIAL_AMOUNT + expectedAmountOut);
      expect(await tokenB.balanceOf(user1.address)).to.equal(INITIAL_AMOUNT - amountIn);
    });

    it("Should revert when swapping zero amount", async function () {
      await expect(dex.connect(user1).swapBforA(0))
        .to.be.reverted;
    });

    it("Should revert when swapping more than available", async function () {
      await expect(dex.connect(user1).swapBforA(ethers.parseEther("1000")))
        .to.be.reverted;
    });
  });
});