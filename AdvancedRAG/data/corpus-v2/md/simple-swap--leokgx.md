# simple-swap--leokgx

- domain: amm-dex (amm-dex)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/LeoKGX/SimpleSwapFrontend @ 48c66aac2b3583ce9bf45c4ed14a70b372652006
- license: MIT
- targets: SimpleSwap.sol
- validation: 20 passing tests, 0 failing; statement coverage SimpleSwap.sol 100.0 %

## Contract: SimpleSwap.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity >0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title SimpleSwapGPT
 * @dev A simple AMM smart contract for swapping ERC20 tokens and providing liquidity to a pool.
 * @dev Implements constant product formula x * y = k without any fees
  * @author Leonardo Kaltenbach
 * @custom:security-contact leokaltengomez@gmail.com
 * Mints ERC20 liquidity tokens to liquidity providers.
 */
contract SimpleSwap is ERC20{

    /// @notice Internal reserves for token A
    uint256 private reserveA;

    /// @notice Internal reserves for token B
    uint256 private reserveB;

    /// @notice Address of token A
    address private immutable tokenA;

    /// @notice Address of token B
    address private immutable tokenB;


    /// @notice Emitted when liquidity is added
    /// @param provider Address of the liquidity provider
    /// @param amountA  Amount of token A received by the contract
    /// @param amountB  Amount of token B received by the contract
    /// @param liquidity LPT minted to the liquidity provider
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);

    /// @notice Emitted when tokens are swapped
    /// @param user Address of the user that swaps tokens
    /// @param amountIn Amount of token sold by the user
    /// @param amountOut Amount of token bought by the user
    /// @param isAToB Bool that determines the path of the operation
    event TokensSwapped(address indexed user, uint256 amountIn, uint256 amountOut, bool isAToB);

    /// @notice Emitted when liquidity is removed
    /// @param user Address of the user that swaps tokens
    /// @param amountA  Amount of token A received by the contract
    /// @param amountB  Amount of token B received by the contract
    event LiquidityRemoved(address indexed user, uint256 amountA, uint256 amountB);

    /**
     * @notice Constructor to initialize token pair and liquidity token metadata.
     * @param _tokenA Address of token A
     * @param _tokenB Address of token B
     */
    constructor(address _tokenA, address _tokenB) ERC20("Liquidity Token","LTP"){
        tokenA = _tokenA;
        tokenB = _tokenB;
    }
    
    /// @dev Modifier to check if deadline has not expired
    /// @ param deadline Time in Unix format
    modifier isExpired(uint deadline){
        require(block.timestamp <= deadline, "Expired");
        _;
    }

    /**
     * @notice Adds liquidity to the token pair pool.
     * @dev Requires token approvals before calling. Emits {LiquidityAdded}.
     * @param _tokenA Address of the first token.
     * @param _tokenB Address of the second token.
     * @param amountADesired Desired amount of token A.
     * @param amountBDesired Desired amount of token B.
     * @param amountAMin Minimum amount of token A accepted.
     * @param amountBMin Minimum amount of token B accepted.
     * @param to Address receiving liquidity tokens.
     * @param deadline Unix timestamp after which the tx will revert.
     * @return amountA Final amount of token A added.
     * @return amountB Final amount of token B added.
     * @return liquidity Amount of liquidity tokens minted.
    */
    function addLiquidity(
        address _tokenA,
        address _tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external isExpired(deadline) 
    returns (uint amountA, uint amountB, uint liquidity) {
        address cacheTokenA = tokenA;
        address cacheTokenB = tokenB;
        require((_tokenA == cacheTokenA && _tokenB == cacheTokenB) || (_tokenA == cacheTokenB && _tokenB == cacheTokenA), "Invalid Tokens");
        (amountA, amountB) = _calculateOptimalAmounts(
                                                        amountADesired,
                                                        amountBDesired,
                                                        amountAMin,
                                                        amountBMin
                                                    );

        _transferTokensFrom(_tokenA, _tokenB, to, amountA, amountB);
        liquidity = _mintLiquidity(to, amountA, amountB);

        emit LiquidityAdded(to, amountA, amountB, liquidity);
        return (amountA, amountB, liquidity);
    }

    /*
     * @notice Calculates the optimal amounts of tokens A and B to add as liquidity to maintain the pool ratio
     * @dev Uses current reserves to maintain proportional balance; reverts if optimal amounts are below minimums
     * @param amountADesired The desired amount of token A to add
     * @param amountBDesired The desired amount of token B to add
     * @param amountAMin The minimum acceptable amount of token A
     * @param amountBMin The minimum acceptable amount of token B
     * @return amountA The final amount of token A to be added
     * @return amountB The final amount of token B to be added
    */
    function _calculateOptimalAmounts(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) view  private returns (uint amountA, uint amountB) {

        uint _reserveA = reserveA;
        uint _reserveB = reserveB;

        if (_reserveA == 0 && _reserveB == 0) {
            return (amountADesired, amountBDesired);
        }

        uint amountBOptimal = (amountADesired * _reserveB) / _reserveA;
        if (amountBOptimal <= amountBDesired) {
            require(amountBOptimal >= amountBMin, "Insufficient B amount");
            return (amountADesired, amountBOptimal);
        } else {
            uint amountAOptimal = (amountBDesired * _reserveA) / _reserveB;
            require(amountAOptimal >= amountAMin, "Insufficient A amount");
            return (amountAOptimal, amountBDesired);
        }
    }

    /*
     * @notice Transfers the specified amounts of two tokens from a user to this contract
     * @dev Assumes that the contract has been approved to spend the given token amounts on behalf of the user
     * @param _tokenA The address of the first ERC20 token
     * @param _tokenB The address of the second ERC20 token
     * @param to The address from which the tokens will be transferred
     * @param amountA The amount of tokenA to transfer
     * @param amountB The amount of tokenB to transfer
    */
    function _transferTokensFrom(
        address _tokenA,
        address _tokenB,
        address to,
        uint256 amountA,
        uint256 amountB
    ) private {
        require(IERC20(_tokenA).transferFrom(to, address(this), amountA), "Transfer A failed");
        require(IERC20(_tokenB).transferFrom(to, address(this), amountB), "Transfer B failed");
    }

    /*
    * @notice Calculates and mints liquidity tokens to the given address based on provided token amounts
    * @dev Uses the square root formula for initial liquidity, and proportional allocation otherwise.
    * Updates internal reserves and total liquidity.
    * @param to The address that will receive the minted liquidity tokens
    * @param amountA The amount of tokenA provided
    * @param amountB The amount of tokenB provided
    * @return liquidity The amount of liquidity tokens minted
    */
    function _mintLiquidity(
        address to,
        uint256 amountA,
        uint256 amountB
    ) private returns (uint liquidity) {
        uint _reserveA = reserveA;
        uint _reserveB = reserveB;
        uint _totalLiquidity = totalSupply();

        if (_totalLiquidity == 0) {
            liquidity = sqrt(amountA * amountB);
        } else {
            liquidity = min(
                (amountA * _totalLiquidity) / _reserveA,
                (amountB * _totalLiquidity) / _reserveB
            );
        }

        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_CALC");

        reserveA = _reserveA + amountA;
        reserveB = _reserveB + amountB;

        _mint(to, liquidity);
    }



    /**
     * @notice Remove liquidity from the pool.
     * @param _tokenA Address of token A
     * @param _tokenB Address of token B
     * @param _liquidity Amount of liquidity tokens to burn
     * @param amountAMin Minimum amount of token A to withdraw
     * @param amountBMin Minimum amount of token B to withdraw
     * @param to Address to receive withdrawn tokens
     * @param deadline Unix timestamp after which the transaction will revert
     * @return amountA Amount of token A withdrawn
     * @return amountB Amount of token B withdrawn
     */
    function removeLiquidity(
        address _tokenA,
        address _tokenB,
        uint256 _liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external isExpired(deadline) returns (uint amountA, uint amountB) {
        address cacheTokenA = tokenA;
        address cacheTokenB = tokenB;
        require((_tokenA == cacheTokenA && _tokenB == cacheTokenB) || (_tokenA == cacheTokenB && _tokenB == cacheTokenA), "Invalid Tokens");
        require(_liquidity > 0, "INSUFFICIENT_LIQUIDITY");
        require(balanceOf(to) >= _liquidity, "INSUFFICIENT_BALANCE");

        uint _totalSupply = totalSupply();
        uint _reserveA = reserveA;
        uint _reserveB = reserveB;

        amountA = (_liquidity * _reserveA) / _totalSupply;
        amountB = (_liquidity * _reserveB) / _totalSupply;

        require(amountA >= amountAMin, "INSUFFICIENT_A_AMOUNT");
        require(amountB >= amountBMin, "INSUFFICIENT_B_AMOUNT");

        _burn(to, _liquidity);
        reserveA = _reserveA - amountA;
        reserveB = _reserveB - amountB;

        require(IERC20(_tokenA).transfer(to, amountA));
        require(IERC20(_tokenB).transfer(to, amountB));

        emit LiquidityRemoved(to, amountA, amountB);
    }
    

    /**
    * @notice Swaps an exact amount of one token for another.
    * @dev Only supports direct pair swaps. Emits {TokensSwapped}.
    * @param amountIn Input amount of the token.
    * @param amountOutMin Minimum output amount expected.
    * @param path Path [tokenIn, tokenOut].
    * @param to Address receiving the output tokens.
    * @param deadline Expiration timestamp.
    * @return amounts Array [amountIn, amountOut] for confirmation.
    */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external isExpired(deadline) returns (uint256[2] memory amounts) {
        (bool isAToB, uint reserveIn, uint reserveOut) = validateAndGetReserves(path);

        uint amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");

        require(IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn));
        require(IERC20(path[1]).transfer(to, amountOut));

        if (isAToB) {
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            reserveB += amountIn;
            reserveA -= amountOut;
        }
        amounts = [amountIn, amountOut];

        emit TokensSwapped(to, amountIn, amountOut, isAToB);
    }

    /*
     * @notice Validates the token path and retrieves the corresponding reserves
     * @dev Ensures the swap path is valid (only tokenA <-> tokenB supported) and prepares reserves for the swap
     * @param path An array of two token addresses representing the swap direction [tokenIn, tokenOut]
     * @return isAToB True if the direction is from tokenA to tokenB, false if from tokenB to tokenA
     * @return reserveIn The reserve of the input token
     * @return reserveOut The reserve of the output token
     */
    function validateAndGetReserves(
        address[] calldata path
    ) private view returns (bool isAToB, uint reserveIn, uint reserveOut) {
        require(path.length == 2, "ONLY_PAIRS_SUPPORTED");

        address _tokenA = tokenA;
        address _tokenB = tokenB;

        bool isBToA = (path[0] == _tokenB && path[1] == _tokenA);
        isAToB = (path[0] == _tokenA && path[1] == _tokenB);
        require(isAToB || isBToA, "INVALID_PATH");

        uint _reserveA = reserveA;
        uint _reserveB = reserveB;

        reserveIn = isAToB ? _reserveA : _reserveB;
        reserveOut = isAToB ? _reserveB : _reserveA;
    }

    /**
     * @notice Get the price of one token in terms of the other.
     * @param _tokenA Base token address
     * @param _tokenB Quote token address
     * @return price Price of _tokenA in units of _tokenB, scaled by 1e18
     */
    function getPrice(
        address _tokenA,
        address _tokenB
    ) external view returns (uint256 price) {
        address cacheTokenA = tokenA;
        address cacheTokenB = tokenB;
        require((_tokenA == cacheTokenA && _tokenB == cacheTokenB) || (_tokenA == cacheTokenB && _tokenB == cacheTokenA), "Invalid Tokens");
        uint rA = reserveA;
        uint rB = reserveB;

        if (_tokenA == cacheTokenA) {
            require(rA > 0, "NO_LIQUIDITY");
            return (rB * 1e18) / rA;
        }
        
        require(rB > 0, "NO_LIQUIDITY");
        return (rA * 1e18) / rB;
    }

    /**
     * @notice Calculate the output amount for a given input amount and reserves.
     * @param amountIn Amount of input token
     * @param reserveIn Reserve of input token
     * @param reserveOut Reserve of output token
     * @return amountOut Calculated amount of output token
     */
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256 amountOut){
        require(amountIn > 0, "Insufficient input amount");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient Liquidity");
        uint numerator = amountIn * reserveOut;
        uint denominator = reserveIn + amountIn;
        amountOut = numerator / denominator;
        return amountOut;
    }

    /** 
    * @notice Utility function: Minimum of two uint values
    * @param x Number 1 to be compared
    * @param y Number 2 to be compared
    */
    function min(uint x, uint y) internal pure returns (uint) {
        return x < y ? x : y;
    }

    /**
    *  @notice Utility function: Square root
    *  @param y Number to take square root
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
}
```

## Contract: Token.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Token is ERC20 {
    constructor(string memory name, string memory symbol, address recipient) ERC20(name, symbol) {
        _mint(recipient, 100000 * 10 ** decimals());
    }
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
```

## Tests: SimpleSwap.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther, MaxUint256 } = require("ethers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");


/**
* @notice Deploys two ERC20 tokens and the SimpleSwap contract before each test.
* @dev Also transfers 1000 tokens of each type to user1 and approves the swap contract.
*/
describe("SimpleSwap", function () {
  let owner, user1, user2;
  let tokenA, tokenB, swap;

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token");
    tokenA = await Token.deploy("TokenA", "TKA", owner.address);
    tokenB = await Token.deploy("TokenB", "TKB", owner.address);
    await tokenA.waitForDeployment();
    await tokenB.waitForDeployment();

    const SimpleSwap = await ethers.getContractFactory("SimpleSwap");
    swap = await SimpleSwap.deploy(tokenA.getAddress(), tokenB.getAddress());
    await swap.waitForDeployment();
    
    await tokenA.transfer(user1.getAddress(), parseEther("1000"));
    await tokenB.transfer(user1.getAddress(), parseEther("1000"));

    await tokenA.connect(user1).approve(swap.getAddress(), MaxUint256);
    await tokenB.connect(user1).approve(swap.getAddress(), MaxUint256);
  });

  /**
   * @notice Tests for the addLiquidity function of the SimpleSwap contract.
   */
  describe("addLiquidity", function () {
    /**
    * @notice Adds initial liquidity to an empty pool.
    * @dev Checks the LiquidityAdded event is emitted with correct parameters.
    */
    it("should add initial liquidity to empty pool", async () => {
      const deadline = Math.floor(Date.now() / 1000) + 1000;
      const tx = await swap.connect(user1).addLiquidity(
        tokenA.getAddress(),
        tokenB.getAddress(),
        parseEther("100"),
        parseEther("200"),
        0,
        0,
        user1.getAddress(),
        deadline
      );

      await expect(tx).to.emit(swap, "LiquidityAdded")
        .withArgs(
          user1.getAddress(),
          parseEther("100"),
          parseEther("200"),
          anyValue
        );
    });
  });

  /**
  * @notice Adds liquidity again using tokenA as limiting token when tokenB is limiting.
  * @dev Verifies the liquidity added respects the optimal amounts according to reserves.
  */
  it("should add liquidity using optimal A if B is limiting", async () => {
    const deadline = Math.floor(Date.now() / 1000) + 1000;

    await swap.connect(user1).addLiquidity(
      tokenA.getAddress(),
      tokenB.getAddress(),
      parseEther("100"),
      parseEther("200"),
      0,
      0,
      user1.getAddress(),
      deadline
    );

    const tx = await swap.connect(user1).addLiquidity(
      tokenA.getAddress(),
      tokenB.getAddress(),
      parseEther("200"),   
      parseEther("50"),    
      parseEther("25"),    
      parseEther("50"),    
      user1.getAddress(),
      deadline
    );

    await expect(tx).to.emit(swap, "LiquidityAdded")
      .withArgs(user1.getAddress(), parseEther("25"), parseEther("50"), anyValue);
  });

  
  /**
  * @notice Adds liquidity swapping the order of token addresses (tokenB as tokenA and tokenA as tokenB).
  * @dev Should still succeed and emit LiquidityAdded event.
  */
  it("should add liquidity using tokenB as tokenA and tokenA as tokenB", async () => {
    
    const deadline = Math.floor(Date.now() / 1000) + 1000;
    await expect(
    swap.connect(user1).addLiquidity(
      tokenB.getAddress(),
      tokenA.getAddress(),
      parseEther("200"),
      parseEther("100"),
      0,
      0,
      user1.getAddress(),
      deadline
    )
  ).to.emit(swap, "LiquidityAdded");
  });

  /**
  * @notice Reverts when addLiquidity is called with invalid token addresses.
  * @dev Uses an address that is not tokenA or tokenB and expects revert with "Invalid Tokens".
  */
  it("should revert addLiquidity with invalid tokens", async () => {
    const deadline = Math.floor(Date.now() / 1000) + 1000;
    await expect(
      swap.connect(user1).addLiquidity(
        user1.getAddress(),  // dirección inválida que no es tokenA ni tokenB
        tokenB.getAddress(),
        parseEther("100"),
        parseEther("200"),
        0,
        0,
        user1.getAddress(),
        deadline
      )
    ).to.be.revertedWith("Invalid Tokens");
  });

  /**
    * @notice Reverts when addLiquidity is called with a deadline timestamp in the past.
    * @dev Expects revert with "Expired" error.
    */
  it("should revert addLiquidity with expired deadline", async () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 10; // tiempo pasado
    await expect(
      swap.connect(user1).addLiquidity(
        tokenA.getAddress(),
        tokenB.getAddress(),
        parseEther("100"),
        parseEther("200"),
        0,
        0,
        user1.getAddress(),
        pastDeadline
      )
    ).to.be.revertedWith("Expired");
  });

  /**
  * @notice Tests for the removeLiquidity function.
  */
  describe("removeLiquidity", function () {
    beforeEach(async () => {
      const deadline = Math.floor(Date.now() / 1000) + 1000;
      await swap.connect(user1).addLiquidity(
        tokenA.getAddress(),
        tokenB.getAddress(),
        parseEther("100"),
        parseEther("200"),
        0,
        0,
        user1.getAddress(),
        deadline
      );
    });

    /**
    * @notice Removes liquidity and checks that tokens are transferred back to the user.
    * @dev Asserts user token balances increased accordingly.
    */
    it("should remove liquidity and transfer tokens", async () => {
      const deadline = Math.floor(Date.now() / 1000) + 1000;
      const liquidityBalance = await swap.balanceOf(user1.getAddress());

      await swap.connect(user1).removeLiquidity(
        tokenA.getAddress(),
        tokenB.getAddress(),
        liquidityBalance,
        0,
        0,
        user1.getAddress(),
        deadline
      );

      expect(await tokenA.balanceOf(user1.getAddress())).to.be.above(parseEther("900"));
      expect(await tokenB.balanceOf(user1.getAddress())).to.be.above(parseEther("800"));
    });


    /**
    * @notice Reverts if a user tries to remove liquidity without sufficient balance.
    * @dev Expects revert with "INSUFFICIENT_BALANCE".
    */
    it("should revert removeLiquidity if liquidity balance insufficient", async () => {
      const deadline = Math.floor(Date.now() / 1000) + 1000;
      await swap.connect(user1).addLiquidity(
        tokenA.getAddress(),
        tokenB.getAddress(),
        parseEther("100"),
        parseEther("200"),
        0,
        0,
        user1.getAddress(),
        deadline
      );

      await expect(
        swap.connect(user2).removeLiquidity(
          tokenA.getAddress(),
          tokenB.getAddress(),
          parseEther("1"), // user2 tiene 0 liquidity
          0,
          0,
          user2.getAddress(),
          deadline
        )
      ).to.be.revertedWith("INSUFFICIENT_BALANCE");
    });
  });

  /**
  * @notice Tests for the swapExactTokensForTokens function.
  */
  describe("swapExactTokensForTokens", function () {
    beforeEach(async () => {
      const deadline = Math.floor(Date.now() / 1000) + 1000;
      await swap.connect(user1).addLiquidity(
        tokenA.getAddress(),
        tokenB.getAddress(),
        parseEther("100"),
        parseEther("200"),
        0,
        0,
        user1.getAddress(),
        deadline
      );
      await tokenA.transfer(user2.getAddress(), parseEther("10"));
      await tokenA.connect(user2).approve(swap.getAddress(), MaxUint256);
    });

    /**
    * @notice Swaps token A for token B.
    * @dev Verifies that user2 receives some amount of token B.
    */
    it("should swap token A for B", async () => {
      const deadline = Math.floor(Date.now() / 1000) + 1000;
      const path = [tokenA.getAddress(), tokenB.getAddress()];
      const tx = await swap.connect(user2).swapExactTokensForTokens(
        parseEther("10"),
        0,
        path,
        user2.getAddress(),
        deadline
      );

      const balanceOut = await tokenB.balanceOf(user2.getAddress());
      expect(balanceOut).to.be.gt(0);
    });

  /**
  * @notice Reverts if swapExactTokensForTokens is called with a path longer than 2 tokens.
  * @dev Expects revert with "ONLY_PAIRS_SUPPORTED".
  */
  it("should revert swapExactTokensForTokens with invalid path length", async () => {
    const deadline = Math.floor(Date.now() / 1000) + 1000;
    const invalidPath = [tokenA.getAddress(), tokenB.getAddress(), tokenA.getAddress()];
    await expect(
      swap.connect(user1).swapExactTokensForTokens(
        parseEther("10"),
        0,
        invalidPath,
        user1.getAddress(),
        deadline
      )
    ).to.be.revertedWith("ONLY_PAIRS_SUPPORTED");
  });

  /**
  * @notice Reverts if swapExactTokensForTokens is called with an expired deadline.
  * @dev Expects revert with "Expired".
  */
  it("should revert swapExactTokensForTokens with expired deadline", async () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 10;
    const path = [tokenA.getAddress(), tokenB.getAddress()];
    await expect(
      swap.connect(user1).swapExactTokensForTokens(
        parseEther("10"),
        0,
        path,
        user1.getAddress(),
        pastDeadline
      )
    ).to.be.revertedWith("Expired");
  });

  /**
  * @notice Reverts if swapExactTokensForTokens is called with an invalid token path.
  * @dev Expects revert with "INVALID_PATH".
  */
  it("should revert swapExactTokensForTokens with invalid token path", async () => {
    const deadline = Math.floor(Date.now() / 1000) + 1000;
    const invalidPath = [tokenA.getAddress(), user2.getAddress()]; // user2 no es token
    await expect(
      swap.connect(user1).swapExactTokensForTokens(
        parseEther("10"),
        0,
        invalidPath,
        user1.getAddress(),
        deadline
      )
    ).to.be.revertedWith("INVALID_PATH");
  });

  /**
  * @notice Swaps token B for token A.
  * @dev Verifies user2 receives some amount of token A.
  */
  it("should swap token B for A", async () => {
    await tokenB.transfer(user2.getAddress(), parseEther("10"));
    await tokenB.connect(user2).approve(swap.getAddress(), MaxUint256);
    const deadline = Math.floor(Date.now() / 1000) + 1000;
    const path = [tokenB.getAddress(), tokenA.getAddress()];
    const tx = await swap.connect(user2).swapExactTokensForTokens(
      parseEther("10"),
      0,
      path,
      user2.getAddress(),
      deadline
    );

    const balanceOut = await tokenA.balanceOf(user2.getAddress());
    expect(balanceOut).to.be.gt(0);
  });
});


  /**
  * @notice Tests for the getPrice function.
  */
  describe("getPrice", function () {
    /**
    * @notice Returns price of token A over token B.
    * @dev After adding liquidity with ratio 100:200, price should be 2.
    */
    it("should return the price of A over B", async () => {
      const deadline = Math.floor(Date.now() / 1000) + 1000;
      await swap.connect(user1).addLiquidity(
        tokenA.getAddress(),
        tokenB.getAddress(),
        parseEther("100"),
        parseEther("200"),
        0,
        0,
        user1.getAddress(),
        deadline
      );
      const price = await swap.getPrice(tokenA.getAddress(), tokenB.getAddress());
      expect(price).to.equal(parseEther("2"));
    });


    /**
    * @notice Returns price of token B over token A.
    * @dev After adding liquidity with ratio 100:200 but inverted tokens, price should be 0.5.
    */
    it("should return the price of B over A", async () => {
      const deadline = Math.floor(Date.now() / 1000) + 1000;
      await swap.connect(user1).addLiquidity(
        tokenB.getAddress(),
        tokenA.getAddress(),
        parseEther("100"),
        parseEther("200"),
        0,
        0,
        user1.getAddress(),
        deadline
      );
      const price = await swap.getPrice(tokenB.getAddress(), tokenA.getAddress());
      expect(price).to.equal(parseEther("0.5"));
    });


    /**
    * @notice Reverts if getPrice is called with invalid token addresses.
    * @dev Expects revert with "Invalid Tokens".
    */
    it("should revert getPrice with invalid tokens", async () => {
      await expect(
        swap.getPrice(user1.getAddress(), user2.getAddress())
      ).to.be.revertedWith("Invalid Tokens");
    });
  });

  /**
  * @notice Tests for the getAmountOut function.
  */
  describe("getAmountOut", function () {

    /**
    * @notice Calculates output amount for a given input amount and reserves.
    * @dev Checks calculation correctness against expected value.
    */
    it("should calculate output amount correctly", async () => {
      const amountOut = await swap.getAmountOut(
        parseEther("10"),
        parseEther("100"),
        parseEther("200")
      );
      expect(amountOut).to.equal(parseEther("18.181818181818181818"));
    });

    /**
    * @notice Reverts if input amount is zero.
    * @dev Expects revert with "Insufficient input amount".
    */
    it("should revert getAmountOut with zero amountIn", async () => {
      await expect(
        swap.getAmountOut(
          0, 
          parseEther("100"), 
          parseEther("100")
        )).to.be.revertedWith("Insufficient input amount");
    });

    /**
    * @notice Reverts if any reserve is zero.
    * @dev Expects revert with "Insufficient Liquidity".
    */
    it("should revert getAmountOut with zero reserves", async () => {
      await expect(swap.getAmountOut(parseEther("10"), 0, parseEther("100"))).to.be.revertedWith("Insufficient Liquidity");
      await expect(swap.getAmountOut(parseEther("10"), parseEther("100"), 0)).to.be.revertedWith("Insufficient Liquidity");
    });

  });


  /**
  * @title Token Minting Tests
  * @notice Tests for the minting functionality of the ERC20 Token contract.
  */
  describe("Token Minting", function () {
    let owner, user1;
    let token;

    /**
    * @notice Deploys a fresh instance of the Token contract before each test.
    * Initializes signers: owner and user1.
    */
    beforeEach(async () => {
      [owner, user1] = await ethers.getSigners();

      const Token = await ethers.getContractFactory("Token");
      token = await Token.deploy("MyToken", "MTK", owner.address);
      await token.waitForDeployment();
    });

    /**
    * @notice Should mint tokens to a specified address.
    * @dev
    * - Records initial total supply.
    * - Mints `amount` tokens to `user1.address`.
    * - Verifies that the balance of `user1` increases by `amount`.
    * - Verifies that total supply increases by `amount`.
    */
    it("should mint tokens to a specified address", async function () {
      const amount = parseEther("100");

      const initialSupply = await token.totalSupply();

      await token.mint(user1.address, amount);

      expect(await token.balanceOf(user1.address)).to.equal(amount);

      const newSupply = await token.totalSupply();
      expect(newSupply).to.equal(initialSupply + amount);
    });

  })

  /// @title Test: Liquidity minting for minimum sqrt path
  /// @notice Covers the code path where sqrt(y) returns 1 when y is between 1 and 3
  describe("Edge Case Liquidity Minting", function () {
  
    /**
    * @notice Tests minting liquidity when the product of amountA and amountB is 1
    * @dev Ensures the sqrt function returns z = 1, covering the `z = 1` branch in the contract.
    * This test helps reach full coverage on the `sqrt(uint)` internal helper function.
    */
    it("should mint liquidity = 1 when amountA * amountB = 1", async () => {
      const deadline = Math.floor(Date.now() / 1000) + 1000;

      const tinyAmount = ethers.toBigInt(1); // 1 wei

      // Add minimal liquidity to trigger the sqrt edge case
      await swap.connect(user1).addLiquidity(
        tokenA.getAddress(),
        tokenB.getAddress(),
        tinyAmount,
        tinyAmount,
        0,
        0,
        user1.getAddress(),
        deadline
      );

      // Expect minted liquidity tokens to equal 1 (sqrt(1 * 1) = 1)
      const liquidity = await swap.balanceOf(user1.getAddress());
      expect(liquidity).to.equal(1n);
    });
  });
});
```
