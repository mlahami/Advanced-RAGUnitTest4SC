// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IFlashLoanReceiver.sol";

/**
 * @title FlashLoan
 * @notice Mixin that adds flash-loan capability to the LendingPool.
 *         Inheriting contract must expose `_getPoolBalance` and hold tokens.
 */
abstract contract FlashLoan {
    using SafeERC20 for IERC20;

    uint256 public constant FLASH_LOAN_FEE_BPS = 9; // 0.09 %
    uint256 private constant BPS = 10_000;

    event FlashLoanExecuted(
        address indexed receiver,
        address indexed token,
        uint256 amount,
        uint256 fee
    );

    /**
     * @dev Execute a flash loan. The receiver must repay amount + fee
     *      within the same transaction.
     */
    function _executeFlashLoan(
        address receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(balanceBefore >= amount, "FlashLoan: insufficient liquidity");

        uint256 fee = (amount * FLASH_LOAN_FEE_BPS) / BPS;

        // Transfer tokens to receiver
        IERC20(token).safeTransfer(receiver, amount);

        // Invoke callback
        require(
            IFlashLoanReceiver(receiver).executeOperation(token, amount, fee, data),
            "FlashLoan: callback failed"
        );

        // Verify repayment
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        require(
            balanceAfter >= balanceBefore + fee,
            "FlashLoan: not repaid"
        );

        emit FlashLoanExecuted(receiver, token, amount, fee);
    }
}
