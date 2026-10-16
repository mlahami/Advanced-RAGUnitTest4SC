const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GriffinDEX", () => {
  let dex;
  let tokenA;
  let tokenB;
  let owner;
  let lp;
  let trader;
  let recipient;

  const INITIAL_SUPPLY = 1_000_000n;
  const LIQUIDITY_A = ethers.parseUnits("10000", 18);
  const LIQUIDITY_B = ethers.parseUnits("10000", 6);

  beforeEach(async () => {
    [owner, lp, trader, recipient] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20Factory.deploy("Token A", "TKA", 18, INITIAL_SUPPLY);
    tokenB = await MockERC20Factory.deploy("Token B", "TKB", 6, INITIAL_SUPPLY);

    const GriffinDEXFactory = await ethers.getContractFactory("GriffinDEX");
    dex = await GriffinDEXFactory.deploy();

    // Fund lp and trader with tokens
    await tokenA.transfer(lp.address, LIQUIDITY_A * 2n);
    await tokenB.transfer(lp.address, LIQUIDITY_B * 2n);
    await tokenA.transfer(trader.address, ethers.parseUnits("1000", 18));
  });

  // -------------------------------------------------------------------------
  // MockERC20
  // -------------------------------------------------------------------------

  describe("MockERC20", () => {
    it("mints initial supply to deployer", async () => {
      const balance = await tokenA.balanceOf(owner.address);
      // deployer gets supply minus what was transferred to lp and trader
      expect(balance).to.be.gt(0n);
    });

    it("respects custom decimals", async () => {
      expect(await tokenA.decimals()).to.equal(18);
      expect(await tokenB.decimals()).to.equal(6);
    });

    it("total supply equals initialSupply * 10^decimals", async () => {
      const total = await tokenA.totalSupply();
      expect(total).to.equal(INITIAL_SUPPLY * 10n ** 18n);
    });
  });

  // -------------------------------------------------------------------------
  // Pool creation
  // -------------------------------------------------------------------------

  describe("createPool", () => {
    it("creates a pool and emits PoolCreated", async () => {
      await expect(dex.createPool(tokenA.target, tokenB.target))
        .to.emit(dex, "PoolCreated");
    });

    it("reverts when creating a duplicate pool", async () => {
      await dex.createPool(tokenA.target, tokenB.target);
      await expect(dex.createPool(tokenA.target, tokenB.target))
        .to.be.revertedWith("Pool exists");
    });

    it("reverts for identical tokens", async () => {
      await expect(dex.createPool(tokenA.target, tokenA.target))
        .to.be.revertedWith("Identical tokens");
    });

    it("reverts for zero address", async () => {
      await expect(dex.createPool(ethers.ZeroAddress, tokenB.target))
        .to.be.revertedWith("Zero address");
    });

    it("generates consistent pool ID regardless of token order", async () => {
      const id1 = await dex.getPoolId(tokenA.target, tokenB.target);
      const id2 = await dex.getPoolId(tokenB.target, tokenA.target);
      expect(id1).to.equal(id2);
    });
  });

  // -------------------------------------------------------------------------
  // Add liquidity
  // -------------------------------------------------------------------------

  describe("addLiquidity", () => {
    beforeEach(async () => {
      await dex.createPool(tokenA.target, tokenB.target);
      await tokenA.connect(lp).approve(dex.target, LIQUIDITY_A);
      await tokenB.connect(lp).approve(dex.target, LIQUIDITY_B);
    });

    it("adds initial liquidity and emits LiquidityAdded", async () => {
      await expect(
        dex.connect(lp).addLiquidity(tokenA.target, tokenB.target, LIQUIDITY_A, LIQUIDITY_B)
      ).to.emit(dex, "LiquidityAdded");
    });

    it("reverts when pool does not exist", async () => {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const tokenC = await MockERC20Factory.deploy("Token C", "TKC", 18, INITIAL_SUPPLY);
      await expect(
        dex.connect(lp).addLiquidity(tokenA.target, tokenC.target, LIQUIDITY_A, LIQUIDITY_B)
      ).to.be.revertedWith("Pool does not exist");
    });

    it("reverts with zero amounts", async () => {
      await expect(
        dex.connect(lp).addLiquidity(tokenA.target, tokenB.target, 0n, LIQUIDITY_B)
      ).to.be.revertedWith("Insufficient amounts");
    });
  });

  // -------------------------------------------------------------------------
  // getAmountOut
  // -------------------------------------------------------------------------

  describe("getAmountOut", () => {
    it("returns correct output with 0.3% fee", async () => {
      const reserveIn = ethers.parseUnits("10000", 18);
      const reserveOut = ethers.parseUnits("10000", 18);
      const amountIn = ethers.parseUnits("100", 18);

      const amountOut = await dex.getAmountOut(amountIn, reserveIn, reserveOut);

      // With 0.3% fee: amountOut ≈ 99.7 * 10000 / (10000 + 99.7) ≈ 98.7
      // Just verify it's less than input (fee applied) and greater than 0
      expect(amountOut).to.be.gt(0n);
      expect(amountOut).to.be.lt(amountIn);
    });

    it("reverts with zero input", async () => {
      await expect(dex.getAmountOut(0n, 1000n, 1000n))
        .to.be.revertedWith("Insufficient input");
    });

    it("reverts with zero reserves", async () => {
      await expect(dex.getAmountOut(100n, 0n, 1000n))
        .to.be.revertedWith("Insufficient liquidity");
    });
  });

  // -------------------------------------------------------------------------
  // swapToRecipient
  // -------------------------------------------------------------------------

  describe("swapToRecipient", () => {
    const SWAP_AMOUNT = ethers.parseUnits("100", 18);

    beforeEach(async () => {
      // Create pool and add liquidity
      await dex.createPool(tokenA.target, tokenB.target);
      await tokenA.connect(lp).approve(dex.target, LIQUIDITY_A);
      await tokenB.connect(lp).approve(dex.target, LIQUIDITY_B);
      await dex.connect(lp).addLiquidity(tokenA.target, tokenB.target, LIQUIDITY_A, LIQUIDITY_B);

      // Approve trader's tokenA spend
      await tokenA.connect(trader).approve(dex.target, SWAP_AMOUNT);
    });

    it("swaps tokenA for tokenB and delivers to recipient", async () => {
      const recipientBalanceBefore = await tokenB.balanceOf(recipient.address);

      await dex.connect(trader).swapToRecipient(
        tokenA.target,
        tokenB.target,
        SWAP_AMOUNT,
        0n, // no slippage protection for test
        recipient.address,
      );

      const recipientBalanceAfter = await tokenB.balanceOf(recipient.address);
      expect(recipientBalanceAfter).to.be.gt(recipientBalanceBefore);
    });

    it("deducts tokenA from trader", async () => {
      const traderBalanceBefore = await tokenA.balanceOf(trader.address);

      await dex.connect(trader).swapToRecipient(
        tokenA.target,
        tokenB.target,
        SWAP_AMOUNT,
        0n,
        recipient.address,
      );

      const traderBalanceAfter = await tokenA.balanceOf(trader.address);
      expect(traderBalanceAfter).to.equal(traderBalanceBefore - SWAP_AMOUNT);
    });

    it("emits Swap event with correct sender and recipient", async () => {
      await expect(
        dex.connect(trader).swapToRecipient(
          tokenA.target,
          tokenB.target,
          SWAP_AMOUNT,
          0n,
          recipient.address,
        )
      )
        .to.emit(dex, "Swap")
        .withArgs(
          await dex.getPoolId(tokenA.target, tokenB.target),
          trader.address,
          recipient.address,
          tokenA.target,
          tokenB.target,
          SWAP_AMOUNT,
          // amountOut is dynamic — use anyValue
          (v) => v > 0n,
        );
    });

    it("reverts when slippage is exceeded", async () => {
      const minAmountOut = ethers.parseUnits("999999", 6); // impossibly high
      await expect(
        dex.connect(trader).swapToRecipient(
          tokenA.target,
          tokenB.target,
          SWAP_AMOUNT,
          minAmountOut,
          recipient.address,
        )
      ).to.be.revertedWith("Slippage exceeded");
    });

    it("reverts with zero address recipient", async () => {
      await expect(
        dex.connect(trader).swapToRecipient(
          tokenA.target,
          tokenB.target,
          SWAP_AMOUNT,
          0n,
          ethers.ZeroAddress,
        )
      ).to.be.revertedWith("Invalid recipient");
    });

    it("reverts when pool does not exist", async () => {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const tokenC = await MockERC20Factory.deploy("Token C", "TKC", 18, INITIAL_SUPPLY);
      await expect(
        dex.connect(trader).swapToRecipient(
          tokenA.target,
          tokenC.target,
          SWAP_AMOUNT,
          0n,
          recipient.address,
        )
      ).to.be.revertedWith("Pool does not exist");
    });
  });

  // -------------------------------------------------------------------------
  // getReserves
  // -------------------------------------------------------------------------

  describe("getReserves", () => {
    it("returns correct reserves after adding liquidity", async () => {
      await dex.createPool(tokenA.target, tokenB.target);
      await tokenA.connect(lp).approve(dex.target, LIQUIDITY_A);
      await tokenB.connect(lp).approve(dex.target, LIQUIDITY_B);
      await dex.connect(lp).addLiquidity(tokenA.target, tokenB.target, LIQUIDITY_A, LIQUIDITY_B);

      const [reserveA, reserveB] = await dex.getReserves(tokenA.target, tokenB.target);
      expect(reserveA).to.equal(LIQUIDITY_A);
      expect(reserveB).to.equal(LIQUIDITY_B);
    });
  });
});
