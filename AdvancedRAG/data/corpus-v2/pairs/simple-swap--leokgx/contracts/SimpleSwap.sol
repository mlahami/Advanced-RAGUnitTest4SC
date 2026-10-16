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
