// Mock randomness provider that returns requestId 0 to test requestId validation.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { IRollingPotRandomnessProvider } from "./IRollingPotRandomnessProvider.sol";

/**
 * @title ZeroRequestIdRandomnessProvider
 * @notice A mock provider that always returns requestId 0.
 */
contract ZeroRequestIdRandomnessProvider is IRollingPotRandomnessProvider {
    /**
     * @notice Returns 0 to simulate a misbehaving provider.
     */
    function requestRandomWord(address, uint256) external pure override returns (uint256 requestId) {
        return 0;
    }
}
