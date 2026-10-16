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
