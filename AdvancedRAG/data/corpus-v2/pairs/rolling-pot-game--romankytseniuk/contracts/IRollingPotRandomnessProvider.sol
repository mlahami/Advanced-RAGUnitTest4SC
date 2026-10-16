// Defines the interface Rolling Pot games use to request verifiable randomness.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

/**
 * @title IRollingPotRandomnessProvider
 * @notice Defines a minimal interface for requesting a single random word.
 */
interface IRollingPotRandomnessProvider {
    /**
     * @notice Requests one random word for a specific game round.
     * @param game The RollingPotGame contract address.
     * @param roundIndex The round index being resolved.
     * @return requestId A provider-defined request identifier.
     */
    function requestRandomWord(address game, uint256 roundIndex) external returns (uint256 requestId);
}
