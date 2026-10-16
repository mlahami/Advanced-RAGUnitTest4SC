// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IFlashLoanReceiver.sol";

/**
 * @dev Test-only flash-loan receiver that simply repays the loan + fee.
 */
contract MockFlashLoanReceiver is IFlashLoanReceiver {
    address public pool;

    constructor(address _pool) {
        pool = _pool;
    }

    function executeOperation(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata /* data */
    ) external override returns (bool) {
        // Repay: approve pool to pull amount + fee
        IERC20(token).approve(pool, amount + fee);
        IERC20(token).transfer(pool, amount + fee);
        return true;
    }
}
