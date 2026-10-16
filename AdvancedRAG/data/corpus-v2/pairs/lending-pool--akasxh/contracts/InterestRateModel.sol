// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title InterestRateModel
 * @notice Dynamic interest-rate model based on pool utilization.
 *
 *  Utilization U = totalBorrows / totalDeposits  (scaled 1e18 = 100 %)
 *
 *  Below the kink (optimal utilization):
 *      borrowRate = baseRate + U * slope1 / 1e18
 *
 *  Above the kink:
 *      borrowRate = baseRate + kink * slope1 / 1e18
 *                   + (U - kink) * slope2 / 1e18
 *
 *  Supply rate = borrowRate * U / 1e18 * (1 - reserveFactor)
 *
 *  All rates are per-second, scaled by 1e18.
 */
contract InterestRateModel {
    uint256 public constant SCALE = 1e18;

    uint256 public baseRate;       // per-second base borrow rate
    uint256 public slope1;         // slope below kink
    uint256 public slope2;         // slope above kink (steeper)
    uint256 public optimalUtilization; // kink point (e.g. 0.8e18 = 80 %)

    constructor(
        uint256 _baseRate,
        uint256 _slope1,
        uint256 _slope2,
        uint256 _optimalUtilization
    ) {
        baseRate = _baseRate;
        slope1 = _slope1;
        slope2 = _slope2;
        optimalUtilization = _optimalUtilization;
    }

    /**
     * @notice Calculate the current borrow rate (per second, 1e18 scaled).
     */
    function getBorrowRate(
        uint256 totalDeposits,
        uint256 totalBorrows
    ) external view returns (uint256) {
        if (totalDeposits == 0) return baseRate;

        uint256 utilization = (totalBorrows * SCALE) / totalDeposits;

        if (utilization <= optimalUtilization) {
            return baseRate + (utilization * slope1) / SCALE;
        }

        uint256 normalRate = baseRate + (optimalUtilization * slope1) / SCALE;
        uint256 excessUtil = utilization - optimalUtilization;
        return normalRate + (excessUtil * slope2) / SCALE;
    }

    /**
     * @notice Calculate the current supply (deposit) rate.
     * @param reserveFactor Protocol reserve share (1e18 = 100 %).
     */
    function getSupplyRate(
        uint256 totalDeposits,
        uint256 totalBorrows,
        uint256 reserveFactor
    ) external view returns (uint256) {
        if (totalDeposits == 0) return 0;

        uint256 utilization = (totalBorrows * SCALE) / totalDeposits;
        uint256 borrowRate = this.getBorrowRate(totalDeposits, totalBorrows);

        uint256 rateToSuppliers = (borrowRate * (SCALE - reserveFactor)) / SCALE;
        return (rateToSuppliers * utilization) / SCALE;
    }
}
