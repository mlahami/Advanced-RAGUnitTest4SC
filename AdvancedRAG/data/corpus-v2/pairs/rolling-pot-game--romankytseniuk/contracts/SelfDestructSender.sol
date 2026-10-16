// Sends ETH to a target via selfdestruct to test forced ETH behavior.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

/**
 * @title SelfDestructSender
 * @notice A helper contract that can force-send ETH via selfdestruct.
 */
contract SelfDestructSender {
    /**
     * @notice Accepts initial ETH funding for later selfdestruct transfer.
     */
    constructor() payable {}

    /**
     * @notice Destroys the contract and sends its balance to the target.
     * @param target The recipient of the remaining ETH.
     */
    function destroy(address payable target) external {
        selfdestruct(target);
    }
}
