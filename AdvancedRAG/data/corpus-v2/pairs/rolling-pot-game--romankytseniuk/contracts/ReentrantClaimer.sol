// Attempts to reenter a RollingPotGame.claim() call to validate nonReentrant protections.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { RollingPotGame } from "./RollingPotGame.sol";

/**
 * @title ReentrantClaimer
 * @notice A malicious contract that tries to reenter claim() during ETH receipt.
 */
contract ReentrantClaimer {
    address public game;
    bool public reenterAttempted;

    /**
     * @notice Sets the target game address.
     * @param gameAddress The RollingPotGame address.
     */
    function setGame(address gameAddress) external {
        game = gameAddress;
    }

    /**
     * @notice Joins the current round of the configured game.
     */
    function joinGame() external payable {
        RollingPotGame(payable(game)).join{ value: msg.value }();
    }

    /**
     * @notice Calls claim() on the configured game.
     */
    function claimFromGame() external {
        RollingPotGame(payable(game)).claim();
    }

    /**
     * @notice Receives ETH and attempts reentrancy once.
     */
    receive() external payable {
        if (!reenterAttempted) {
            reenterAttempted = true;
            try RollingPotGame(payable(game)).claim() {
                // If this succeeds, reentrancy protection is broken.
            } catch {
                // Ignore reentrancy failure.
            }
        }
    }
}
