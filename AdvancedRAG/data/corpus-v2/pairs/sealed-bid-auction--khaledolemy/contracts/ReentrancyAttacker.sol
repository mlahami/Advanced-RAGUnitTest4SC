// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SealedBidAuction} from "./SealedBidAuction.sol";

/**
 * @title ReentrancyAttacker
 * @notice Test-only contract. It loses the auction on purpose (so it is owed a refund)
 *         and then tries to re-enter `withdraw()` from its `receive()` function to
 *         drain more than it is owed. The auction's Checks-Effects-Interactions logic
 *         must make that attack fail.
 * @dev Never deploy this to a real network. It exists solely to prove a security
 *      property in the test suite.
 */
contract ReentrancyAttacker {
    SealedBidAuction public immutable auction;
    uint256 public reentryCount;

    constructor(SealedBidAuction _auction) {
        auction = _auction;
    }

    /// @dev Forward a sealed commitment from this contract's address.
    function commit(bytes32 blindedBid) external payable {
        auction.commitBid{value: msg.value}(blindedBid);
    }

    /// @dev Reveal this contract's bid.
    function reveal(uint256 value, bytes32 secret) external {
        auction.revealBid(value, secret);
    }

    /// @dev Kick off a withdrawal; the re-entrancy happens inside receive().
    function attackWithdraw() external {
        auction.withdraw();
    }

    /// @dev On receiving ETH, try to re-enter withdraw() to double-spend.
    receive() external payable {
        reentryCount += 1;
        // Attempt the re-entrant call. It is expected to revert inside the auction,
        // which will bubble up and cause the outer withdraw's low-level call to fail.
        if (reentryCount < 5) {
            auction.withdraw();
        }
    }
}
