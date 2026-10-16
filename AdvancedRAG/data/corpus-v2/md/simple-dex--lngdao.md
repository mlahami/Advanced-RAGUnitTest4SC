# simple-dex--lngdao

- domain: amm-dex (amm-dex)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/lngdao/agent-hire @ c9cf6702d064a75a1e58ac5294faf8223836d7c4
- license: MIT
- targets: SimpleDEX.sol, MockERC20.sol
- validation: 15 passing tests, 0 failing; statement coverage SimpleDEX.sol 100.0 %, MockERC20.sol 50.0 %

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Contract: SimpleDEX.sol (primary target)

```solidity
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
```

## Tests: SimpleDEX.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SimpleDEX", function () {
  let usdc;
  let weth;
  let dex;
  let owner, user1, user2;

  // Rate: 1 USDC (1e6 raw) = 0.00035 WETH (3.5e14 raw)
  // Per raw USDC unit: 3.5e14 / 1e6 = 3.5e8 raw WETH
  // Scaled by 1e18: rate = 3.5e8 * 1e18 = 3.5e26
  const RATE = BigInt("350000000") * ethers.parseUnits("1", 18); // 3.5e26

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20Factory.deploy("Mock USDC", "USDC", 6);
    weth = await MockERC20Factory.deploy("Mock WETH", "WETH", 18);

    const SimpleDEXFactory = await ethers.getContractFactory("SimpleDEX");
    dex = await SimpleDEXFactory.deploy(
      await usdc.getAddress(),
      await weth.getAddress(),
      RATE
    );

    // Mint tokens to owner and add liquidity
    await usdc.mint(owner.address, ethers.parseUnits("500000", 6));
    await weth.mint(owner.address, ethers.parseUnits("500", 18));

    await usdc.approve(await dex.getAddress(), ethers.parseUnits("500000", 6));
    await weth.approve(await dex.getAddress(), ethers.parseUnits("500", 18));
    await dex.addLiquidity(await usdc.getAddress(), ethers.parseUnits("500000", 6));
    await dex.addLiquidity(await weth.getAddress(), ethers.parseUnits("500", 18));

    // Mint USDC to user1 for swapping
    await usdc.mint(user1.address, ethers.parseUnits("10000", 6));
    // Mint WETH to user2 for reverse swaps
    await weth.mint(user2.address, ethers.parseUnits("10", 18));
  });

  describe("Deployment", function () {
    it("should set correct token addresses", async function () {
      expect(await dex.tokenA()).to.equal(await usdc.getAddress());
      expect(await dex.tokenB()).to.equal(await weth.getAddress());
    });

    it("should set correct rate", async function () {
      expect(await dex.rate()).to.equal(RATE);
    });

    it("should set deployer as owner", async function () {
      expect(await dex.owner()).to.equal(owner.address);
    });

    it("should hold liquidity", async function () {
      const dexAddress = await dex.getAddress();
      expect(await usdc.balanceOf(dexAddress)).to.equal(ethers.parseUnits("500000", 6));
      expect(await weth.balanceOf(dexAddress)).to.equal(ethers.parseUnits("500", 18));
    });
  });

  describe("Swap A->B (USDC -> WETH)", function () {
    it("should swap USDC for WETH at correct rate", async function () {
      const amountIn = ethers.parseUnits("100", 6); // 100 USDC
      // Expected: 100e6 * RATE / 1e18 = 1e8 * 3.5e26 / 1e18 = 3.5e16 = 0.035 WETH
      const expectedOut = (amountIn * RATE) / ethers.parseUnits("1", 18);

      await usdc.connect(user1).approve(await dex.getAddress(), amountIn);
      const tx = await dex.connect(user1).swap(await usdc.getAddress(), amountIn);

      await expect(tx)
        .to.emit(dex, "Swapped")
        .withArgs(
          user1.address,
          await usdc.getAddress(),
          await weth.getAddress(),
          amountIn,
          expectedOut,
          (await ethers.provider.getBlock("latest")) .timestamp
        );

      // Check user1 received WETH
      expect(await weth.balanceOf(user1.address)).to.equal(expectedOut);
      // Check user1 USDC decreased
      expect(await usdc.balanceOf(user1.address)).to.equal(ethers.parseUnits("10000", 6) - amountIn);
    });

    it("should handle large swap amounts", async function () {
      const amountIn = ethers.parseUnits("1000", 6); // 1000 USDC
      const expectedOut = (amountIn * RATE) / ethers.parseUnits("1", 18);

      await usdc.connect(user1).approve(await dex.getAddress(), amountIn);
      await dex.connect(user1).swap(await usdc.getAddress(), amountIn);

      expect(await weth.balanceOf(user1.address)).to.equal(expectedOut);
    });
  });

  describe("Swap B->A (WETH -> USDC)", function () {
    it("should swap WETH for USDC at correct rate", async function () {
      const amountIn = ethers.parseUnits("0.035", 18); // 0.035 WETH
      // Expected: 3.5e16 * 1e18 / 3.5e26 = 1e8 = 100 USDC (6 dec)
      const expectedOut = (amountIn * ethers.parseUnits("1", 18)) / RATE;

      await weth.connect(user2).approve(await dex.getAddress(), amountIn);
      const tx = await dex.connect(user2).swap(await weth.getAddress(), amountIn);

      await expect(tx)
        .to.emit(dex, "Swapped")
        .withArgs(
          user2.address,
          await weth.getAddress(),
          await usdc.getAddress(),
          amountIn,
          expectedOut,
          (await ethers.provider.getBlock("latest")) .timestamp
        );

      expect(await usdc.balanceOf(user2.address)).to.equal(expectedOut);
    });
  });

  describe("Error cases", function () {
    it("should reject invalid token", async function () {
      await expect(
        dex.connect(user1).swap(user1.address, ethers.parseUnits("100", 6))
      ).to.be.revertedWith("Invalid token");
    });

    it("should reject zero amount", async function () {
      await expect(
        dex.connect(user1).swap(await usdc.getAddress(), 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("should reject swap exceeding DEX liquidity", async function () {
      // Mint a huge amount of USDC to user1
      await usdc.mint(user1.address, ethers.parseUnits("100000000", 6));
      const hugeAmount = ethers.parseUnits("100000000", 6);
      await usdc.connect(user1).approve(await dex.getAddress(), hugeAmount);

      await expect(
        dex.connect(user1).swap(await usdc.getAddress(), hugeAmount)
      ).to.be.revertedWith("Insufficient DEX liquidity");
    });
  });

  describe("Access control", function () {
    it("should allow owner to add liquidity", async function () {
      await usdc.mint(owner.address, ethers.parseUnits("1000", 6));
      await usdc.approve(await dex.getAddress(), ethers.parseUnits("1000", 6));
      await dex.addLiquidity(await usdc.getAddress(), ethers.parseUnits("1000", 6));

      const dexAddress = await dex.getAddress();
      expect(await usdc.balanceOf(dexAddress)).to.equal(ethers.parseUnits("501000", 6));
    });

    it("should reject non-owner addLiquidity", async function () {
      await usdc.mint(user1.address, ethers.parseUnits("1000", 6));
      await usdc.connect(user1).approve(await dex.getAddress(), ethers.parseUnits("1000", 6));

      await expect(
        dex.connect(user1).addLiquidity(await usdc.getAddress(), ethers.parseUnits("1000", 6))
      ).to.be.revertedWith("Only owner");
    });

    it("should allow owner to set rate", async function () {
      const newRate = ethers.parseUnits("0.0005", 18);
      await dex.setRate(newRate);
      expect(await dex.rate()).to.equal(newRate);
    });

    it("should reject non-owner setRate", async function () {
      await expect(
        dex.connect(user1).setRate(ethers.parseUnits("0.0005", 18))
      ).to.be.revertedWith("Only owner");
    });
  });

  describe("Full lifecycle", function () {
    it("should support multiple swaps and rate changes", async function () {
      // Swap 1: user1 swaps 100 USDC -> WETH
      const amount1 = ethers.parseUnits("100", 6);
      await usdc.connect(user1).approve(await dex.getAddress(), amount1);
      await dex.connect(user1).swap(await usdc.getAddress(), amount1);
      const wethBal1 = await weth.balanceOf(user1.address);
      expect(wethBal1).to.be.gt(0);

      // Owner changes rate (0.0005 WETH per USDC, adjusted for decimals)
      const newRate = BigInt("500000000") * ethers.parseUnits("1", 18); // 5e26
      await dex.setRate(newRate);

      // Swap 2: user1 swaps another 100 USDC -> WETH at new rate
      const amount2 = ethers.parseUnits("100", 6);
      await usdc.connect(user1).approve(await dex.getAddress(), amount2);
      await dex.connect(user1).swap(await usdc.getAddress(), amount2);
      const wethBal2 = await weth.balanceOf(user1.address);
      expect(wethBal2).to.be.gt(wethBal1); // Got more WETH total

      // Swap 3: user2 swaps WETH -> USDC
      const amount3 = ethers.parseUnits("0.01", 18);
      await weth.connect(user2).approve(await dex.getAddress(), amount3);
      await dex.connect(user2).swap(await weth.getAddress(), amount3);
      expect(await usdc.balanceOf(user2.address)).to.be.gt(0);
    });
  });
});
```
