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
