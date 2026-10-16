// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract DexPool is ERC20 {
    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokensMinted);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokensBurned);
    event Swap(address indexed swapper, address indexed tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB) ERC20("MiniDEX LP Token", "MDX-LP") {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token address");
        require(_tokenA != _tokenB, "Tokens must be different");
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    /**
     * @dev Returns the current reserves of the pool.
     */
    function getReserves() external view returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
    }

    /**
     * @dev Simple square root utility function.
     */
    function sqrt(uint y) internal pure returns (uint z) {
        if (y > 3) {
            z = y;
            uint x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    /**
     * @dev Adds liquidity to the pool.
     * Mints LP tokens to the provider based on constant product invariant.
     */
    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 lpTokensToMint) {
        require(amountA > 0 && amountB > 0, "Amounts must be greater than zero");

        // Transfer tokens from sender
        require(tokenA.transferFrom(msg.sender, address(this), amountA), "Token A transfer failed");
        require(tokenB.transferFrom(msg.sender, address(this), amountB), "Token B transfer failed");

        uint256 totalLP = totalSupply();

        if (totalLP == 0) {
            // First time adding liquidity: calculate initial LP tokens as square root of product
            lpTokensToMint = sqrt(amountA * amountB);
        } else {
            // Calculate proportional shares
            uint256 shareA = (amountA * totalLP) / reserveA;
            uint256 shareB = (amountB * totalLP) / reserveB;
            
            // LP tokens issued is the minimum ratio to maintain the constant product ratio
            lpTokensToMint = Math.min(shareA, shareB);
        }

        require(lpTokensToMint > 0, "Insufficient liquidity minted");

        // Update reserves
        reserveA += amountA;
        reserveB += amountB;

        // Mint LP tokens to provider
        _mint(msg.sender, lpTokensToMint);

        emit LiquidityAdded(msg.sender, amountA, amountB, lpTokensToMint);
        return lpTokensToMint;
    }

    /**
     * @dev Removes liquidity from the pool.
     * Burns LP tokens and returns the proportional amounts of Token A and B.
     */
    function removeLiquidity(uint256 lpAmount) external returns (uint256 amountA, uint256 amountB) {
        require(lpAmount > 0, "LP amount must be greater than zero");
        require(balanceOf(msg.sender) >= lpAmount, "Insufficient LP balance");

        uint256 totalLP = totalSupply();

        // Calculate proportional tokens to return
        amountA = (lpAmount * reserveA) / totalLP;
        amountB = (lpAmount * reserveB) / totalLP;

        require(amountA > 0 && amountB > 0, "Insufficient reserves returned");

        // Burn LP tokens
        _burn(msg.sender, lpAmount);

        // Update reserves
        reserveA -= amountA;
        reserveB -= amountB;

        // Transfer tokens to sender
        require(tokenA.transfer(msg.sender, amountA), "Token A transfer failed");
        require(tokenB.transfer(msg.sender, amountB), "Token B transfer failed");

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpAmount);
        return (amountA, amountB);
    }

    /**
     * @dev Returns output token amount given an input amount based on x * y = k AMM formula.
     * Deducts a 0.3% trading fee from input.
     */
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        require(amountIn > 0, "Input amount must be greater than zero");
        require(reserveIn > 0 && reserveOut > 0, "Reserves must be greater than zero");

        // 0.3% fee is deducted -> input amount is effectively 99.7% of amountIn
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        
        return numerator / denominator;
    }

    /**
     * @dev Performs token swap (Token A -> Token B or Token B -> Token A).
     */
    function swap(address tokenInAddress, uint256 amountIn) external returns (uint256 amountOut) {
        require(tokenInAddress == address(tokenA) || tokenInAddress == address(tokenB), "Invalid input token");
        require(amountIn > 0, "Input amount must be greater than zero");

        bool isTokenA = tokenInAddress == address(tokenA);
        IERC20 tokenIn = isTokenA ? tokenA : tokenB;
        IERC20 tokenOut = isTokenA ? tokenB : tokenA;

        uint256 rIn = isTokenA ? reserveA : reserveB;
        uint256 rOut = isTokenA ? reserveB : reserveA;

        require(rIn > 0 && rOut > 0, "Insufficient pool liquidity");

        // Get output amount
        amountOut = getAmountOut(amountIn, rIn, rOut);
        require(amountOut > 0, "Output amount too small");
        require(amountOut < rOut, "Not enough reserve in pool");

        // Transfer input token from user
        require(tokenIn.transferFrom(msg.sender, address(this), amountIn), "Input transfer failed");

        // Update reserves
        if (isTokenA) {
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            reserveB += amountIn;
            reserveA -= amountOut;
        }

        // Transfer output token to user
        require(tokenOut.transfer(msg.sender, amountOut), "Output transfer failed");

        emit Swap(msg.sender, tokenInAddress, amountIn, amountOut);
        return amountOut;
    }
}
