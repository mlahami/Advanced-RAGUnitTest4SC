const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DexPool Contract", function () {
  let Token, tokenA, tokenB, DexPool, dexPool;
  let owner, addr1, addr2;

  beforeEach(async function () {
    // Get signers
    [owner, addr1, addr2] = await ethers.getSigners();

    // Deploy two mock tokens
    Token = await ethers.getContractFactory("Token");
    tokenA = await Token.deploy("Token A", "TKA");
    tokenB = await Token.deploy("Token B", "TKB");

    // Deploy liquidity pool
    DexPool = await ethers.getContractFactory("DexPool");
    dexPool = await DexPool.deploy(tokenA.target, tokenB.target);

    // Distribute tokens to addr1 and addr2
    await tokenA.transfer(addr1.address, ethers.parseEther("10000"));
    await tokenB.transfer(addr1.address, ethers.parseEther("10000"));
    await tokenA.transfer(addr2.address, ethers.parseEther("10000"));
    await tokenB.transfer(addr2.address, ethers.parseEther("10000"));
  });

  describe("Initialization", function () {
    it("Should set correct token addresses", async function () {
      expect(await dexPool.tokenA()).to.equal(tokenA.target);
      expect(await dexPool.tokenB()).to.equal(tokenB.target);
    });

    it("Should start with 0 reserves", async function () {
      const [reserveA, reserveB] = await dexPool.getReserves();
      expect(reserveA).to.equal(0);
      expect(reserveB).to.equal(0);
    });
  });

  describe("Liquidity Operations", function () {
    it("Should allow initial liquidity addition", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("400");

      // Approve pool to spend tokens
      await tokenA.connect(addr1).approve(dexPool.target, amountA);
      await tokenB.connect(addr1).approve(dexPool.target, amountB);

      // Add liquidity
      await expect(dexPool.connect(addr1).addLiquidity(amountA, amountB))
        .to.emit(dexPool, "LiquidityAdded")
        .withArgs(addr1.address, amountA, amountB, ethers.parseEther("200")); // sqrt(100 * 400) = 200

      // Check reserves and LP token balances
      const [reserveA, reserveB] = await dexPool.getReserves();
      expect(reserveA).to.equal(amountA);
      expect(reserveB).to.equal(amountB);
      expect(await dexPool.balanceOf(addr1.address)).to.equal(ethers.parseEther("200"));
    });

    it("Should mint proportional LP tokens for subsequent deposits", async function () {
      // 1. Initial liquidity (100 TKA, 400 TKB) => 200 LP tokens
      await tokenA.connect(addr1).approve(dexPool.target, ethers.parseEther("100"));
      await tokenB.connect(addr1).approve(dexPool.target, ethers.parseEther("400"));
      await dexPool.connect(addr1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("400"));

      // 2. Add second round (50 TKA, 200 TKB)
      // Since it perfectly matches ratio (50/100 == 200/400), should mint (50/100) * 200 = 100 LP tokens
      await tokenA.connect(addr2).approve(dexPool.target, ethers.parseEther("50"));
      await tokenB.connect(addr2).approve(dexPool.target, ethers.parseEther("200"));

      await expect(dexPool.connect(addr2).addLiquidity(ethers.parseEther("50"), ethers.parseEther("200")))
        .to.emit(dexPool, "LiquidityAdded")
        .withArgs(addr2.address, ethers.parseEther("50"), ethers.parseEther("200"), ethers.parseEther("100"));

      expect(await dexPool.balanceOf(addr2.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should allow removing liquidity and return proportional reserves", async function () {
      // Add initial liquidity
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("400");
      await tokenA.connect(addr1).approve(dexPool.target, amountA);
      await tokenB.connect(addr1).approve(dexPool.target, amountB);
      await dexPool.connect(addr1).addLiquidity(amountA, amountB);

      // Verify balance before removing
      const balA_before = await tokenA.balanceOf(addr1.address);
      const balB_before = await tokenB.balanceOf(addr1.address);

      // Remove half of the liquidity (100 LP tokens)
      const lpTokensToBurn = ethers.parseEther("100");
      await dexPool.connect(addr1).approve(dexPool.target, lpTokensToBurn);
      
      await expect(dexPool.connect(addr1).removeLiquidity(lpTokensToBurn))
        .to.emit(dexPool, "LiquidityRemoved")
        .withArgs(addr1.address, ethers.parseEther("50"), ethers.parseEther("200"), lpTokensToBurn);

      // Verify returns and reserve updates
      expect(await tokenA.balanceOf(addr1.address)).to.equal(balA_before + ethers.parseEther("50"));
      expect(await tokenB.balanceOf(addr1.address)).to.equal(balB_before + ethers.parseEther("200"));

      const [reserveA, reserveB] = await dexPool.getReserves();
      expect(reserveA).to.equal(ethers.parseEther("50"));
      expect(reserveB).to.equal(ethers.parseEther("200"));
    });
  });

  describe("Swap Logic (AMM)", function () {
    beforeEach(async function () {
      // Seed pool with 100 TKA and 100 TKB
      const initA = ethers.parseEther("100");
      const initB = ethers.parseEther("100");
      await tokenA.connect(addr1).approve(dexPool.target, initA);
      await tokenB.connect(addr1).approve(dexPool.target, initB);
      await dexPool.connect(addr1).addLiquidity(initA, initB);
    });

    it("Should calculate correct output amount including 0.3% fee", async function () {
      // Selling 10 TKA.
      // x * y = k => (100) * (100) = 10000.
      // input = 10. Effective input with fee = 10 * 0.997 = 9.97 TKA.
      // reserveIn = 100. reserveOut = 100.
      // output = (9.97 * 100) / (100 + 9.97) = 997 / 109.97 = 9.0661089...
      const amountIn = ethers.parseEther("10");
      
      // Calculate output using contract pure method
      const expectedOut = await dexPool.getAmountOut(amountIn, ethers.parseEther("100"), ethers.parseEther("100"));
      expect(expectedOut).to.be.closeTo(ethers.parseEther("9.066"), ethers.parseEther("0.001"));
    });

    it("Should swap Token A for B and update reserves correctly", async function () {
      const amountIn = ethers.parseEther("10");
      const expectedOut = await dexPool.getAmountOut(amountIn, ethers.parseEther("100"), ethers.parseEther("100"));

      await tokenA.connect(addr2).approve(dexPool.target, amountIn);

      const balB_before = await tokenB.balanceOf(addr2.address);

      await expect(dexPool.connect(addr2).swap(tokenA.target, amountIn))
        .to.emit(dexPool, "Swap")
        .withArgs(addr2.address, tokenA.target, amountIn, expectedOut);

      // Verify token balances and reserves
      expect(await tokenB.balanceOf(addr2.address)).to.equal(balB_before + expectedOut);
      
      const [reserveA, reserveB] = await dexPool.getReserves();
      expect(reserveA).to.equal(ethers.parseEther("110")); // reserveA increases by 10
      expect(reserveB).to.equal(ethers.parseEther("100") - expectedOut); // reserveB decreases by output
    });

    it("Should swap Token B for A and update reserves correctly", async function () {
      const amountIn = ethers.parseEther("20");
      const expectedOut = await dexPool.getAmountOut(amountIn, ethers.parseEther("100"), ethers.parseEther("100"));

      await tokenB.connect(addr2).approve(dexPool.target, amountIn);

      const balA_before = await tokenA.balanceOf(addr2.address);

      await expect(dexPool.connect(addr2).swap(tokenB.target, amountIn))
        .to.emit(dexPool, "Swap")
        .withArgs(addr2.address, tokenB.target, amountIn, expectedOut);

      // Verify token balances and reserves
      expect(await tokenA.balanceOf(addr2.address)).to.equal(balA_before + expectedOut);
      
      const [reserveA, reserveB] = await dexPool.getReserves();
      expect(reserveA).to.equal(ethers.parseEther("100") - expectedOut);
      expect(reserveB).to.equal(ethers.parseEther("120"));
    });

    it("Should reject swaps with 0 input amount", async function () {
      await expect(dexPool.connect(addr2).swap(tokenA.target, 0))
        .to.be.revertedWith("Input amount must be greater than zero");
    });

    it("Should reject swaps of unsupported tokens", async function () {
      const someRandomAddress = addr1.address;
      await expect(dexPool.connect(addr2).swap(someRandomAddress, ethers.parseEther("10")))
        .to.be.revertedWith("Invalid input token");
    });
  });
});
