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
