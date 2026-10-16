# dex-pool--anmolm-777

- domain: amm-dex (amm-dex)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/AnmolM-777/Mini_DEX @ acbe85fe31c5481baed0bb88d7370a2db103d750
- license: MIT
- targets: DexPool.sol, Token.sol
- validation: 10 passing tests, 0 failing; statement coverage DexPool.sol 97.92 %, Token.sol 50.0 %

## Contract: DexPool.sol (primary target)

```solidity
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
```

## Contract: Token.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Token is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10 ** decimals()); // Mint 1,000,000 initial supply to deployer
    }

    // Public mint function for faucet testing
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: DexPool.test.js

```javascript
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
```
