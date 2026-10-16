const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EvoPool", function () {
  let pool;
  let tokenA;
  let tokenB;
  let owner;
  let lp;
  let trader;
  let controller;

  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const INITIAL_FEE_BPS = 30n; // 0.30%
  const INITIAL_BETA = 5000n; // 0.5 scaled 1e4

  beforeEach(async function () {
    [owner, lp, trader, controller] = await ethers.getSigners();

    // Deploy tokens
    const TokenFactory = await ethers.getContractFactory("EvoToken");
    tokenA = await TokenFactory.deploy("Token A", "TKA", INITIAL_SUPPLY, owner.address);
    tokenB = await TokenFactory.deploy("Token B", "TKB", INITIAL_SUPPLY, owner.address);

    // Deploy pool
    const PoolFactory = await ethers.getContractFactory("EvoPool");
    pool = await PoolFactory.deploy(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      INITIAL_FEE_BPS,
      INITIAL_BETA,
      owner.address
    );

    // Set controller
    await pool.setController(controller.address);

    // Distribute tokens to LP and trader
    await tokenA.transfer(lp.address, ethers.parseEther("100000"));
    await tokenB.transfer(lp.address, ethers.parseEther("100000"));
    await tokenA.transfer(trader.address, ethers.parseEther("10000"));
    await tokenB.transfer(trader.address, ethers.parseEther("10000"));

    // Approve pool
    const poolAddr = await pool.getAddress();
    await tokenA.connect(lp).approve(poolAddr, ethers.MaxUint256);
    await tokenB.connect(lp).approve(poolAddr, ethers.MaxUint256);
    await tokenA.connect(trader).approve(poolAddr, ethers.MaxUint256);
    await tokenB.connect(trader).approve(poolAddr, ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("should set initial parameters correctly", async function () {
      expect(await pool.feeBps()).to.equal(INITIAL_FEE_BPS);
      expect(await pool.curveBeta()).to.equal(INITIAL_BETA);
      expect(await pool.curveMode()).to.equal(0); // Normal
      expect(await pool.controller()).to.equal(controller.address);
    });

    it("should have correct ERC-20 LP token name and symbol", async function () {
      expect(await pool.name()).to.equal("EvoPool LP");
      expect(await pool.symbol()).to.equal("EVO-LP");
    });

    it("should reject same tokens", async function () {
      const PoolFactory = await ethers.getContractFactory("EvoPool");
      const addr = await tokenA.getAddress();
      await expect(
        PoolFactory.deploy(addr, addr, 30, 5000, owner.address)
      ).to.be.revertedWithCustomError(pool, "InvalidTokens");
    });

    it("should reject fee above MAX_FEE_BPS", async function () {
      const PoolFactory = await ethers.getContractFactory("EvoPool");
      await expect(
        PoolFactory.deploy(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          501,
          5000,
          owner.address
        )
      ).to.be.revertedWithCustomError(pool, "FeeTooHigh");
    });
  });

  describe("Add Liquidity", function () {
    it("should add initial liquidity and mint LP tokens", async function () {
      const amount = ethers.parseEther("1000");
      await pool.connect(lp).addLiquidity(amount, amount);

      const [r0, r1] = await pool.getReserves();
      expect(r0).to.equal(amount);
      expect(r1).to.equal(amount);
      expect(await pool.balanceOf(lp.address)).to.be.gt(0);
    });

    it("should reject zero amounts", async function () {
      await expect(
        pool.connect(lp).addLiquidity(0, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(pool, "ZeroAmount");
    });

    it("should add subsequent liquidity proportionally", async function () {
      const amount = ethers.parseEther("1000");
      await pool.connect(lp).addLiquidity(amount, amount);
      const lpBefore = await pool.balanceOf(lp.address);

      const add = ethers.parseEther("500");
      await pool.connect(lp).addLiquidity(add, add);
      const lpAfter = await pool.balanceOf(lp.address);

      // Should get roughly half the first deposit's LP tokens
      expect(lpAfter - lpBefore).to.be.closeTo(
        lpBefore / 2n,
        ethers.parseEther("1") // tolerance for minimum liquidity lock
      );
    });

    it("should allow LP token transfer (ERC-20 composability)", async function () {
      const amount = ethers.parseEther("1000");
      await pool.connect(lp).addLiquidity(amount, amount);

      const lpBalance = await pool.balanceOf(lp.address);
      expect(lpBalance).to.be.gt(0);

      // Transfer half to trader
      const half = lpBalance / 2n;
      await pool.connect(lp).transfer(trader.address, half);

      expect(await pool.balanceOf(trader.address)).to.equal(half);
      expect(await pool.balanceOf(lp.address)).to.equal(lpBalance - half);
    });
  });

  describe("Remove Liquidity", function () {
    it("should remove liquidity and return tokens", async function () {
      const amount = ethers.parseEther("1000");
      await pool.connect(lp).addLiquidity(amount, amount);

      const lpTokens = await pool.balanceOf(lp.address);
      const balBefore0 = await tokenA.balanceOf(lp.address);
      const balBefore1 = await tokenB.balanceOf(lp.address);

      await pool.connect(lp).removeLiquidity(lpTokens);

      const balAfter0 = await tokenA.balanceOf(lp.address);
      const balAfter1 = await tokenB.balanceOf(lp.address);

      // Should get back most of the tokens (minus MINIMUM_LIQUIDITY lock)
      expect(balAfter0 - balBefore0).to.be.gt(ethers.parseEther("999"));
      expect(balAfter1 - balBefore1).to.be.gt(ethers.parseEther("999"));
    });

    it("should reject insufficient LP balance", async function () {
      await expect(
        pool.connect(lp).removeLiquidity(ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(pool, "InsufficientLiquidity");
    });
  });

  describe("Swap (Normal mode)", function () {
    beforeEach(async function () {
      const amount = ethers.parseEther("10000");
      await pool.connect(lp).addLiquidity(amount, amount);
    });

    it("should execute swap 0→1 with fee deducted", async function () {
      const amountIn = ethers.parseEther("100");
      const balBefore = await tokenB.balanceOf(trader.address);

      await pool.connect(trader).swap(true, amountIn, 0);

      const balAfter = await tokenB.balanceOf(trader.address);
      const received = balAfter - balBefore;

      expect(received).to.be.gt(ethers.parseEther("98"));
      expect(received).to.be.lt(ethers.parseEther("100"));
    });

    it("should execute swap 1→0", async function () {
      const amountIn = ethers.parseEther("100");
      const balBefore = await tokenA.balanceOf(trader.address);

      await pool.connect(trader).swap(false, amountIn, 0);

      const received = (await tokenA.balanceOf(trader.address)) - balBefore;
      expect(received).to.be.gt(ethers.parseEther("98"));
    });

    it("should revert on insufficient output (slippage)", async function () {
      const amountIn = ethers.parseEther("100");
      await expect(
        pool.connect(trader).swap(true, amountIn, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(pool, "InsufficientOutput");
    });

    it("should revert on zero input", async function () {
      await expect(
        pool.connect(trader).swap(true, 0, 0)
      ).to.be.revertedWithCustomError(pool, "ZeroAmount");
    });

    it("should track trade count and volume", async function () {
      await pool.connect(trader).swap(true, ethers.parseEther("10"), 0);
      await pool.connect(trader).swap(false, ethers.parseEther("5"), 0);

      expect(await pool.tradeCount()).to.equal(2);
      expect(await pool.cumulativeVolume0()).to.equal(ethers.parseEther("10"));
      expect(await pool.cumulativeVolume1()).to.equal(ethers.parseEther("5"));
    });

    it("should maintain constant-product invariant (k increases with fees)", async function () {
      const [r0Before, r1Before] = await pool.getReserves();
      const kBefore = r0Before * r1Before;

      await pool.connect(trader).swap(true, ethers.parseEther("100"), 0);

      const [r0After, r1After] = await pool.getReserves();
      const kAfter = r0After * r1After;

      expect(kAfter).to.be.gte(kBefore);
    });
  });

  describe("Swap (Defensive mode)", function () {
    beforeEach(async function () {
      const amount = ethers.parseEther("10000");
      await pool.connect(lp).addLiquidity(amount, amount);

      await pool.connect(controller).updateParameters(
        INITIAL_FEE_BPS,
        INITIAL_BETA,
        1, // Defensive
        controller.address
      );
    });

    it("should have higher slippage for large trades (whale deterrent)", async function () {
      const smallIn = ethers.parseEther("10");
      const balBefore1 = await tokenB.balanceOf(trader.address);
      await pool.connect(trader).swap(true, smallIn, 0);
      const smallOut = (await tokenB.balanceOf(trader.address)) - balBefore1;

      await pool.connect(lp).addLiquidity(ethers.parseEther("10000"), ethers.parseEther("10000"));

      const largeIn = ethers.parseEther("2000");
      const balBefore2 = await tokenB.balanceOf(trader.address);
      await pool.connect(trader).swap(true, largeIn, 0);
      const largeOut = (await tokenB.balanceOf(trader.address)) - balBefore2;

      const rateSmall = (BigInt(smallOut) * 10000n) / BigInt(smallIn);
      const rateLarge = (BigInt(largeOut) * 10000n) / BigInt(largeIn);

      expect(rateLarge).to.be.lt(rateSmall);
    });
  });

  describe("Swap (VolatilityAdaptive mode)", function () {
    beforeEach(async function () {
      const amount = ethers.parseEther("10000");
      await pool.connect(lp).addLiquidity(amount, amount);

      await pool.connect(controller).updateParameters(
        INITIAL_FEE_BPS,
        INITIAL_BETA,
        2, // VolatilityAdaptive
        controller.address
      );
    });

    it("should apply linear penalty scaling with trade size", async function () {
      const balBefore = await tokenB.balanceOf(trader.address);
      await pool.connect(trader).swap(true, ethers.parseEther("500"), 0);
      const received = (await tokenB.balanceOf(trader.address)) - balBefore;

      expect(received).to.be.gt(0);
      expect(received).to.be.lt(ethers.parseEther("500"));
    });
  });

  describe("Parameter Updates", function () {
    it("should allow controller to update parameters", async function () {
      await pool.connect(controller).updateParameters(50, 7000, 1, controller.address);

      expect(await pool.feeBps()).to.equal(50);
      expect(await pool.curveBeta()).to.equal(7000);
      expect(await pool.curveMode()).to.equal(1);
    });

    it("should reject non-controller", async function () {
      await expect(
        pool.connect(trader).updateParameters(50, 7000, 1, trader.address)
      ).to.be.revertedWithCustomError(pool, "OnlyController");
    });

    it("should reject fee above MAX_FEE_BPS", async function () {
      await expect(
        pool.connect(controller).updateParameters(501, 5000, 0, controller.address)
      ).to.be.revertedWithCustomError(pool, "FeeTooHigh");
    });

    it("should reject invalid curve mode", async function () {
      await expect(
        pool.connect(controller).updateParameters(30, 5000, 3, controller.address)
      ).to.be.reverted;
    });

    it("should emit ParametersUpdated event", async function () {
      await expect(pool.connect(controller).updateParameters(45, 6000, 2, controller.address))
        .to.emit(pool, "ParametersUpdated")
        .withArgs(45, 6000, 2, controller.address);
    });
  });

  describe("TWAP Oracle", function () {
    beforeEach(async function () {
      const amount = ethers.parseEther("10000");
      await pool.connect(lp).addLiquidity(amount, amount);
    });

    it("should initialize TWAP accumulators after first swap", async function () {
      // Initial values should be 0
      const p0Before = await pool.price0CumulativeLast();

      // Advance time and swap
      await ethers.provider.send("evm_increaseTime", [60]);
      await ethers.provider.send("evm_mine", []);
      await pool.connect(trader).swap(true, ethers.parseEther("10"), 0);

      const p0After = await pool.price0CumulativeLast();
      expect(p0After).to.be.gt(p0Before);
    });

    it("should accumulate prices over multiple swaps", async function () {
      await ethers.provider.send("evm_increaseTime", [60]);
      await pool.connect(trader).swap(true, ethers.parseEther("10"), 0);
      const p0First = await pool.price0CumulativeLast();

      await ethers.provider.send("evm_increaseTime", [60]);
      await pool.connect(trader).swap(false, ethers.parseEther("5"), 0);
      const p0Second = await pool.price0CumulativeLast();

      expect(p0Second).to.be.gt(p0First);
    });
  });

  describe("Protocol Fee", function () {
    beforeEach(async function () {
      const amount = ethers.parseEther("10000");
      await pool.connect(lp).addLiquidity(amount, amount);
    });

    it("should default to zero protocol fee", async function () {
      expect(await pool.protocolFeeBps()).to.equal(0);
    });

    it("should allow owner to set protocol fee", async function () {
      await pool.setProtocolFee(500); // 5% of swap fee
      expect(await pool.protocolFeeBps()).to.equal(500);
    });

    it("should reject protocol fee above max", async function () {
      await expect(
        pool.setProtocolFee(2001)
      ).to.be.revertedWithCustomError(pool, "ProtocolFeeTooHigh");
    });

    it("should accumulate protocol fees on swaps", async function () {
      await pool.setProtocolFee(1000); // 10% of swap fee

      await pool.connect(trader).swap(true, ethers.parseEther("100"), 0);

      const accum0 = await pool.protocolFeeAccum0();
      expect(accum0).to.be.gt(0);
    });

    it("should collect protocol fees to treasury", async function () {
      await pool.setProtocolFee(1000);
      await pool.connect(trader).swap(true, ethers.parseEther("100"), 0);

      const accum0Before = await pool.protocolFeeAccum0();
      expect(accum0Before).to.be.gt(0);

      const treasuryBalBefore = await tokenA.balanceOf(owner.address);
      await pool.collectProtocolFees();
      const treasuryBalAfter = await tokenA.balanceOf(owner.address);

      expect(treasuryBalAfter - treasuryBalBefore).to.equal(accum0Before);
      expect(await pool.protocolFeeAccum0()).to.equal(0);
    });
  });

  describe("Emergency Pause", function () {
    beforeEach(async function () {
      await tokenA.transfer(lp.address, ethers.parseEther("10000"));
      await tokenB.transfer(lp.address, ethers.parseEther("10000"));
      await tokenA.connect(lp).approve(await pool.getAddress(), ethers.parseEther("10000"));
      await tokenB.connect(lp).approve(await pool.getAddress(), ethers.parseEther("10000"));
      await pool.connect(lp).addLiquidity(ethers.parseEther("1000"), ethers.parseEther("1000"));
    });

    it("should block swaps when paused", async function () {
      await pool.pause();
      await tokenA.transfer(trader.address, ethers.parseEther("100"));
      await tokenA.connect(trader).approve(await pool.getAddress(), ethers.parseEther("100"));
      await expect(
        pool.connect(trader).swap(true, ethers.parseEther("10"), 0)
      ).to.be.revertedWithCustomError(pool, "PoolPaused");
    });

    it("should block addLiquidity when paused", async function () {
      await pool.pause();
      await expect(
        pool.connect(lp).addLiquidity(ethers.parseEther("10"), ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(pool, "PoolPaused");
    });

    it("should allow removeLiquidity when paused (emergency exit)", async function () {
      await pool.pause();
      const lpBal = await pool.balanceOf(lp.address);
      await expect(pool.connect(lp).removeLiquidity(lpBal / 2n)).to.not.be.reverted;
    });

    it("should resume after unpause", async function () {
      await pool.pause();
      await pool.unpause();
      await tokenA.transfer(trader.address, ethers.parseEther("100"));
      await tokenA.connect(trader).approve(await pool.getAddress(), ethers.parseEther("100"));
      await expect(
        pool.connect(trader).swap(true, ethers.parseEther("10"), 0)
      ).to.not.be.reverted;
    });

    it("should only allow owner to pause", async function () {
      await expect(pool.connect(trader).pause()).to.be.reverted;
    });
  });
});
