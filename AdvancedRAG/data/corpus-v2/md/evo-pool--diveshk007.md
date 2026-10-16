# evo-pool--diveshk007

- domain: amm-dex (amm-dex)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/DiveshK007/EvoArena @ a3e8f1ff61b03fe58915cd0e880b26dbeff744a1
- license: MIT
- targets: EvoPool.sol, EvoToken.sol, IEvoPool.sol
- validation: 35 passing tests, 0 failing; statement coverage EvoPool.sol 97.37 %, EvoToken.sol 50.0 %, IEvoPool.sol 100.0 %

## Contract: EvoPool.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IEvoPool.sol";

/**
 * @title EvoPool
 * @author EvoArena Protocol
 * @notice Adaptive AMM with 3 curve modes: Normal, Defensive, VolatilityAdaptive.
 *         Parameters (feeBps, curveBeta, curveMode) are updated by a trusted
 *         AgentController contract. Uses a constant-product baseline with
 *         curve-mode-dependent modifications to price impact and fees.
 *
 *         LP shares are issued as a standard ERC-20 token (EvoPool LP).
 *         Includes a Uniswap-V2-style TWAP price oracle and optional
 *         protocol fee (routed to treasury).
 *
 * @dev curveBeta is stored scaled by 1e4, so 10000 = 1.0, 2000 = 0.2, etc.
 *      feeBps is in basis points (1 bps = 0.01%).
 *      TWAP uses UQ112x112 fixed-point price accumulators.
 */
contract EvoPool is IEvoPool, ERC20, ERC20Permit, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ── Tokens ──────────────────────────────────────────────────────────
    IERC20 public immutable token0;
    IERC20 public immutable token1;

    // ── Reserves ────────────────────────────────────────────────────────
    uint256 public reserve0;
    uint256 public reserve1;

    // ── Tunable parameters (set by AgentController) ─────────────────────
    uint256 public override feeBps;       // e.g. 30 = 0.30 %
    uint256 public override curveBeta;    // scaled 1e4; 10000 = 1.0
    CurveMode public override curveMode;

    // ── Access ──────────────────────────────────────────────────────────
    address public controller; // AgentController address
    address public epochManager; // EpochManager address (also authorized)

    // ── Trade tracking (for off-chain agent) ────────────────────────────
    uint256 public tradeCount;
    uint256 public cumulativeVolume0;
    uint256 public cumulativeVolume1;

    // ── TWAP Oracle (Uniswap V2-style) ──────────────────────────────────
    uint256 public override price0CumulativeLast;
    uint256 public override price1CumulativeLast;
    uint32  public override blockTimestampLast;

    // ── Protocol Fee ────────────────────────────────────────────────────
    uint256 public override protocolFeeBps; // bps of swap fee sent to treasury (0 = off)
    address public treasury;
    uint256 public protocolFeeAccum0;  // uncollected protocol fees token0
    uint256 public protocolFeeAccum1;  // uncollected protocol fees token1

    // ── Constants ───────────────────────────────────────────────────────
    uint256 public constant MAX_FEE_BPS = 500;          // 5 %
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 2000; // 20% of swap fee max
    uint256 public constant BETA_SCALE  = 10_000;       // 1.0 = 10000
    uint256 private constant MINIMUM_LIQUIDITY = 1000;
    uint256 private constant Q112 = 2**112;

    // ── Rate limit ──────────────────────────────────────────────────────
    uint256 public parameterUpdateBlock; // block when last parameter update takes effect

    // ── Pause ────────────────────────────────────────────────────────────
    bool public paused;

    // ── Errors ──────────────────────────────────────────────────────────
    error ZeroAmount();
    error InsufficientOutput();
    error InsufficientLiquidity();
    error InvalidTokens();
    error OnlyController();
    error FeeTooHigh();
    error InvalidCurveMode();
    error ProtocolFeeTooHigh();
    error PoolPaused();

    modifier onlyController() {
        if (msg.sender != controller && msg.sender != epochManager) revert OnlyController();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PoolPaused();
        _;
    }

    constructor(
        address _token0,
        address _token1,
        uint256 _initialFeeBps,
        uint256 _initialCurveBeta,
        address _owner
    ) ERC20("EvoPool LP", "EVO-LP") ERC20Permit("EvoPool LP") Ownable(_owner) {
        if (_token0 == _token1 || _token0 == address(0) || _token1 == address(0))
            revert InvalidTokens();
        if (_initialFeeBps > MAX_FEE_BPS) revert FeeTooHigh();

        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
        feeBps = _initialFeeBps;
        curveBeta = _initialCurveBeta;
        curveMode = CurveMode.Normal;
        treasury = _owner; // default treasury = deployer
    }

    // ── Admin ───────────────────────────────────────────────────────────

    /**
     * @notice Set the AgentController address (one-time or owner-updatable).
     */
    function setController(address _controller) external onlyOwner {
        controller = _controller;
    }

    /**
     * @notice Set the EpochManager address (authorized to update parameters).
     */
    function setEpochManager(address _epochManager) external onlyOwner {
        epochManager = _epochManager;
    }

    /**
     * @notice Set the protocol fee (fraction of swap fee routed to treasury).
     * @param _protocolFeeBps Protocol fee in basis points of the swap fee (e.g. 500 = 5% of fee)
     */
    function setProtocolFee(uint256 _protocolFeeBps) external onlyOwner {
        if (_protocolFeeBps > MAX_PROTOCOL_FEE_BPS) revert ProtocolFeeTooHigh();
        protocolFeeBps = _protocolFeeBps;
    }

    /**
     * @notice Update treasury address for protocol fee collection.
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    /// @notice Emergency pause — blocks swaps and new liquidity.
    function pause() external onlyOwner { paused = true; }

    /// @notice Unpause pool operations.
    function unpause() external onlyOwner { paused = false; }

    /**
     * @notice Collect accumulated protocol fees to treasury.
     */
    function collectProtocolFees() external nonReentrant {
        uint256 fee0 = protocolFeeAccum0;
        uint256 fee1 = protocolFeeAccum1;
        protocolFeeAccum0 = 0;
        protocolFeeAccum1 = 0;

        if (fee0 > 0) token0.safeTransfer(treasury, fee0);
        if (fee1 > 0) token1.safeTransfer(treasury, fee1);

        emit ProtocolFeeCollected(treasury, fee0, fee1);
    }

    // ── Views ───────────────────────────────────────────────────────────

    function getReserves() external view override returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    // ── TWAP Oracle ─────────────────────────────────────────────────────

    /**
     * @dev Update cumulative price accumulators. Called at the start of swap/addLiquidity.
     */
    function _updateTWAP() private {
        uint32 blockTimestamp = uint32(block.timestamp % 2**32);
        uint32 timeElapsed;
        unchecked {
            timeElapsed = blockTimestamp - blockTimestampLast;
        }

        if (timeElapsed > 0 && reserve0 > 0 && reserve1 > 0) {
            // UQ112x112 price accumulators (overflow is desired for TWAP math)
            unchecked {
                price0CumulativeLast += (reserve1 * Q112 / reserve0) * timeElapsed;
                price1CumulativeLast += (reserve0 * Q112 / reserve1) * timeElapsed;
            }
            blockTimestampLast = blockTimestamp;
        }
    }

    // ── Liquidity ───────────────────────────────────────────────────────

    /**
     * @notice Add liquidity in proportion to current reserves.
     *         First deposit sets the ratio. Returns LP shares as ERC-20.
     * @param amount0 Amount of token0 to deposit
     * @param amount1 Amount of token1 to deposit
     * @return liquidity LP tokens minted
     */
    function addLiquidity(
        uint256 amount0,
        uint256 amount1
    ) external override nonReentrant whenNotPaused returns (uint256 liquidity) {
        if (amount0 == 0 || amount1 == 0) revert ZeroAmount();

        _updateTWAP();

        // Balance-diff accounting: measure actual tokens received
        uint256 bal0Before = token0.balanceOf(address(this));
        uint256 bal1Before = token1.balanceOf(address(this));

        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);

        uint256 actual0 = token0.balanceOf(address(this)) - bal0Before;
        uint256 actual1 = token1.balanceOf(address(this)) - bal1Before;

        if (totalSupply() == 0) {
            liquidity = _sqrt(actual0 * actual1) - MINIMUM_LIQUIDITY;
            // Lock minimum liquidity to prevent manipulation
            _mint(address(1), MINIMUM_LIQUIDITY); // burn address
        } else {
            uint256 liq0 = (actual0 * totalSupply()) / reserve0;
            uint256 liq1 = (actual1 * totalSupply()) / reserve1;
            liquidity = liq0 < liq1 ? liq0 : liq1;
        }

        if (liquidity == 0) revert InsufficientLiquidity();

        _mint(msg.sender, liquidity);

        reserve0 += actual0;
        reserve1 += actual1;

        emit LiquidityAdded(msg.sender, actual0, actual1, liquidity);
    }

    /**
     * @notice Remove liquidity by burning LP shares.
     * @param liquidity Number of LP tokens to burn
     * @return amount0 Token0 returned
     * @return amount1 Token1 returned
     */
    function removeLiquidity(
        uint256 liquidity
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (liquidity == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < liquidity) revert InsufficientLiquidity();

        _updateTWAP();

        amount0 = (liquidity * reserve0) / totalSupply();
        amount1 = (liquidity * reserve1) / totalSupply();

        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidity();

        _burn(msg.sender, liquidity);

        reserve0 -= amount0;
        reserve1 -= amount1;

        token0.safeTransfer(msg.sender, amount0);
        token1.safeTransfer(msg.sender, amount1);

        emit LiquidityRemoved(msg.sender, amount0, amount1, liquidity);
    }

    // ── Swap ────────────────────────────────────────────────────────────

    /**
     * @notice Execute a swap. The curve mode and fee are applied.
     * @param zeroForOne  true = sell token0 for token1, false = opposite
     * @param amountIn    amount of input token
     * @param minAmountOut  minimum acceptable output (slippage guard)
     * @return amountOut Tokens received by the caller
     */
    function swap(
        bool zeroForOne,
        uint256 amountIn,
        uint256 minAmountOut
    ) external override nonReentrant whenNotPaused returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        if (reserve0 == 0 || reserve1 == 0) revert InsufficientLiquidity();

        _updateTWAP();

        // Balance-diff accounting for fee-on-transfer tokens
        IERC20 tokenIn = zeroForOne ? token0 : token1;
        uint256 balBefore = tokenIn.balanceOf(address(this));
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 actualIn = tokenIn.balanceOf(address(this)) - balBefore;

        // Apply curve-mode adjustments to effective input
        uint256 effectiveIn = _applyCurve(actualIn, zeroForOne);

        // Deduct fee
        uint256 feeAmount = (effectiveIn * feeBps) / 10_000;
        uint256 amountInAfterFee = effectiveIn - feeAmount;

        // Protocol fee: fraction of the swap fee goes to treasury
        uint256 protocolFee = 0;
        if (protocolFeeBps > 0 && feeAmount > 0) {
            protocolFee = (feeAmount * protocolFeeBps) / 10_000;
        }

        // Constant-product math
        uint256 reserveIn  = zeroForOne ? reserve0 : reserve1;
        uint256 reserveOut = zeroForOne ? reserve1 : reserve0;

        amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);

        if (amountOut < minAmountOut) revert InsufficientOutput();

        // Update reserves
        if (zeroForOne) {
            reserve0 += actualIn;
            reserve1 -= amountOut;
            if (protocolFee > 0) {
                protocolFeeAccum0 += protocolFee;
                reserve0 -= protocolFee; // protocol fee is not part of k
            }
        } else {
            reserve1 += actualIn;
            reserve0 -= amountOut;
            if (protocolFee > 0) {
                protocolFeeAccum1 += protocolFee;
                reserve1 -= protocolFee;
            }
        }

        // Transfer output tokens
        (zeroForOne ? token1 : token0).safeTransfer(msg.sender, amountOut);

        // Track stats
        tradeCount++;
        if (zeroForOne) {
            cumulativeVolume0 += actualIn;
        } else {
            cumulativeVolume1 += actualIn;
        }

        emit Swap(msg.sender, zeroForOne, actualIn, amountOut, feeAmount);
    }

    // ── Parameter updates (called by AgentController) ───────────────────

    /**
     * @notice Update pool parameters. Only callable by the AgentController.
     *         Parameters take effect immediately but are recorded for MEV-awareness.
     * @param _feeBps New fee in basis points
     * @param _curveBeta New curve beta (scaled 1e4)
     * @param _curveMode New curve mode (0, 1, or 2)
     * @param _agent The address of the agent that proposed this update
     */
    function updateParameters(
        uint256 _feeBps,
        uint256 _curveBeta,
        CurveMode _curveMode,
        address _agent
    ) external onlyController {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (uint8(_curveMode) > 2) revert InvalidCurveMode();

        feeBps    = _feeBps;
        curveBeta = _curveBeta;
        curveMode = _curveMode;
        parameterUpdateBlock = block.number;

        emit ParametersUpdated(_feeBps, _curveBeta, _curveMode, _agent);
    }

    // ── Internal: Curve application ─────────────────────────────────────

    /**
     * @notice Apply curve-mode adjustments to the effective input amount.
     *
     *   Normal:             effectiveIn = amountIn  (no change)
     *   Defensive:          effectiveIn = amountIn * (1 + beta * W²)
     *                       where W = amountIn / reserveIn  (whale ratio)
     *   VolatilityAdaptive: effectiveIn = amountIn * (1 + beta * amountIn / reserveIn)
     *                       (linear scaling with trade-size-to-depth ratio)
     *
     * @dev In Defensive mode a large trade gets penalised quadratically,
     *      discouraging whale-sized dumps.
     */
    function _applyCurve(
        uint256 amountIn,
        bool zeroForOne
    ) internal view returns (uint256 effectiveIn) {
        if (curveMode == CurveMode.Normal) {
            return amountIn;
        }

        uint256 reserveIn = zeroForOne ? reserve0 : reserve1;

        if (curveMode == CurveMode.Defensive) {
            uint256 w = (amountIn * 1e18) / reserveIn;
            uint256 wSquared = (w * w) / 1e18;
            uint256 penalty = (curveBeta * wSquared) / 1e18;
            effectiveIn = amountIn + (amountIn * penalty) / BETA_SCALE;
        } else {
            uint256 ratio = (amountIn * BETA_SCALE) / reserveIn;
            uint256 penalty = (curveBeta * ratio) / (BETA_SCALE * BETA_SCALE);
            effectiveIn = amountIn + (amountIn * penalty) / BETA_SCALE;
        }
    }

    // ── Util ────────────────────────────────────────────────────────────

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
```

## Contract: EvoToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EvoToken
 * @notice Minimal ERC-20 for protocol coordination and testing.
 *         Used as one of the pair tokens in the demo EvoPool.
 */
contract EvoToken is ERC20, Ownable {
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        _mint(owner_, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
```

## Contract: IEvoPool.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IEvoPool
 * @notice Interface for the EvoArena adaptive AMM pool with TWAP oracle,
 *         protocol fees, and ERC-20 LP tokens.
 */
interface IEvoPool {
    enum CurveMode {
        Normal,            // Standard constant-product
        Defensive,         // Convex whale-defense (price impact ∝ trade²)
        VolatilityAdaptive // Dynamic fee widening based on σ
    }

    // ── Events ──────────────────────────────────────────────────────────
    event Swap(
        address indexed sender,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeAmount
    );
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event ParametersUpdated(uint256 newFeeBps, uint256 newCurveBeta, CurveMode newMode, address indexed agent);
    event ProtocolFeeCollected(address indexed treasury, uint256 amount0, uint256 amount1);

    // ── Core ────────────────────────────────────────────────────────────
    function getReserves() external view returns (uint256 reserve0, uint256 reserve1);
    function swap(bool zeroForOne, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut);
    function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 liquidity);
    function removeLiquidity(uint256 liquidity) external returns (uint256 amount0, uint256 amount1);
    function updateParameters(uint256 _feeBps, uint256 _curveBeta, CurveMode _curveMode, address _agent) external;

    // ── Views ───────────────────────────────────────────────────────────
    function feeBps() external view returns (uint256);
    function curveBeta() external view returns (uint256);
    function curveMode() external view returns (CurveMode);

    // ── TWAP Oracle ─────────────────────────────────────────────────────
    function price0CumulativeLast() external view returns (uint256);
    function price1CumulativeLast() external view returns (uint256);
    function blockTimestampLast() external view returns (uint32);

    // ── Protocol Fee ────────────────────────────────────────────────────
    function protocolFeeBps() external view returns (uint256);

    // ── Access ──────────────────────────────────────────────────────────
    function epochManager() external view returns (address);
    function setEpochManager(address _epochManager) external;

    // ── Emergency ───────────────────────────────────────────────────────
    function paused() external view returns (bool);
    function pause() external;
    function unpause() external;
}
```

## Tests: EvoPool.test.js

```javascript
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
```
