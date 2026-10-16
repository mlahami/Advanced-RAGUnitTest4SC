# griffin-dex--littlefingerrr

- domain: amm-dex (amm-dex)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/LittleFingerrr/Griffin @ 4ab33af05e2d980b394455bc13166f29235d8151
- license: MIT
- targets: GriffinDEX.sol, MockERC20.sol
- validation: 21 passing tests, 0 failing; statement coverage GriffinDEX.sol 74.63 %, MockERC20.sol 100.0 %

## Contract: GriffinDEX.sol (primary target)

```solidity
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
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Test token for local development and Hardhat testing.
 *         Mints the entire supply to the deployer on construction.
 */
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        uint256 initialSupply
    ) ERC20(name, symbol) {
        _decimals = decimals_;
        _mint(msg.sender, initialSupply * (10 ** decimals_));
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
```

## Tests: GriffinDEX.test.js

```javascript
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
```
