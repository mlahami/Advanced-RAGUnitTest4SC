const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function () {
  let dex, tokenA, tokenB, owner, user1, user2;
  const initialSupply = ethers.parseEther("1000000");

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy tokens
    const TokenFactory = await ethers.getContractFactory("BenchmarkERC20");
    tokenA = await TokenFactory.deploy("Token A", "TKA");
    await tokenA.waitForDeployment();
    tokenB = await TokenFactory.deploy("Token B", "TKB");
    await tokenB.waitForDeployment();

    // Mint initial supply to users
    await tokenA.mint(user1.address, initialSupply);
    await tokenB.mint(user1.address, initialSupply);
    await tokenA.mint(user2.address, initialSupply);
    await tokenB.mint(user2.address, initialSupply);

    // Approve DEX to spend tokens
    await tokenA.connect(user1).approve(await tokenA.getAddress(), ethers.MaxUint256);
    await tokenB.connect(user1).approve(await tokenB.getAddress(), ethers.MaxUint256);
    await tokenA.connect(user2).approve(await tokenA.getAddress(), ethers.MaxUint256);
    await tokenB.connect(user2).approve(await tokenB.getAddress(), ethers.MaxUint256);

    // Deploy DEX
    const DEXFactory = await ethers.getContractFactory("DEX");
    dex = await DEXFactory.deploy(await tokenA.getAddress(), await tokenB.getAddress());
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
        .withArgs(user1.address, ethers.parseEther("10000"));

      expect(await dex.reserveA()).to.equal(amountA);
      expect(await dex.reserveB()).to.equal(amountB);
      expect(await dex.totalShares()).to.equal(ethers.parseEther("10000"));
      expect(await dex.shares(user1.address)).to.equal(ethers.parseEther("10000"));
    });

    it("Should add subsequent liquidity", async function () {
      // Initial liquidity
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));

      // Add more liquidity
      const amountA = ethers.parseEther("50");
      const amountB = ethers.parseEther("50");

      await expect(dex.connect(user1).addLiquidity(amountA, amountB))
        .to.emit(dex, "LiquidityAdded")
        .withArgs(user1.address, ethers.parseEther("5000"));

      expect(await dex.reserveA()).to.equal(ethers.parseEther("150"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("150"));
      expect(await dex.totalShares()).to.equal(ethers.parseEther("15000"));
      expect(await dex.shares(user1.address)).to.equal(ethers.parseEther("15000"));
    });

    it("Should revert when adding insufficient liquidity", async function () {
      // Initial liquidity
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));

      // Try to add liquidity with mismatched amounts
      await expect(dex.connect(user1).addLiquidity(ethers.parseEther("10"), ethers.parseEther("20")))
        .to.be.revertedWith("Insufficient liquidity minted");
    });
  });

  describe("removeLiquidity", function () {
    beforeEach(async function () {
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("Should remove liquidity", async function () {
      const shares = ethers.parseEther("5000");

      await expect(dex.connect(user1).removeLiquidity(shares))
        .to.emit(dex, "LiquidityRemoved")
        .withArgs(user1.address, shares);

      expect(await dex.reserveA()).to.equal(ethers.parseEther("50"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("50"));
      expect(await dex.totalShares()).to.equal(ethers.parseEther("5000"));
      expect(await dex.shares(user1.address)).to.equal(ethers.parseEther("5000"));
    });

    it("Should revert when removing more shares than owned", async function () {
      const shares = ethers.parseEther("10001");

      await expect(dex.connect(user1).removeLiquidity(shares))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("swapAforB", function () {
    beforeEach(async function () {
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("Should swap tokenA for tokenB", async function () {
      const amountIn = ethers.parseEther("10");
      const expectedOut = ethers.parseEther("9.0702704726375896");

      await expect(dex.connect(user1).swapAforB(amountIn))
        .to.emit(dex, "Swapped")
        .withArgs(user1.address, await tokenA.getAddress(), amountIn, expectedOut);

      expect(await dex.reserveA()).to.equal(ethers.parseEther("110"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("90.92972952736241"));
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
      const expectedOut = ethers.parseEther("9.0702704726375896");

      await expect(dex.connect(user1).swapBforA(amountIn))
        .to.emit(dex, "Swapped")
        .withArgs(user1.address, await tokenB.getAddress(), amountIn, expectedOut);

      expect(await dex.reserveB()).to.equal(ethers.parseEther("110"));
      expect(await dex.reserveA()).to.equal(ethers.parseEther("90.92972952736241"));
    });

    it("Should revert when swapping zero amount", async function () {
      await expect(dex.connect(user1).swapBforA(0n))
        .to.be.reverted;
    });
  });

  describe("State consistency", function () {
    it("Should maintain correct reserves after multiple operations", async function () {
      // Add initial liquidity
      await dex.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));

      // Swap A for B
      await dex.connect(user1).swapAforB(ethers.parseEther("10"));

      // Swap B for A
      await dex.connect(user1).swapBforA(ethers.parseEther("10"));

      // Remove liquidity
      await dex.connect(user1).removeLiquidity(ethers.parseEther("5000"));

      // Check final state
      expect(await dex.reserveA()).to.equal(ethers.parseEther("95.92972952736241"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("95.92972952736241"));
      expect(await dex.totalShares()).to.equal(ethers.parseEther("5000"));
    });
  });
});