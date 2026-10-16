
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FixedPointMath
 * @dev Library for fixed-point arithmetic operations with 1e18 precision
 * @notice Provides safe mathematical operations for the AVGX protocol
 */
library FixedPointMath {
    uint256 public constant ONE = 1e18;
    uint256 public constant MAX_UINT256 = type(uint256).max;

    error MathOverflow();
    error DivisionByZero();

    /**
     * @dev Multiplies two fixed-point numbers
     * @param a First operand in 1e18 format
     * @param b Second operand in 1e18 format
     * @return result Product in 1e18 format
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256 result) {
        if (a == 0) return 0;
        result = a * b;
        if (result / a != b) revert MathOverflow();
        result = result / ONE;
    }

    /**
     * @dev Divides two fixed-point numbers
     * @param a Dividend in 1e18 format
     * @param b Divisor in 1e18 format
     * @return result Quotient in 1e18 format
     */
    function div(uint256 a, uint256 b) internal pure returns (uint256 result) {
        if (b == 0) revert DivisionByZero();
        result = (a * ONE) / b;
    }

    /**
     * @dev Calculates square root using Babylonian method
     * @param x Input value in 1e18 format
     * @return result Square root in 1e18 format
     */
    function sqrt(uint256 x) internal pure returns (uint256 result) {
        if (x == 0) return 0;
        
        // Initial guess
        uint256 z = (x + 1) / 2;
        result = x;
        
        // Babylonian method
        while (z < result) {
            result = z;
            z = (x / z + z) / 2;
        }
        
        // Scale to 1e18
        result = result * 1e9; // sqrt(1e18) = 1e9
    }

    /**
     * @dev Safely multiplies and divides to avoid intermediate overflow
     * @param a First operand
     * @param b Second operand
     * @param c Divisor
     * @return result (a * b) / c
     */
    function mulDiv(uint256 a, uint256 b, uint256 c) internal pure returns (uint256 result) {
        if (c == 0) revert DivisionByZero();
        
        uint256 prod0;
        uint256 prod1;
        
        assembly {
            let mm := mulmod(a, b, not(0))
            prod0 := mul(a, b)
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }
        
        if (prod1 == 0) {
            return prod0 / c;
        }
        
        if (prod1 >= c) revert MathOverflow();
        
        uint256 remainder;
        assembly {
            remainder := mulmod(a, b, c)
            prod1 := sub(prod1, gt(remainder, prod0))
            prod0 := sub(prod0, remainder)
        }
        
        uint256 twos = c & (~c + 1);
        assembly {
            c := div(c, twos)
            prod0 := div(prod0, twos)
            twos := add(div(sub(0, twos), twos), 1)
        }
        
        prod0 |= prod1 * twos;
        
        uint256 inverse = (3 * c) ^ 2;
        inverse *= 2 - c * inverse;
        inverse *= 2 - c * inverse;
        inverse *= 2 - c * inverse;
        inverse *= 2 - c * inverse;
        inverse *= 2 - c * inverse;
        inverse *= 2 - c * inverse;
        
        result = prod0 * inverse;
    }

    /**
     * @dev Normalizes a value to 1e18 precision
     * @param value The value to normalize
     * @param decimals Current decimal places of the value
     * @return normalized The value normalized to 1e18
     */
    function normalize(uint256 value, uint8 decimals) internal pure returns (uint256 normalized) {
        if (decimals == 18) {
            return value;
        } else if (decimals < 18) {
            return value * (10 ** (18 - decimals));
        } else {
            return value / (10 ** (decimals - 18));
        }
    }
}
