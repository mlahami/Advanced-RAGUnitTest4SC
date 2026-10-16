// Defines the callback interface used by randomness providers to deliver randomness.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

/**
 * @title IRollingPotRandomnessConsumer
 * @notice A Rolling Pot game implements this to receive random words.
 */
interface IRollingPotRandomnessConsumer {
    /**
     * @notice Delivers a random word to the consumer.
     * @param requestId The request identifier created by the provider.
     * @param randomWord The generated random word.
     */
    function onRandomWord(uint256 requestId, uint256 randomWord) external;
}
