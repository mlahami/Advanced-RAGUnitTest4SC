// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

//DEX (AMM) â€” constant-product market maker (Uniswap V2-style swap + liquidity)
interface IERC20Mintable {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract DEX {
    IERC20Mintable public tokenA;
    IERC20Mintable public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public totalShares;
    mapping(address => uint256) public shares;

    event LiquidityAdded(address indexed provider, uint256 sharesIssued);
    event LiquidityRemoved(address indexed provider, uint256 sharesBurned);
    event Swapped(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB) {
        tokenA = IERC20Mintable(_tokenA);
        tokenB = IERC20Mintable(_tokenB);
    }

    function addLiquidity(uint256 _amountA, uint256 _amountB) external returns (uint256 sharesMinted) {
        tokenA.transferFrom(msg.sender, address(this), _amountA);
        tokenB.transferFrom(msg.sender, address(this), _amountB);

        if (totalShares == 0) {
            sharesMinted = _sqrt(_amountA * _amountB);
        } else {
            sharesMinted = _min(
                (_amountA * totalShares) / reserveA,
                (_amountB * totalShares) / reserveB
            );
        }
        require(sharesMinted > 0, "Insufficient liquidity minted");
        shares[msg.sender] += sharesMinted;
        totalShares += sharesMinted;
        reserveA += _amountA;
        reserveB += _amountB;
        emit LiquidityAdded(msg.sender, sharesMinted);
    }

    function removeLiquidity(uint256 _shares) external returns (uint256 amountA, uint256 amountB) {
        require(shares[msg.sender] >= _shares, "Insufficient shares");
        amountA = (_shares * reserveA) / totalShares;
        amountB = (_shares * reserveB) / totalShares;
        shares[msg.sender] -= _shares;
        totalShares -= _shares;
        reserveA -= amountA;
        reserveB -= amountB;
        tokenA.transfer(msg.sender, amountA);
        tokenB.transfer(msg.sender, amountB);
        emit LiquidityRemoved(msg.sender, _shares);
    }

    /// @notice Swap tokenA for tokenB (fee = 0.3%)
    function swapAforB(uint256 _amountIn) external returns (uint256 amountOut) {
        tokenA.transferFrom(msg.sender, address(this), _amountIn);
        uint256 amountInWithFee = _amountIn * 997;
        amountOut = (amountInWithFee * reserveB) / (reserveA * 1000 + amountInWithFee);
        reserveA += _amountIn;
        reserveB -= amountOut;
        tokenB.transfer(msg.sender, amountOut);
        emit Swapped(msg.sender, address(tokenA), _amountIn, amountOut);
    }

    function swapBforA(uint256 _amountIn) external returns (uint256 amountOut) {
        tokenB.transferFrom(msg.sender, address(this), _amountIn);
        uint256 amountInWithFee = _amountIn * 997;
        amountOut = (amountInWithFee * reserveA) / (reserveB * 1000 + amountInWithFee);
        reserveB += _amountIn;
        reserveA -= amountOut;
        tokenA.transfer(msg.sender, amountOut);
        emit Swapped(msg.sender, address(tokenB), _amountIn, amountOut);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } }
        else if (y != 0) { z = 1; }
    }
    function _min(uint256 a, uint256 b) internal pure returns (uint256) { return a < b ? a : b; }
}
