// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimpleDEX {
    address public tokenA; // Mock USDC
    address public tokenB; // Mock WETH
    uint256 public rate;   // How many tokenB per tokenA (scaled by 1e18)
    address public owner;

    event Swapped(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 timestamp
    );

    constructor(address _tokenA, address _tokenB, uint256 _rate) {
        tokenA = _tokenA;
        tokenB = _tokenB;
        rate = _rate;
        owner = msg.sender;
    }

    /// @notice Swap tokenA for tokenB or vice versa
    /// @param tokenIn Address of token to sell
    /// @param amountIn Amount of tokenIn to sell
    /// @return amountOut Amount of tokenOut received
    function swap(address tokenIn, uint256 amountIn) external returns (uint256 amountOut) {
        require(tokenIn == tokenA || tokenIn == tokenB, "Invalid token");
        require(amountIn > 0, "Amount must be > 0");

        address tokenOut;
        if (tokenIn == tokenA) {
            // USDC -> WETH: amountOut = amountIn * rate / 1e18
            amountOut = (amountIn * rate) / 1e18;
            tokenOut = tokenB;
        } else {
            // WETH -> USDC: amountOut = amountIn * 1e18 / rate
            amountOut = (amountIn * 1e18) / rate;
            tokenOut = tokenA;
        }

        require(
            IERC20(tokenOut).balanceOf(address(this)) >= amountOut,
            "Insufficient DEX liquidity"
        );

        // Transfer tokenIn from user to DEX
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Transfer tokenOut from DEX to user
        IERC20(tokenOut).transfer(msg.sender, amountOut);

        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut, block.timestamp);
    }

    /// @notice Owner can add liquidity
    function addLiquidity(address token, uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }

    /// @notice Update exchange rate
    function setRate(uint256 _rate) external {
        require(msg.sender == owner, "Only owner");
        rate = _rate;
    }
}
