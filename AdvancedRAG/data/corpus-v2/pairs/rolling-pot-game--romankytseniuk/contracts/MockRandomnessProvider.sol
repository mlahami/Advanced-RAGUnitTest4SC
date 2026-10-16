// Provides deterministic, test-controlled randomness for local development and simulations.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { IRollingPotRandomnessConsumer } from "./IRollingPotRandomnessConsumer.sol";
import { IRollingPotRandomnessProvider } from "./IRollingPotRandomnessProvider.sol";

/**
 * @title MockRandomnessProvider
 * @notice A mock randomness provider that allows explicit fulfillment in tests.
 */
contract MockRandomnessProvider is IRollingPotRandomnessProvider {
    /**
     * @notice Stores the context of a randomness request.
     */
    struct RequestContext {
        address game;
        uint256 roundIndex;
        bool fulfilled;
    }

    uint256 public nextRequestId = 1;
    mapping(uint256 requestId => RequestContext) public requests;

    event RandomWordRequested(uint256 indexed requestId, address indexed game, uint256 indexed roundIndex);
    event RandomWordFulfilled(uint256 indexed requestId, uint256 randomWord);

    /**
     * @notice Requests a random word and records the request for later fulfillment.
     * @param game The RollingPotGame contract address.
     * @param roundIndex The round index being resolved.
     * @return requestId The created request identifier.
     */
    function requestRandomWord(address game, uint256 roundIndex) external override returns (uint256 requestId) {
        requestId = nextRequestId;
        nextRequestId += 1;

        requests[requestId] = RequestContext({ game: game, roundIndex: roundIndex, fulfilled: false });

        emit RandomWordRequested(requestId, game, roundIndex);
    }

    /**
     * @notice Fulfills a previously requested random word by calling the game callback.
     * @param requestId The request identifier.
     * @param randomWord The random value to deliver.
     */
    function fulfillRequest(uint256 requestId, uint256 randomWord) external {
        RequestContext storage context = requests[requestId];
        require(context.game != address(0), "MockRandomnessProvider: unknown request");
        require(!context.fulfilled, "MockRandomnessProvider: already fulfilled");

        context.fulfilled = true;

        IRollingPotRandomnessConsumer(context.game).onRandomWord(requestId, randomWord);

        emit RandomWordFulfilled(requestId, randomWord);
    }
}
