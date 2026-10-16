// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GriffinDEX
 * @notice Minimal DEX for Griffin protocol enabling swaps with separate recipient
 * @dev Supports "pay from sender, deliver to recipient" pattern for intent-based payments
 */
contract GriffinDEX is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Liquidity pool structure
    struct Pool {
        address tokenA;
        address tokenB;
        uint256 reserveA;
        uint256 reserveB;
        uint256 totalLiquidity;
        mapping(address => uint256) liquidity;
    }

    // Pool ID => Pool
    mapping(bytes32 => Pool) public pools;
    
    // Fee: 0.3% (30 basis points)
    uint256 public constant FEE_NUMERATOR = 997;
    uint256 public constant FEE_DENOMINATOR = 1000;
    
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    event PoolCreated(bytes32 indexed poolId, address indexed tokenA, address indexed tokenB);
    event LiquidityAdded(bytes32 indexed poolId, address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);
    event LiquidityRemoved(bytes32 indexed poolId, address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);
    event Swap(
        bytes32 indexed poolId,
        address indexed sender,
        address indexed recipient,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Generate pool ID from token pair
     * @dev Tokens are sorted to ensure consistent pool IDs
     */
    function getPoolId(address tokenA, address tokenB) public pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(token0, token1));
    }

    /**
     * @notice Create a new liquidity pool
     */
    function createPool(address tokenA, address tokenB) external returns (bytes32) {
        require(tokenA != tokenB, "Identical tokens");
        require(tokenA != address(0) && tokenB != address(0), "Zero address");

        bytes32 poolId = getPoolId(tokenA, tokenB);
        require(pools[poolId].tokenA == address(0), "Pool exists");

        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        
        Pool storage pool = pools[poolId];
        pool.tokenA = token0;
        pool.tokenB = token1;

        emit PoolCreated(poolId, token0, token1);
        return poolId;
    }

    /**
     * @notice Add liquidity to a pool
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external nonReentrant returns (uint256 liquidity) {
        bytes32 poolId = getPoolId(tokenA, tokenB);
        Pool storage pool = pools[poolId];
        
        require(pool.tokenA != address(0), "Pool does not exist");
        require(amountA > 0 && amountB > 0, "Insufficient amounts");

        // Determine which token is which in the sorted pair
        bool isAFirst = tokenA == pool.tokenA;
        uint256 amount0 = isAFirst ? amountA : amountB;
        uint256 amount1 = isAFirst ? amountB : amountA;

        if (pool.totalLiquidity == 0) {
            // Initial liquidity
            liquidity = sqrt(amount0 * amount1);
            require(liquidity > MINIMUM_LIQUIDITY, "Insufficient initial liquidity");
            pool.totalLiquidity = liquidity;
        } else {
            // Subsequent liquidity must maintain ratio
            uint256 liquidity0 = (amount0 * pool.totalLiquidity) / pool.reserveA;
            uint256 liquidity1 = (amount1 * pool.totalLiquidity) / pool.reserveB;
            liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
            require(liquidity > 0, "Insufficient liquidity minted");
            pool.totalLiquidity += liquidity;
        }

        pool.liquidity[msg.sender] += liquidity;
        pool.reserveA += amount0;
        pool.reserveB += amount1;

        IERC20(pool.tokenA).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(pool.tokenB).safeTransferFrom(msg.sender, address(this), amount1);

        emit LiquidityAdded(poolId, msg.sender, amount0, amount1, liquidity);
    }

    /**
     * @notice Remove liquidity from a pool
     */
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity
    ) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        bytes32 poolId = getPoolId(tokenA, tokenB);
        Pool storage pool = pools[poolId];
        
        require(pool.liquidity[msg.sender] >= liquidity, "Insufficient liquidity");
        require(liquidity > 0, "Zero liquidity");

        uint256 amount0 = (liquidity * pool.reserveA) / pool.totalLiquidity;
        uint256 amount1 = (liquidity * pool.reserveB) / pool.totalLiquidity;
        
        require(amount0 > 0 && amount1 > 0, "Insufficient liquidity burned");

        pool.liquidity[msg.sender] -= liquidity;
        pool.totalLiquidity -= liquidity;
        pool.reserveA -= amount0;
        pool.reserveB -= amount1;

        bool isAFirst = tokenA == pool.tokenA;
        amountA = isAFirst ? amount0 : amount1;
        amountB = isAFirst ? amount1 : amount0;

        IERC20(pool.tokenA).safeTransfer(msg.sender, amount0);
        IERC20(pool.tokenB).safeTransfer(msg.sender, amount1);

        emit LiquidityRemoved(poolId, msg.sender, amount0, amount1, liquidity);
    }

    /**
     * @notice Swap tokens with separate recipient (Griffin's core feature)
     * @param tokenIn Token to swap from
     * @param tokenOut Token to swap to
     * @param amountIn Amount of tokenIn to swap
     * @param minAmountOut Minimum amount of tokenOut to receive (slippage protection)
     * @param recipient Address to receive the output tokens
     */
    function swapToRecipient(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external nonReentrant returns (uint256 amountOut) {
        require(recipient != address(0), "Invalid recipient");
        require(amountIn > 0, "Insufficient input");

        bytes32 poolId = getPoolId(tokenIn, tokenOut);
        Pool storage pool = pools[poolId];
        require(pool.tokenA != address(0), "Pool does not exist");

        // Determine reserves
        bool isInputA = tokenIn == pool.tokenA;
        uint256 reserveIn = isInputA ? pool.reserveA : pool.reserveB;
        uint256 reserveOut = isInputA ? pool.reserveB : pool.reserveA;

        // Calculate output with fee (constant product formula)
        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut >= minAmountOut, "Slippage exceeded");
        require(amountOut > 0, "Insufficient output");

        // Update reserves
        if (isInputA) {
            pool.reserveA += amountIn;
            pool.reserveB -= amountOut;
        } else {
            pool.reserveB += amountIn;
            pool.reserveA -= amountOut;
        }

        // Transfer tokens: take from sender, give to recipient
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        emit Swap(poolId, msg.sender, recipient, tokenIn, tokenOut, amountIn, amountOut);
    }

    /**
     * @notice Get quote for swap amount
     */
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256) {
        require(amountIn > 0, "Insufficient input");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        uint256 amountInWithFee = amountIn * FEE_NUMERATOR;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * FEE_DENOMINATOR) + amountInWithFee;
        
        return numerator / denominator;
    }

    /**
     * @notice Get pool reserves
     */
    function getReserves(address tokenA, address tokenB) 
        external 
        view 
        returns (uint256 reserveA, uint256 reserveB) 
    {
        bytes32 poolId = getPoolId(tokenA, tokenB);
        Pool storage pool = pools[poolId];
        
        bool isAFirst = tokenA == pool.tokenA;
        reserveA = isAFirst ? pool.reserveA : pool.reserveB;
        reserveB = isAFirst ? pool.reserveB : pool.reserveA;
    }

    /**
     * @notice Get user's liquidity in a pool
     */
    function getUserLiquidity(address tokenA, address tokenB, address user) 
        external 
        view 
        returns (uint256) 
    {
        bytes32 poolId = getPoolId(tokenA, tokenB);
        return pools[poolId].liquidity[user];
    }

    /**
     * @notice Babylonian square root method
     */
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
