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

    // Deploy token fixtures
    const TokenFactory = await ethers.getContractFactory("BenchmarkERC20");
    tokenA = await TokenFactory.deploy("Token A", "TKA");
    tokenB = await TokenFactory.deploy("Token B", "TKB");

    // Mint tokens to users
    await tokenA.mint(owner.address, ethers.parseEther("1000000"));
    await tokenB.mint(owner.address, ethers.parseEther("1000000"));
    await tokenA.mint(user1.address, ethers.parseEther("1000000"));
    await tokenB.mint(user2.address, ethers.parseEther("1000000"));

    // Approve DEX to spend tokens
    await tokenA.connect(owner).approve(owner.address, ethers.MaxUint256);
    await tokenB.connect(owner).approve(owner.address, ethers.MaxUint256);
    await tokenA.connect(user1).approve(owner.address, ethers.MaxUint256);
    await tokenB.connect(user2).approve(owner.address, ethers.MaxUint256);

    // Deploy DEX
    const DEXFactory = await ethers.getContractFactory("DEX");
    dex = await DEXFactory.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    await dex.waitForDeployment();

    // Add initial liquidity
    await tokenA.connect(owner).approve(await dex.getAddress(), ethers.parseEther("100000"));
    await tokenB.connect(owner).approve(await dex.getAddress(), ethers.parseEther("100000"));
    await dex.connect(owner).addLiquidity(ethers.parseEther("100000"), ethers.parseEther("100000"));
  });

  describe("Deployment", function () {
    it("should set the correct token addresses", async function () {
      expect(await dex.tokenA()).to.equal(await tokenA.getAddress());
      expect(await dex.tokenB()).to.equal(await tokenB.getAddress());
    });

    it("should initialize reserves to zero", async function () {
      expect(await dex.reserveA()).to.equal(0);
      expect(await dex.reserveB()).to.equal(0);
    });
  });

  describe("addLiquidity", function () {
    it("should add initial liquidity correctly", async function () {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("1000");

      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);

      const tx = await dex.connect(user1).addLiquidity(amountA, amountB);
      const receipt = await tx.wait();

      // Check event emission
      const event = receipt.logs.find(log => log.fragment.name === "LiquidityAdded");
      expect(event.args.provider).to.equal(user1.address);
      expect(event.args.sharesIssued).to.be.gt(0);

      // Check state changes
      expect(await dex.reserveA()).to.equal(ethers.parseEther("101000"));
      expect(await dex.reserveB()).to.equal(ethers.parseEther("101000"));
      expect(await dex.shares(user1.address)).to.equal(event.args.sharesIssued);
      expect(await dex.totalShares()).to.equal(event.args.sharesIssued);
    });

    it("should add subsequent liquidity proportionally", async function () {
      const initialAmount = ethers.parseEther("1000");
      await tokenA.connect(user1).approve(await dex.getAddress(), initialAmount);
      await tokenB.connect(user1).approve(await dex.getAddress(), initialAmount);
      await dex.connect(user1).addLiquidity(initialAmount, initialAmount);

      const initialShares = await dex.shares(user1.address);

      const additionalAmount = ethers.parseEther("500");
      await tokenA.connect(user1).approve(await dex.getAddress(), additionalAmount);
      await tokenB.connect(user1).approve(await dex.getAddress(), additionalAmount);
      await dex.connect(user1).addLiquidity(additionalAmount, additionalAmount);

      const newShares = await dex.shares(user1.address);
      expect(newShares).to.be.closeTo(initialShares + (initialShares / 2n), ethers.parseEther("1"));
    });

    it("should revert when adding zero liquidity", async function () {
      await expect(dex.connect(user1).addLiquidity(0, ethers.parseEther("100")))
        .to.be.revertedWith("Insufficient liquidity minted");
    });

    it("should revert when adding liquidity with zero amount", async function () {
      await expect(dex.connect(user1).addLiquidity(0, 0))
        .to.be.revertedWith("Insufficient liquidity minted");
    });
  });

  describe("removeLiquidity", function () {
    beforeEach(async function () {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("1000");
      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);
      await dex.connect(user1).addLiquidity(amountA, amountB);
    });

    it("should remove liquidity correctly", async function () {
      const shares = await dex.shares(user1.address);
      const reserveA = await dex.reserveA();
      const reserveB = await dex.reserveB();
      const totalShares = await dex.totalShares();

      const tx = await dex.connect(user1).removeLiquidity(shares);
      const receipt = await tx.wait();

      // Check event emission
      const event = receipt.logs.find(log => log.fragment.name === "LiquidityRemoved");
      expect(event.args.provider).to.equal(user1.address);
      expect(event.args.sharesBurned).to.equal(shares);

      // Check state changes
      expect(await dex.reserveA()).to.equal(reserveA - (shares * reserveA / totalShares));
      expect(await dex.reserveB()).to.equal(reserveB - (shares * reserveB / totalShares));
      expect(await dex.shares(user1.address)).to.equal(0);
      expect(await dex.totalShares()).to.equal(0);
    });

    it("should revert when removing more shares than owned", async function () {
      const shares = await dex.shares(user1.address);
      await expect(dex.connect(user1).removeLiquidity(shares + 1n))
        .to.be.revertedWith("Insufficient shares");
    });

    it("should revert when removing zero shares", async function () {
      await expect(dex.connect(user1).removeLiquidity(0))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("swapAforB", function () {
    it("should swap tokenA for tokenB correctly", async function () {
      const amountIn = ethers.parseEther("100");
      await tokenA.connect(user1).approve(await dex.getAddress(), amountIn);

      const reserveA = await dex.reserveA();
      const reserveB = await dex.reserveB();

      const tx = await dex.connect(user1).swapAforB(amountIn);
      const receipt = await tx.wait();

      // Check event emission
      const event = receipt.logs.find(log => log.fragment.name === "Swapped");
      expect(event.args.user).to.equal(user1.address);
      expect(event.args.tokenIn).to.equal(await tokenA.getAddress());
      expect(event.args.amountIn).to.equal(amountIn);
      expect(event.args.amountOut).to.be.gt(0);

      // Check state changes
      expect(await dex.reserveA()).to.equal(reserveA + amountIn);
      expect(await dex.reserveB()).to.equal(reserveB - event.args.amountOut);
    });

    it("should revert when swapping zero amount", async function () {
      await expect(dex.connect(user1).swapAforB(0))
        .to.be.reverted;
    });

    it("should revert when swapping more than available", async function () {
      const amountIn = ethers.parseEther("1000000");
      await tokenA.connect(user1).approve(await dex.getAddress(), amountIn);
      await expect(dex.connect(user1).swapAforB(amountIn))
        .to.be.reverted;
    });
  });

  describe("swapBforA", function () {
    it("should swap tokenB for tokenA correctly", async function () {
      const amountIn = ethers.parseEther("100");
      await tokenB.connect(user2).approve(await dex.getAddress(), amountIn);

      const reserveA = await dex.reserveA();
      const reserveB = await dex.reserveB();

      const tx = await dex.connect(user2).swapBforA(amountIn);
      const receipt = await tx.wait();

      // Check event emission
      const event = receipt.logs.find(log => log.fragment.name === "Swapped");
      expect(event.args.user).to.equal(user2.address);
      expect(event.args.tokenIn).to.equal(await tokenB.getAddress());
      expect(event.args.amountIn).to.equal(amountIn);
      expect(event.args.amountOut).to.be.gt(0);

      // Check state changes
      expect(await dex.reserveB()).to.equal(reserveB + amountIn);
      expect(await dex.reserveA()).to.equal(reserveA - event.args.amountOut);
    });

    it("should revert when swapping zero amount", async function () {
      await expect(dex.connect(user2).swapBforA(0))
        .to.be.reverted;
    });

    it("should revert when swapping more than available", async function () {
      const amountIn = ethers.parseEther("1000000");
      await tokenB.connect(user2).approve(await dex.getAddress(), amountIn);
      await expect(dex.connect(user2).swapBforA(amountIn))
        .to.be.reverted;
    });
  });

  describe("Edge Cases", function () {
    it("should handle large swap amounts", async function () {
      const amountIn = ethers.parseEther("10000");
      await tokenA.connect(user1).approve(await dex.getAddress(), amountIn);

      const tx = await dex.connect(user1).swapAforB(amountIn);
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => log.fragment.name === "Swapped");
      expect(event.args.amountOut).to.be.gt(0);
    });

    it("should maintain correct reserve ratios after multiple swaps", async function () {
      // First swap
      const amountIn1 = ethers.parseEther("100");
      await tokenA.connect(user1).approve(await dex.getAddress(), amountIn1);
      await dex.connect(user1).swapAforB(amountIn1);

      // Second swap
      const amountIn2 = ethers.parseEther("200");
      await tokenB.connect(user2).approve(await dex.getAddress(), amountIn2);
      await dex.connect(user2).swapBforA(amountIn2);

      // Check reserve ratios
      const reserveA = await dex.reserveA();
      const reserveB = await dex.reserveB();
      const ratio = reserveA * 10000n / reserveB;
      expect(ratio).to.be.closeTo(10000n, 100n); // Allow small deviation due to fees
    });
  });
});