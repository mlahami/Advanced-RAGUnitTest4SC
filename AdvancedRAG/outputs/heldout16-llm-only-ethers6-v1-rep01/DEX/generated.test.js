const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function () {
  let dex, tokenA, tokenB, owner, user1, user2;
  const initialSupply = ethers.parseEther("1000000");

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy tokens
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    tokenA = await Token.deploy("Token A", "TKA");
    await tokenA.waitForDeployment();
    tokenB = await Token.deploy("Token B", "TKB");
    await tokenB.waitForDeployment();

    // Mint tokens to users
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
    const DEX = await ethers.getContractFactory("DEX");
    dex = await DEX.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    await dex.waitForDeployment();
  });

  describe("Initialization", function () {
    it("Should set the correct token addresses", async function () {
      expect(await dex.tokenA()).to.equal(await tokenA.getAddress());
      expect(await dex.tokenB()).to.equal(await tokenB.getAddress());
    });

    it("Should have zero reserves initially", async function () {
      expect(await dex.reserveA()).to.equal(0n);
      expect(await dex.reserveB()).to.equal(0n);
    });
  });

  describe("addLiquidity", function () {
    it("Should add liquidity and mint shares", async function () {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("1000");

      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);

      const tx = await dex.connect(user1).addLiquidity(amountA, amountB);
      const receipt = await tx.wait();

      expect(await dex.reserveA()).to.equal(amountA);
      expect(await dex.reserveB()).to.equal(amountB);
      expect(await dex.totalShares()).to.be.gt(0n);
      expect(await dex.shares(user1.address)).to.be.gt(0n);

      // Check event
      const event = receipt.logs.find(log => log.fragment.name === "LiquidityAdded");
      expect(event.args.provider).to.equal(user1.address);
      expect(event.args.sharesIssued).to.be.gt(0n);
    });

    it("Should revert when adding zero liquidity", async function () {
      await expect(dex.connect(user1).addLiquidity(0n, 0n))
        .to.be.revertedWith("Insufficient liquidity minted");
    });

    it("Should revert when adding unequal amounts initially", async function () {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("2000");

      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);

      await expect(dex.connect(user1).addLiquidity(amountA, amountB))
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

    it("Should remove liquidity and burn shares", async function () {
      const shares = await dex.shares(user1.address);
      const initialReserveA = await dex.reserveA();
      const initialReserveB = await dex.reserveB();

      const tx = await dex.connect(user1).removeLiquidity(shares);
      const receipt = await tx.wait();

      expect(await dex.reserveA()).to.be.lt(initialReserveA);
      expect(await dex.reserveB()).to.be.lt(initialReserveB);
      expect(await dex.totalShares()).to.equal(0n);
      expect(await dex.shares(user1.address)).to.equal(0n);

      // Check event
      const event = receipt.logs.find(log => log.fragment.name === "LiquidityRemoved");
      expect(event.args.provider).to.equal(user1.address);
      expect(event.args.sharesBurned).to.equal(shares);
    });

    it("Should revert when removing more shares than owned", async function () {
      const shares = await dex.shares(user1.address);
      await expect(dex.connect(user1).removeLiquidity(shares + 1n))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("swapAforB", function () {
    beforeEach(async function () {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("1000");

      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);
      await dex.connect(user1).addLiquidity(amountA, amountB);
    });

    it("Should swap tokenA for tokenB", async function () {
      const amountIn = ethers.parseEther("100");
      const initialReserveA = await dex.reserveA();
      const initialReserveB = await dex.reserveB();

      await tokenA.connect(user2).approve(await dex.getAddress(), amountIn);
      const tx = await dex.connect(user2).swapAforB(amountIn);
      const receipt = await tx.wait();

      expect(await dex.reserveA()).to.equal(initialReserveA + amountIn);
      expect(await dex.reserveB()).to.be.lt(initialReserveB);
      expect(await tokenB.balanceOf(user2.address)).to.be.gt(ethers.parseEther("99"));

      // Check event
      const event = receipt.logs.find(log => log.fragment.name === "Swapped");
      expect(event.args.user).to.equal(user2.address);
      expect(event.args.tokenIn).to.equal(await tokenA.getAddress());
      expect(event.args.amountIn).to.equal(amountIn);
      expect(event.args.amountOut).to.be.gt(0n);
    });

    it("Should revert when swapping zero amount", async function () {
      await expect(dex.connect(user2).swapAforB(0n))
        .to.be.revertedWith("insufficient allowance");
    });
  });

  describe("swapBforA", function () {
    beforeEach(async function () {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("1000");

      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);
      await dex.connect(user1).addLiquidity(amountA, amountB);
    });

    it("Should swap tokenB for tokenA", async function () {
      const amountIn = ethers.parseEther("100");
      const initialReserveA = await dex.reserveA();
      const initialReserveB = await dex.reserveB();

      await tokenB.connect(user2).approve(await dex.getAddress(), amountIn);
      const tx = await dex.connect(user2).swapBforA(amountIn);
      const receipt = await tx.wait();

      expect(await dex.reserveB()).to.equal(initialReserveB + amountIn);
      expect(await dex.reserveA()).to.be.lt(initialReserveA);
      expect(await tokenA.balanceOf(user2.address)).to.be.gt(ethers.parseEther("99"));

      // Check event
      const event = receipt.logs.find(log => log.fragment.name === "Swapped");
      expect(event.args.user).to.equal(user2.address);
      expect(event.args.tokenIn).to.equal(await tokenB.getAddress());
      expect(event.args.amountIn).to.equal(amountIn);
      expect(event.args.amountOut).to.be.gt(0n);
    });

    it("Should revert when swapping zero amount", async function () {
      await expect(dex.connect(user2).swapBforA(0n))
        .to.be.revertedWith("insufficient allowance");
    });
  });
});