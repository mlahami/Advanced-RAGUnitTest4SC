// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IStrategy
 * @notice Interface that any yield strategy attached to the Vault must implement.
 * @dev The Vault transfers the underlying asset to the strategy via `safeTransfer`
 *      (see Vault.allocateToStrategy) and pulls it back by calling `withdraw`.
 *      A correct strategy MUST transfer the requested amount of the underlying
 *      asset to msg.sender (the Vault) before returning. The Vault verifies the
 *      transfer by checking its balance delta.
 */
interface IStrategy {
    /// @notice Pull `amount` of the underlying asset from the strategy back to the Vault.
    /// @param amount Amount of the underlying asset to return to the caller.
    /// @return withdrawn Actual amount returned to the caller.
    function withdraw(uint256 amount) external returns (uint256 withdrawn);
}
