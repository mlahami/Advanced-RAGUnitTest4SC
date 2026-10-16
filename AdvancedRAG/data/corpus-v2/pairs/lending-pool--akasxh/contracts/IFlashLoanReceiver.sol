// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFlashLoanReceiver {
    /**
     * @dev Called by the LendingPool after transferring flash-loaned tokens.
     * @param token  The ERC-20 token address that was borrowed.
     * @param amount The amount that was borrowed.
     * @param fee    The fee that must be repaid on top of `amount`.
     * @param data   Arbitrary data forwarded from the flash-loan caller.
     * @return True if the operation succeeded and the pool can pull repayment.
     */
    function executeOperation(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bool);
}
