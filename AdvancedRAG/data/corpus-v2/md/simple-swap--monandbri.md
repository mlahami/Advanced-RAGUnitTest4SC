# simple-swap--monandbri

- domain: amm-dex (amm-dex)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/MonAndBri/Modulo4_ETH_Kipu_SimpleSwap @ cf5cf040daef809a59a3bc57d609abf9a485aa9e
- license: MIT
- targets: SimpleSwap.sol
- validation: 27 passing tests, 0 failing; statement coverage SimpleSwap.sol 98.67 %

## Contract: SimpleSwap.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title ERC-20 Interface
/// @notice Interface for interacting with ERC-20 tokens
interface IERC20 {
    /// @notice Returns the total number of tokens in existence
    function totalSupply() external view returns (uint256);

    /// @notice Returns the number of tokens owned by `account`
    function balanceOf(address account) external view returns (uint256);

    /// @notice Transfers `amount` tokens to `recipient`
    /// @param recipient The address to transfer tokens to
    /// @param amount The amount of tokens to transfer
    function transfer(address recipient, uint256 amount)
        external
        returns (bool);

    /// @notice Returns the remaining number of tokens that `spender` can spend on behalf of `owner`
    function allowance(address owner, address spender)
        external
        view
        returns (uint256);

    /// @notice Sets `amount` as the allowance of `spender` over the caller’s tokens
    /// @param spender The address that will spend the tokens
    /// @param amount The number of tokens allowed
    function approve(address spender, uint256 amount) external returns (bool);

    /// @notice Transfers `amount` tokens from `sender` to `recipient` using the allowance mechanism
    /// @param sender The address from which tokens are transferred
    /// @param recipient The address to which tokens are transferred
    /// @param amount The number of tokens to transfer
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);

    /// @notice Emitted when `value` tokens are moved from one account (`from`) to another (`to`)
    event Transfer(address indexed from, address indexed to, uint256 value);

    /// @notice Emitted when the allowance of a `spender` for an `owner` is set by a call to `approve`
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 value
    );
}

/// @title SimpleSwap - A simplified Uniswap-like AMM for a single token pair without fees.
/// @author Monica Andrea Brito
/// @notice Allows adding/removing liquidity, swapping tokens, getting prices and calculating output amounts.
/// @dev This contract handles a single pair of ERC20 tokens, with internal liquidity management and no fees.
///      This contract mints "virtual LP tokens" to represent ownership, tracked via `liquidityBalance`, 
///      not a real ERC20
contract SimpleSwap {
    /// @notice Total amount of liquidity tokens minted
    /// @dev Tracks overall liquidity supply in the pool
    uint256 public totalLiquidity;

    /// @notice Reserve of token A held in the liquidity pool
    /// @dev Updated on every liquidity addition, removal, or swap to track pool balance
    uint256 public reserveA;

    /// @notice Reserve of token B held in the liquidity pool
    /// @dev Updated on every liquidity addition, removal, or swap to track pool balance
    uint256 public reserveB;

    
    /// @notice Address of the first ERC20 token in the pair
    /// @dev Used to identify and interact with token A in the pair
    IERC20 public tokenA;

    /// @notice Address of the second ERC20 token in the pair
    /// @dev Used to identify and interact with token B in the pair
    IERC20 public tokenB;

    /// @notice Mapping of user addresses to their virtual liquidity token balances
    /// @dev Virtual LP tokens represent ownership shares; not an ERC20 token
    mapping(address => uint256) public liquidityBalance;

    /// @notice Emitted when liquidity is added
    /// @param provider Address adding liquidity
    /// @param amountA Amount of token A supplied
    /// @param amountB Amount of token B supplied
    /// @param liquidityMinted Amount of LP tokens minted
    event LiquidityAdded(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidityMinted
    );

    /// @notice Emitted when a token swap is done
    /// @param swapper Address that performs swap
    /// @param amountIn Input token amount
    /// @param amountOut Output token amount
    /// @param tokenIn Address of input token
    /// @param tokenOut Address of output token
    event TokensSwapped(
        address indexed swapper,
        uint256 amountIn,
        uint256 amountOut,
        address tokenIn,
        address tokenOut
    );

    /// @notice Emitted when liquidity is removed
    /// @param provider Address removing liquidity
    /// @param amountA Amount of token A returned
    /// @param amountB Amount of token B returned
    /// @param liquidityBurned Amount of LP tokens burned
    event LiquidityRemoved(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidityBurned
    );

    /// @notice Initializes the contract with two ERC20 token addresses
    /// @dev Reverts if tokens are identical or any address is the zero address
    /// @param _tokenA Address of the first token (tokenA)
    /// @param _tokenB Address of the second token (tokenB)
    constructor(address _tokenA, address _tokenB) {
        require(_tokenA != _tokenB, "Identical token addresses");
        require(
            _tokenA != address(0) && _tokenB != address(0),
            "Zero address tokens"
        );
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    /// @notice Ensures the token pair matches the initialized tokenA/tokenB
    /// @param _tokenA The address of the first token
    /// @param _tokenB The address of the second token
    modifier validTokenPair(address _tokenA, address _tokenB) {
        require(
            _tokenA == address(tokenA) && _tokenB == address(tokenB),
            "Invalid tokens"
        );
        _;
    }

    /// @notice Ensures that the transaction has not expired
    /// @param deadline Timestamp after which the transaction is invalid
    modifier notExpired(uint256 deadline) {
        require(block.timestamp <= deadline, "Transaction expired");
        _;
    }

    /// @notice Ensures the recipient address is not the zero address
    /// @param to The address that will receive tokens
    modifier validRecipient(address to) {
        require(to != address(0), "Invalid recipient");
        _;
    }

    /// @notice Adds liquidity to the token pair pool
    /// @dev Mints LP tokens based on reserves or initial liquidity formula
    /// @param addTokenA Address of token A
    /// @param addTokenB Address of token B
    /// @param amountADesired Desired amount of token A to add
    /// @param amountBDesired Desired amount of token B to add
    /// @param amountAMin Minimum amount of token A to add (slippage protection)
    /// @param amountBMin Minimum amount of token B to add (slippage protection)
    /// @param to Address that will receive the minted LP tokens
    /// @param deadline Expiration timestamp for this transaction
    /// @return amountA Actual amount of token A added
    /// @return amountB Actual amount of token B added
    /// @return liquidity Amount of liquidity tokens minted
    function addLiquidity(
        address addTokenA,
        address addTokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    )
        external
        validTokenPair(addTokenA, addTokenB)
        notExpired(deadline)
        validRecipient(to)
        returns (
            uint256 amountA,
            uint256 amountB,
            uint256 liquidity
        )
    {

        (amountA, amountB, liquidity) = _calculateAmountsAndLiquidity(
            amountADesired, amountBDesired, amountAMin, amountBMin
        );
        
        _performStateUpdate(amountA, amountB, liquidity, to);

        require(
            IERC20(addTokenA).transferFrom(msg.sender, address(this), amountA),
            "Transfer tokenA failed"
        );
        require(
            IERC20(addTokenB).transferFrom(msg.sender, address(this), amountB),
            "Transfer tokenB failed"
        );

        emit LiquidityAdded(to, amountA, amountB, liquidity);

        return(amountA, amountB, liquidity);
    }

    /// @dev Uses internal reserves to determine optimal token ratios and validates slippage limits
    /// @param amountADesired Desired amount of token A to add
    /// @param amountBDesired Desired amount of token B to add
    /// @param amountAMin Minimum acceptable amount of token A (slippage protection)
    /// @param amountBMin Minimum acceptable amount of token B (slippage protection)
    /// @return amountA Final amount of token A to be added to the pool
    /// @return amountB Final amount of token B to be added to the pool
    /// @return liquidity Amount of liquidity tokens to be minted
    function _calculateAmountsAndLiquidity(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin, 
        uint256 amountBMin
    ) internal view returns (uint256 amountA, uint256 amountB, uint256 liquidity) {

        uint256 _totalLiquidity = totalLiquidity;
        uint256 _reserveA = reserveA;
        uint256 _reserveB = reserveB;

        (amountA, amountB) = _calculateOptimalAmounts(amountADesired, amountBDesired,
             _totalLiquidity, _reserveA, _reserveB );

        require(amountA >= amountAMin, "amountA < amountAMin");
        require(amountB >= amountBMin, "amountB < amountBMin");

        liquidity = _calculateLiquidityToMint(amountA, amountB, _totalLiquidity, _reserveA, _reserveB);
        require(liquidity > 0, "Insufficient liquidity minted");

        return(amountA, amountB, liquidity);
    }

    /// @dev Maintains the token ratio of the pool to avoid price shift
    /// @param amountADesired Desired amount of token A
    /// @param amountBDesired Desired amount of token B
    /// @param _totalLiquidity Current total liquidity in the pool
    /// @param _reserveA Reserve amount of token A
    /// @param _reserveB Reserve amount of token B
    /// @return amountA Optimal amount of token A to add
    /// @return amountB Optimal amount of token B to add
    function _calculateOptimalAmounts(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 _totalLiquidity, 
        uint256 _reserveA, 
        uint256 _reserveB
    ) internal pure returns (uint256 amountA, uint256 amountB ) {

        if (_totalLiquidity == 0) {
            return (amountADesired, amountBDesired);
        }

        uint256 amountBOptimal = (amountADesired * _reserveB) / _reserveA;
        if (amountBOptimal <= amountBDesired) {
            return (amountADesired, amountBOptimal);
        } else {
            uint256 amountAOptimal = (amountBDesired * _reserveA) / _reserveB;
            require(amountAOptimal <= amountADesired, "Insufficient A amount");
            return (amountAOptimal, amountBDesired);
        }
    }

    /// @dev Uses _sqrt for first liquidity; else, proportional to reserves
    /// @param amountA Supplied amount of token A
    /// @param amountB Supplied amount of token B
    /// @param _totalLiquidity Current total liquidity
    /// @param _reserveA Current reserve of token A
    /// @param _reserveB Current reserve of token B
    /// @return liquidity Amount of liquidity to mint
    function _calculateLiquidityToMint(uint256 amountA, uint256 amountB,
         uint256 _totalLiquidity, uint256 _reserveA, uint256 _reserveB)
        internal pure 
        returns (uint256 liquidity)
    {
        if (_totalLiquidity == 0) {
            return _sqrt(amountA * amountB);
        }

        uint256 liquidityA = (amountA * _totalLiquidity) / _reserveA;
        uint256 liquidityB = (amountB * _totalLiquidity) / _reserveB;
        return liquidityA < liquidityB ? liquidityA : liquidityB;
    }

    /// @dev Called after calculating amounts and before transfers
    /// @param amountA Amount of token A added
    /// @param amountB Amount of token B added
    /// @param liquidity Liquidity tokens to credit
    /// @param to Address receiving the liquidity
    function _performStateUpdate(
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity,
        address to
    ) internal {
        reserveA += amountA;
        reserveB += amountB;
        liquidityBalance[to] += liquidity;
        totalLiquidity += liquidity;

        return;
    }

    /// @notice Returns the price of tokenA in terms of tokenB
    /// @dev Computes price as reserveB / reserveA, scaled by 1e18 for fixed-point precision
    /// @param _tokenA Address of token A (must match contract tokenA)
    /// @param _tokenB Address of token B (must match contract tokenB)
    /// @return price Current price of tokenA denominated in tokenB, scaled by 1e18
    function getPrice(address _tokenA, address _tokenB)
        external
        view
        validTokenPair(_tokenA, _tokenB)
        returns (uint256 price)
    {
        // Calculate price as tokenB per tokenA using pool reserves
        // Multiply by 1e18 to maintain fixed-point precision
        uint256 _reserveA = reserveA;

        require(_reserveA > 0, "Zero reserveA");

        return (reserveB * 1e18) / _reserveA;
        
    }

    /// @notice Calculates the amount of output tokens for a given input
    /// @dev Uses constant product formula without fees
    /// @param amountIn Input token amount
    /// @param amountA Reserve of input token A
    /// @param amountB Reserve of output token B
    /// @return amountOut Calculated output amount
    function getAmountOut(
        uint256 amountIn,
        uint256 amountA,
        uint256 amountB
    ) public pure returns (uint256 amountOut) {
        // Input must be greater than zero
        require(amountIn > 0, "Insufficient input amount");

        // Liquidity reserves must be greater than zero
        require(amountA > 0 && amountB > 0, "Insufficient liquidity");

        // Calculate output using the constant product formula (x * y = k)
        // Formula without fee
        return (amountIn * amountB) / (amountA + amountIn);

    }

    /// @notice Swaps an exact amount of input tokens for as many output tokens as possible
    /// @dev Supports only one path hop (tokenA <-> tokenB)
    /// @param amountIn Exact amount of input tokens to swap
    /// @param amountOutMin Minimum acceptable output tokens (slippage protection)
    /// @param path Array with 2 token addresses: [inputToken, outputToken]
    /// @param to Address to receive output tokens
    /// @param deadline Expiration timestamp for this swap
    /// @return amounts Array with input and output amounts: [amountIn, amountOut]
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external
        notExpired(deadline)
        validRecipient(to)
        returns (uint256[] memory amounts)
    {
        require(path.length == 2, "Path length must be 2");

        address tokenIn = path[0];
        address tokenOut = path[1];

        require(_isValidPair(tokenIn, tokenOut), "Invalid token pair");

        uint256 amountOut = _computeAndExecuteSwap(
            amountIn,
            amountOutMin
        );

        amounts = _buildSwapAmounts(amountIn, amountOut);

        _transferTokens(tokenIn, tokenOut, to, amountIn, amountOut);

        emit TokensSwapped(
            msg.sender,
            amountIn,
            amountOut,
            tokenIn,
            tokenOut
        );

        return amounts;
    }

    function _isValidPair(address tokenIn, address tokenOut) internal view returns (bool) {
        return
            (tokenIn == address(tokenA) && tokenOut == address(tokenB)) ||
            (tokenIn == address(tokenB) && tokenOut == address(tokenA));
    }

    /// @dev Performs both the transferFrom of input tokens and transfer of output tokens
    /// @param inputToken Address of the token being sent by the user
    /// @param outputToken Address of the token being received by the user
    /// @param to Recipient address receiving the output tokens
    /// @param amountIn Amount of input tokens to transfer from sender to contract
    /// @param amountOut Amount of output tokens to transfer from contract to recipient
    function _transferTokens(
        address inputToken, address outputToken, address to, uint256 amountIn, uint256 amountOut)
        internal
    {
        require(
            IERC20(inputToken).transferFrom(msg.sender, address(this), amountIn),
            "TransferFrom In failed"
        );

        require(
            IERC20(outputToken).transfer(to, amountOut),
            "Transfer Out failed"
        );

        return;
    }

    /// @dev Returns the current reserves of token A and token B in the pool.
    /// @return reserveA The reserve amount of token A.
    /// @return reserveB The reserve amount of token B.
    function _getReserves()
        internal
        view
        returns (uint256, uint256)
    {
        return (reserveA, reserveB);
    }

    /// @dev Updates the internal reserves by adding input and subtracting output amounts.
    /// Assumes amountIn is for token A and amountOut is for token B.
    /// @param amountIn Amount of token A added to the pool.
    /// @param amountOut Amount of token B removed from the pool.
    function _updateReserves(
        uint256 amountIn,
        uint256 amountOut
    ) internal {
        reserveA += amountIn;
        reserveB -= amountOut;
        return;
    }

    /// @dev Calculates the output amount based on current reserves, validates constraints, 
    /// and updates internal reserves accordingly.
    /// Uses the constant product formula without fees.
    /// @param amountIn Exact amount of input tokens provided for the swap.
    /// @param amountOutMin Minimum acceptable output amount to protect against slippage.
    /// @return amountOut Calculated amount of output tokens to be returned.    
    function _computeAndExecuteSwap(
        uint256 amountIn,
        uint256 amountOutMin
    ) internal returns (uint256 amountOut) {
        (uint256 reserveInput, uint256 reserveOutput) = _getReserves();

        require(amountIn > 0, "Insufficient input amount");
        require(
            reserveInput > 0 && reserveOutput > 0,
            "Insufficient liquidity"
        );

        amountOut = getAmountOut(amountIn, reserveInput, reserveOutput);
        require(amountOut >= amountOutMin, "Insufficient output amount");

        _updateReserves(amountIn, amountOut);

        return amountOut;
    }

    /// @dev Creates a fixed-size array [amountIn, amountOut] for return value formatting
    /// @param amountIn The amount of input tokens used in the swap
    /// @param amountOut The amount of output tokens received from the swap
    /// @return amounts An array with two elements: [amountIn, amountOut]
    function _buildSwapAmounts(uint256 amountIn, uint256 amountOut)
        internal
        pure
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    /// @notice Removes liquidity from the pool and returns underlying tokens to the user
    /// @dev Checks deadlines, validates inputs, updates balances, burns liquidity tokens, and emits event
    /// @param addTokenA Address of token A in the pair
    /// @param addTokenB Address of token B in the pair
    /// @param liquidity Amount of liquidity tokens to remove
    /// @param amountAMin Minimum acceptable amount of token A to receive
    /// @param amountBMin Minimum acceptable amount of token B to receive
    /// @param to Recipient address of withdrawn tokens
    /// @param deadline Timestamp after which the transaction is invalid
    /// @return amountA Amount of token A returned to the user
    /// @return amountB Amount of token B returned to the user
    function removeLiquidity(
        address addTokenA,
        address addTokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    )
        external
        validTokenPair(addTokenA, addTokenB)
        notExpired(deadline)
        validRecipient(to)
        returns (uint256 amountA, uint256 amountB)
    {
        require(liquidity > 0, "Zero liquidity");
        require(
            liquidityBalance[msg.sender] >= liquidity,
            "Not enough liquidity"
        );

        (amountA, amountB) = _calculateWithdrawAmounts(liquidity);

        _validateMinAmounts(amountA, amountB, amountAMin, amountBMin);

        _burnLiquidityAndUpdateState(msg.sender, liquidity, amountA, amountB);

        _transferTokensToUser(to, amountA, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB, liquidity);
    }

    /// @dev Proportionally computes amounts of tokenA and tokenB to return for given liquidity
    /// @param liquidity Amount of liquidity tokens to redeem
    /// @return amountA Amount of token A corresponding to the liquidity
    /// @return amountB Amount of token B corresponding to the liquidity
    function _calculateWithdrawAmounts(uint256 liquidity)
        internal
        view
        returns (uint256 amountA, uint256 amountB)
    {
        amountA = (liquidity * reserveA) / totalLiquidity;
        amountB = (liquidity * reserveB) / totalLiquidity;
    }

    /// @dev Checks that actual amounts are >= minimum amounts. Reverts otherwise.
    /// @param amountA Actual amount of token A.
    /// @param amountB Actual amount of token B.
    /// @param amountAMin Minimum required amount of token A.
    /// @param amountBMin Minimum required amount of token B.
    function _validateMinAmounts(
        uint256 amountA,
        uint256 amountB,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal pure {
        require(amountA >= amountAMin, "amountA < amountAMin");
        require(amountB >= amountBMin, "amountB < amountBMin");

        return;
    }

    /// @dev Burns liquidity tokens and updates reserves and user balances.
    /// @param user Address of the liquidity provider burning tokens.
    /// @param liquidity Amount of liquidity tokens to burn.
    /// @param amountA Amount of token A to withdraw from reserves.
    /// @param amountB Amount of token B to withdraw from reserves.
    function _burnLiquidityAndUpdateState(
        address user,
        uint256 liquidity,
        uint256 amountA,
        uint256 amountB
    ) internal {
        liquidityBalance[user] -= liquidity;
        totalLiquidity -= liquidity;
        reserveA -= amountA;
        reserveB -= amountB;

        return;
    }

    /// @dev Transfers the specified amounts of tokenA and tokenB to the user.
    /// @param to Address that will receive the tokens.
    /// @param amountA Amount of tokenA to transfer.
    /// @param amountB Amount of tokenB to transfer.
    function _transferTokensToUser(
        address to,
        uint256 amountA,
        uint256 amountB
    ) internal {
        require(IERC20(tokenA).transfer(to, amountA), "Transfer tokenA failed");
        require(IERC20(tokenB).transfer(to, amountB), "Transfer tokenB failed");

        return;
    }

    /// @dev Computes the square root of a given number using the Babylonian method.
    /// @param x The number to compute the square root of.
    /// @return y The integer square root of the input value.
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
```

## Contract: TokenA.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TokenA - Simple ERC20 token with minting functionality
contract TokenA is ERC20 {
    
     /// @notice Constructor mints initial supply to deployer
    constructor() ERC20("TokenA", "TKA") {
        _mint(msg.sender, 100000);
    }

    /// @notice Mint new tokens to specified address
    /// @param to Address to receive minted tokens
    /// @param amount Amount of tokens to mint
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
}
```

## Contract: TokenB.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TokenB - Simple ERC20 token with minting functionality
contract TokenB is ERC20 {
    
    /// @notice Constructor mints initial supply to deployer
    constructor() ERC20("TokenB", "TKB") {
        _mint(msg.sender, 100000);
    }

    /// @notice Mint new tokens to specified address
    /// @param to Address to receive minted tokens
    /// @param amount Amount of tokens to mint
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
}
```

## Tests: SimpleSwapTest.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SimpleSwap", function () {
    let SimpleSwap; // data contract needded for deployment
    let simpleSwap; // deployed contract

    let tokenA, tokenB, TokenA, TokenB;

    let owner, user1, addr1, user2;

    // beforeEach is excuted before each it
    // before is excuted only once and then runs every it
    before(async function () {
        [owner, user1, addr1, user2] = await ethers.getSigners();

        TokenA = await ethers.getContractFactory("TokenA");
        TokenB = await ethers.getContractFactory("TokenB");

        tokenA = await TokenA.deploy();
        await tokenA.waitForDeployment();

        tokenB = await TokenB.deploy();
        await tokenB.waitForDeployment();

        SimpleSwap = await ethers.getContractFactory("SimpleSwap");
        simpleSwap = await SimpleSwap.deploy(await tokenA.getAddress(), await tokenB.getAddress());

        await simpleSwap.waitForDeployment();

        // Mint tokens to addr1
        //await tokenA.mint(addr1.address, ethers.parseEther("1000"));
        //await tokenB.mint(addr1.address, ethers.parseEther("1000"));
        await tokenA.mint(addr1.address, 1000);
        await tokenB.mint(addr1.address, 1000);

        // Approve transferFrom to the contract
        await tokenA.connect(addr1).approve(
            await simpleSwap.getAddress(),
            1000n
        );
        await tokenB.connect(addr1).approve(
            await simpleSwap.getAddress(),
            1000n
        );

        // Mint tokens to user2 for swap
        await tokenA.mint(user2.address, 10);
        await tokenB.mint(user2.address, 10);

    });

    it("testing gettotalLiquidity()", async function () {
        let result = await simpleSwap.totalLiquidity();
        expect(result).to.equal("0");
    });

    it("testing getreserveA()", async function () {
        let result = await simpleSwap.reserveA();
        expect(result).to.equal("0");
    });

    it("testing getreserveB()", async function () {
        let result = await simpleSwap.reserveB();
        expect(result).to.equal("0");
    });

    it("testing mint()", async function () {
        const mintAmount = 100;
        await tokenA.connect(owner).mint(user1.address, mintAmount);
        let result = await tokenA.balanceOf(user1.address);
        expect(result).to.equal(mintAmount);
    });

    it("testing addLiquidity()", async () => {

        const amountA = 100n;
        const amountB = 200n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        const tx = await simpleSwap
            .connect(addr1)
            .addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                amountA,
                amountB,
                amountA,
                amountB,
                addr1.address,
                deadline
            );


        const receipt = await tx.wait();
        const event = receipt.logs
            .map(log => {
                try {
                    return simpleSwap.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find(e => e && e.name === "LiquidityAdded");

        expect(event).to.not.be.undefined;

        const liquidityMinted = event.args.liquidityMinted;

        const expectedLiquidity = sqrtSolidityStyle(amountA * amountB);
        expect(liquidityMinted).to.equal(expectedLiquidity);

        const reservesA = await simpleSwap.reserveA();
        const reservesB = await simpleSwap.reserveB();
        const liquidity = await simpleSwap.totalLiquidity();
        const balance = await simpleSwap.liquidityBalance(addr1.address);

        expect(reservesA).to.equal(amountA);
        expect(reservesB).to.equal(amountB);
        expect(liquidity).to.equal(balance);
        expect(liquidity).to.be.gt(0n);
    });

    it("should emit LiquidityAdded event with correct values", async () => {
        const amountA = 100n;
        const amountB = 200n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        const tx = await simpleSwap
            .connect(addr1)
            .addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                amountA,
                amountB,
                amountA,
                amountB,
                addr1.address,
                deadline
            );

        const receipt = await tx.wait();

        const event = receipt.logs
            .map(log => {
                try {
                    return simpleSwap.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find(e => e && e.name === "LiquidityAdded");

        expect(event).to.not.be.undefined;

        expect(event.args.provider).to.equal(addr1.address);
        expect(event.args.amountA).to.equal(amountA);
        expect(event.args.amountB).to.equal(amountB);

        // Para liquidityMinted, calculamos el esperado igual que en el contrato:
        const expectedLiquidity = sqrtSolidityStyle(amountA * amountB);
        expect(event.args.liquidityMinted).to.equal(expectedLiquidity);
    });

    it("should use amountAOptimal path in _calculateOptimalAmounts", async () => {
        // Inicialmente agregamos liquidez para tener reserves y totalLiquidity > 0
        const amountAInit = 100n;
        const amountBInit = 200n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await simpleSwap.connect(addr1).addLiquidity(
            tokenA.target,
            tokenB.target,
            amountAInit,
            amountBInit,
            amountAInit,
            amountBInit,
            addr1.address,
            deadline
        );

        // Ahora hacemos otro addLiquidity con valores que disparen el `else`
        const amountADesired = 100n;
        const amountBDesired = 50n; // deliberately small so amountBOptimal > amountBDesired

        // amountBOptimal = (100 * 200) / 100 = 200 > 50 → entra al else

        await tokenA.connect(addr1).approve(simpleSwap.target, amountADesired);
        await tokenB.connect(addr1).approve(simpleSwap.target, amountBDesired);

        const tx = await simpleSwap.connect(addr1).addLiquidity(
            tokenA.target,
            tokenB.target,
            amountADesired,
            amountBDesired,
            1n,
            1n,
            addr1.address,
            deadline
        );

        const receipt = await tx.wait();
        const event = receipt.logs.map(log => {
            try {
                return simpleSwap.interface.parseLog(log);
            } catch {
                return null;
            }
        }).find(e => e?.name === "LiquidityAdded");

        expect(event).to.not.be.undefined;
    });

    it("should revert when amountA < amountAMin (slippage protection)", async () => {
        const amountADesired = 100n;
        const amountBDesired = 200n;
        const amountAMin = 150n; // > amountA que se calcularía
        const amountBMin = 100n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await expect(
            simpleSwap.connect(addr1).addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                amountADesired,
                amountBDesired,
                amountAMin,
                amountBMin,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("amountA < amountAMin");
    });

    it("should revert when amountB < amountBMin (slippage protection)", async () => {
        const amountADesired = 100n;
        const amountBDesired = 200n;
        const amountAMin = 50n;
        const amountBMin = 250n; // > amountB esperado
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await expect(
            simpleSwap.connect(addr1).addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                amountADesired,
                amountBDesired,
                amountAMin,
                amountBMin,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("amountB < amountBMin");
    });

    it("should revert if liquidity to mint is 0", async () => {
        const amountADesired = 0n;
        const amountBDesired = 0n;
        const amountAMin = 0n;
        const amountBMin = 0n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await expect(
            simpleSwap.connect(addr1).addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                amountADesired,
                amountBDesired,
                amountAMin,
                amountBMin,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("Insufficient liquidity minted");
    });

    it("testing getPrice()", async () => {
        const price = await simpleSwap.getPrice(
            await tokenA.getAddress(),
            await tokenB.getAddress()
        );

        // price es un número con 18 decimales
        expect(price).to.equal(ethers.parseUnits("2", 18));
    });

    it("should revert getPrice() when reserveA is zero", async () => {
        // Deploy un nuevo contrato vacío (sin liquidez)
        const SimpleSwapNew = await ethers.getContractFactory("SimpleSwap");
        const newSwap = await SimpleSwapNew.deploy(
            await tokenA.getAddress(),
            await tokenB.getAddress()
        );
        await newSwap.waitForDeployment();

        await expect(
            newSwap.getPrice(
                await tokenA.getAddress(),
                await tokenB.getAddress()
            )
        ).to.be.revertedWith("Zero reserveA");
    });

    it("testing getAmountOut()", async () => {
        const amountIn = 1n;

        const amountOut = await simpleSwap.getAmountOut(
            amountIn,
            await tokenA.getAddress(),
            await tokenB.getAddress()
        );

        // amountOut debe ser > 0 y menor a 3 ethers (un valor alto para cubrir la salida)
        expect(amountOut).to.be.gt(0);
        expect(amountOut).to.be.lt(3n);
    });

    it("should revert if amountIn is zero in getAmountOut()", async () => {
        await expect(
            simpleSwap.getAmountOut(
                0,
                100,
                200
            )
        ).to.be.revertedWith("Insufficient input amount");
    });

    it("should revert if amountA is zero in getAmountOut()", async () => {
        await expect(
            simpleSwap.getAmountOut(
                10,
                0,
                200
            )
        ).to.be.revertedWith("Insufficient liquidity");
    });

    it("should revert if amountB is zero in getAmountOut()", async () => {
        await expect(
            simpleSwap.getAmountOut(
                10,
                100,
                0
            )
        ).to.be.revertedWith("Insufficient liquidity");
    });

    it("should revert if deadline is in the past", async () => {
        const pastDeadline = (await ethers.provider.getBlock("latest")).timestamp - 10;

        await expect(
            simpleSwap.connect(user1).addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                1n,
                2n,
                0,
                0,
                user1.address,
                pastDeadline
            )
        ).to.be.revertedWith("Transaction expired");
    });

    it("should swap TokenA for TokenB and emit TokensSwapped event", async function () {
        const amountIn = 10n;
        const path = [await tokenA.getAddress(), await tokenB.getAddress()];
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        // User approves SimpleSwap
        await tokenA.connect(user2).approve(simpleSwap, amountIn);

        const balanceBefore = await tokenB.balanceOf(user2.address);

        const tx = await simpleSwap.connect(user2).swapExactTokensForTokens(
            amountIn,
            0, // amountOutMin
            path,
            user2.address,
            deadline
        );

        const receipt = await tx.wait();
        const balanceAfter = await tokenB.balanceOf(user2.address);

        const amountOut = balanceAfter - balanceBefore;

        expect(amountOut).to.be.gt(0n);
        expect(balanceAfter).to.be.gt(balanceBefore);

        const event = receipt.logs
            .map(log => {
                try {
                    return simpleSwap.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find(e => e && e.name === "TokensSwapped" && e.args.swapper === user2.address);

        expect(event).to.not.be.undefined;

        expect(event.args.swapper).to.equal(user2.address);
        expect(event.args.amountIn).to.equal(amountIn);
        expect(event.args.tokenIn).to.equal(await tokenA.getAddress());
        expect(event.args.tokenOut).to.equal(await tokenB.getAddress());
    });

    it("should revert if amountIn is zero", async () => {
        const path = [await tokenA.getAddress(), await tokenB.getAddress()];

        await expect(
            simpleSwap.connect(user2).swapExactTokensForTokens(
                0n,
                0n,
                path,
                user2.address,
                (await ethers.provider.getBlock("latest")).timestamp + 60
            )
        ).to.be.revertedWith("Insufficient input amount");
    });

    it("should revert if amountOut < amountOutMin", async () => {
        const amountIn = 10n;
        const path = [await tokenA.getAddress(), await tokenB.getAddress()];
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await tokenA.connect(user2).approve(simpleSwap, amountIn);

        // Simular una cantidad mínima inalcanzable para forzar el revert
        const amountOutMin = 1000n; // muy alta adrede

        await expect(
            simpleSwap.connect(user2).swapExactTokensForTokens(
                amountIn,
                amountOutMin, // <--- esta línea dispara el require
                path,
                user2.address,
                deadline
            )
        ).to.be.revertedWith("Insufficient output amount");
    });

    it("should revert if path length is not 2", async () => {
        await expect(
            simpleSwap.connect(user2).swapExactTokensForTokens(
                10n,
                0,
                [await tokenA.getAddress()], // invalid path
                user2.address,
                (await ethers.provider.getBlock("latest")).timestamp + 60
            )
        ).to.be.revertedWith("Path length must be 2");
    });

    it("should revert if token pair is invalid", async () => {
        const fakeToken = owner.address; // cualquier dirección que no sea tokenA/tokenB

        await expect(
            simpleSwap.connect(user2).swapExactTokensForTokens(
                10n,
                0,
                [fakeToken, await tokenB.getAddress()],
                user2.address,
                (await ethers.provider.getBlock("latest")).timestamp + 60
            )
        ).to.be.revertedWith("Invalid token pair");
    });

    it("should revert if amountA or amountB is less than minimums", async () => {
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;
        const userLiquidity = await simpleSwap.liquidityBalance(addr1.address);

        // Establecemos mínimos que sabemos serán más altos que lo que devolverá
        await expect(
            simpleSwap.connect(addr1).removeLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                userLiquidity,
                10_000n, // cantidad exageradamente alta
                10_000n,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("amountA < amountAMin");
    });





    it("testing removeLiquidity()", async () => {

        const amountAmin = 40n;
        const amountBmin = 80n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        const balanceBefore = await simpleSwap.liquidityBalance(addr1.address);
        const balanceABefore = await tokenA.balanceOf(addr1.address);
        const balanceBBefore = await tokenB.balanceOf(addr1.address);

        const reservesABefore = await simpleSwap.reserveA();
        const reservesBBefore = await simpleSwap.reserveB();

        const tx = await simpleSwap
            .connect(addr1)
            .removeLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                balanceBefore,
                amountAmin,
                amountBmin,
                addr1.address,
                deadline
            );

        const receipt = await tx.wait();
        const event = receipt.logs
            .map(log => {
                try {
                    return simpleSwap.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find(e => e && e.name === "LiquidityRemoved");

        expect(event).to.not.be.undefined;

        expect(event.args.amountA).to.be.gt(amountAmin);
        expect(event.args.amountB).to.be.gt(amountBmin);

        const balanceAfter = await simpleSwap.liquidityBalance(addr1.address);
        const balanceDiff = balanceBefore - balanceAfter;
        expect(balanceDiff).to.be.gt(0n);

        const balanceAAfter = await tokenA.balanceOf(addr1.address);
        const balanceADiff = balanceAAfter - balanceABefore;
        expect(balanceADiff).to.be.gt(0n);

        const balanceBAfter = await tokenB.balanceOf(addr1.address);
        const balanceBDiff = balanceBAfter - balanceBBefore;
        expect(balanceBDiff).to.be.gt(0n);

        const reservesAAfter = await simpleSwap.reserveA();
        const reservesADifff = reservesABefore - reservesAAfter;
        expect(reservesADifff).to.be.gt(0n);

        const reservesBAfter = await simpleSwap.reserveB();
        const reservesBDifff = reservesBBefore - reservesBAfter;
        expect(reservesBDifff).to.be.gt(0n);

    });

    it("should revert if 'Insufficient liquidity' ", async () => {
        const amountIn = 10n;
        const path = [await tokenA.getAddress(), await tokenB.getAddress()];
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await tokenA.connect(user2).approve(simpleSwap, amountIn);

        const amountOutMin = ethers.parseUnits("1000", 18);

        // Ya se removió la liquidez por eso va a revertir
        await expect(
            simpleSwap.connect(user2).swapExactTokensForTokens(
                amountIn,
                amountOutMin,
                path,
                user2.address,
                deadline
            )
        ).to.be.revertedWith("Insufficient liquidity");
    });

    it("should revert if liquidity to remove is zero", async () => {
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;
        await expect(
            simpleSwap.connect(addr1).removeLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                0, // ❌
                0,
                0,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("Zero liquidity");
    });

    it("should revert if user tries to remove more liquidity than owned", async () => {
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;
        const userLiquidity = await simpleSwap.liquidityBalance(addr1.address);

        await expect(
            simpleSwap.connect(addr1).removeLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                userLiquidity + 1n, // ❌ más de lo que tiene
                0,
                0,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("Not enough liquidity");
    });






});

function sqrtSolidityStyle(x) {
    if (x === 0n) return 0n;

    let y = x;
    let z = (x + 1n) / 2n;

    while (z < y) {
        y = z;
        z = (x / z + z) / 2n;
    }

    return y;
}
```
