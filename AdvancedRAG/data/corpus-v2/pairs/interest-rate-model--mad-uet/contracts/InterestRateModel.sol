// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title InterestRateModel
 * @notice Dynamic algorithmic interest rate model based on utilization
 * @dev Uses dual-slope model similar to Aave with optimal utilization at 80%
 */
contract InterestRateModel {
    /// @notice Optimal utilization rate threshold (80%)
    uint256 public constant OPTIMAL_UTILIZATION = 80;
    
    /// @notice Base borrow rate when utilization is 0% (0%)
    uint256 public constant BASE_RATE = 0;
    
    /// @notice Rate increase from 0% to optimal utilization (4%)
    uint256 public constant SLOPE_1 = 4;
    
    /// @notice Rate increase from optimal to 100% utilization (60%)
    uint256 public constant SLOPE_2 = 60;

    /**
     * @notice Calculates the current borrow rate based on utilization
     * @dev Returns rate in basis points (100 bps = 1%)
     * @param totalBorrowed Total amount borrowed from the pool
     * @param totalSupplied Total amount supplied to the pool
     * @return borrowRate The calculated borrow rate in basis points
     * 
     * Formula:
     * - If utilization <= 80%: rate = (utilization * 4%) / 80%
     * - If utilization > 80%: rate = 4% + ((utilization - 80%) * 60%) / 20%
     * - Edge case: if totalSupplied = 0, return base rate (0%)
     */
    function calculateBorrowRate(
        uint256 totalBorrowed,
        uint256 totalSupplied
    ) external pure returns (uint256) {
        // Edge case: no liquidity in pool
        if (totalSupplied == 0) {
            return BASE_RATE;
        }

        // Calculate utilization rate as percentage (0-100)
        // Using basis points for precision: multiply by 10000 then divide by 100 for percentage
        uint256 utilizationRate;
        unchecked {
            // Safe: totalSupplied > 0 checked above
            utilizationRate = (totalBorrowed * 100) / totalSupplied;
        }

        // Cap utilization at 100% for calculations
        if (utilizationRate > 100) {
            utilizationRate = 100;
        }

        uint256 borrowRate;

        if (utilizationRate <= OPTIMAL_UTILIZATION) {
            // Slope 1: Linear from 0% to 4% as utilization goes 0% to 80%
            // borrowRate = BASE_RATE + (utilizationRate * SLOPE_1) / OPTIMAL_UTILIZATION
            unchecked {
                // Safe: OPTIMAL_UTILIZATION is constant > 0
                borrowRate = BASE_RATE + (utilizationRate * SLOPE_1 * 100) / OPTIMAL_UTILIZATION;
            }
        } else {
            // Slope 2: Linear from 4% to 64% as utilization goes 80% to 100%
            // borrowRate = SLOPE_1 + ((utilizationRate - OPTIMAL_UTILIZATION) * SLOPE_2) / (100 - OPTIMAL_UTILIZATION)
            unchecked {
                // Safe: utilizationRate >= OPTIMAL_UTILIZATION, denominator is constant 20
                uint256 excessUtilization = utilizationRate - OPTIMAL_UTILIZATION;
                uint256 excessRate = (excessUtilization * SLOPE_2 * 100) / (100 - OPTIMAL_UTILIZATION);
                borrowRate = (SLOPE_1 * 100) + excessRate;
            }
        }

        return borrowRate;
    }
}
