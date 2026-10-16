const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX Contract", function () {
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
    it("Should add liquidity and emit LiquidityAdded event", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("200");

      // Approve DEX to spend tokens
      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);

      const tx = await dex.connect(user1).addLiquidity(amountA, amountB);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs
        .map(log => {
          try {
            return dex.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find(e => e && e.name === "LiquidityAdded");

      expect(event).to.not.be.undefined;
      expect(event.args.provider).to.equal(user1.address);
      expect(event.args.sharesIssued).to.be.gt(0n);

      // Check state
      expect(await dex.reserveA()).to.equal(amountA);
      expect(await dex.reserveB()).to.equal(amountB);
      expect(await dex.totalShares()).to.equal(event.args.sharesIssued);
      expect(await dex.shares(user1.address)).to.equal(event.args.sharesIssued);
    });

    it("Should remove liquidity and emit LiquidityRemoved event", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("200");

      // Add liquidity first
      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);
      await dex.connect(user1).addLiquidity(amountA, amountB);

      const shares = await dex.shares(user1.address);
      const tx = await dex.connect(user1).removeLiquidity(shares);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs
        .map(log => {
          try {
            return dex.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find(e => e && e.name === "LiquidityRemoved");

      expect(event).to.not.be.undefined;
      expect(event.args.provider).to.equal(user1.address);
      expect(event.args.sharesBurned).to.equal(shares);

      // Check state
      expect(await dex.reserveA()).to.equal(0n);
      expect(await dex.reserveB()).to.equal(0n);
      expect(await dex.totalShares()).to.equal(0n);
      expect(await dex.shares(user1.address)).to.equal(0n);
    });

    it("Should revert when removing more liquidity than available", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("200");

      // Add liquidity first
      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);
      await dex.connect(user1).addLiquidity(amountA, amountB);

      const shares = await dex.shares(user1.address);
      await expect(dex.connect(user1).removeLiquidity(shares + 1n))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("Swap Functionality", function () {
    beforeEach(async function () {
      // Add initial liquidity
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("200");

      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);
      await dex.connect(user1).addLiquidity(amountA, amountB);
    });

    it("Should swap tokenA for tokenB and emit Swapped event", async function () {
      const amountIn = ethers.parseEther("10");
      const initialBalance = await tokenB.balanceOf(user2.address);

      // Approve DEX to spend tokenA
      await tokenA.connect(user2).approve(await dex.getAddress(), amountIn);

      const tx = await dex.connect(user2).swapAforB(amountIn);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs
        .map(log => {
          try {
            return dex.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find(e => e && e.name === "Swapped");

      expect(event).to.not.be.undefined;
      expect(event.args.user).to.equal(user2.address);
      expect(event.args.tokenIn).to.equal(await tokenA.getAddress());
      expect(event.args.amountIn).to.equal(amountIn);
      expect(event.args.amountOut).to.be.gt(0n);

      // Check state
      expect(await tokenB.balanceOf(user2.address)).to.be.gt(initialBalance);
      expect(await dex.reserveA()).to.equal(ethers.parseEther("110"));
      expect(await dex.reserveB()).to.be.lt(ethers.parseEther("200"));
    });

    it("Should swap tokenB for tokenA and emit Swapped event", async function () {
      const amountIn = ethers.parseEther("10");
      const initialBalance = await tokenA.balanceOf(user2.address);

      // Approve DEX to spend tokenB
      await tokenB.connect(user2).approve(await dex.getAddress(), amountIn);

      const tx = await dex.connect(user2).swapBforA(amountIn);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs
        .map(log => {
          try {
            return dex.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find(e => e && e.name === "Swapped");

      expect(event).to.not.be.undefined;
      expect(event.args.user).to.equal(user2.address);
      expect(event.args.tokenIn).to.equal(await tokenB.getAddress());
      expect(event.args.amountIn).to.equal(amountIn);
      expect(event.args.amountOut).to.be.gt(0n);

      // Check state
      expect(await tokenA.balanceOf(user2.address)).to.be.gt(initialBalance);
      expect(await dex.reserveB()).to.equal(ethers.parseEther("210"));
      expect(await dex.reserveA()).to.be.lt(ethers.parseEther("100"));
    });

    it("Should revert when swapping with zero amount", async function () {
      await expect(dex.connect(user2).swapAforB(0n))
        .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle initial liquidity addition correctly", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("200");

      await tokenA.connect(user1).approve(await dex.getAddress(), amountA);
      await tokenB.connect(user1).approve(await dex.getAddress(), amountB);

      const tx = await dex.connect(user1).addLiquidity(amountA, amountB);
      const receipt = await tx.wait();

      const event = receipt.logs
        .map(log => {
          try {
            return dex.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find(e => e && e.name === "LiquidityAdded");

      // For initial liquidity, shares should be sqrt(amountA * amountB)
      const expectedShares = BigInt(Math.sqrt(Number(amountA) * Number(amountB)));
      expect(event.args.sharesIssued).to.equal(expectedShares);
    });

    it("Should revert when adding liquidity with zero amounts", async function () {
      await expect(dex.connect(user1).addLiquidity(0n, 0n))
        .to.be.revertedWith("Insufficient liquidity minted");
    });
  });
});