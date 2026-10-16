// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IFlashLoanReceiver.sol";

/**
 * @dev Test-only flash-loan receiver that always returns false (simulates callback failure).
 */
contract FailingFlashLoanReceiver is IFlashLoanReceiver {
    function executeOperation(
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bool) {
        return false;
    }
}
