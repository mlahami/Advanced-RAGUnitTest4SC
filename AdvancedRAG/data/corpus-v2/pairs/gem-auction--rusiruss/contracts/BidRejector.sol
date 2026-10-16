// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {GemAuction} from "./GemAuction.sol";

/// @title BidRejector
/// @notice TEST-ONLY helper. A contract that bids through the auction but has no
///         receive/fallback, so it reverts on any incoming ETH. Used to prove that
///         pull-payments isolate the damage: when such a bidder is outbid, its own
///         withdraw() fails — but the auction keeps working for everyone else.
///         (With push-refunds, this same contract could freeze the whole auction.)
contract BidRejector {
    GemAuction public immutable auction;

    constructor(GemAuction _auction) {
        auction = _auction;
    }

    function bid(uint256 gemId) external payable {
        auction.placeBid{value: msg.value}(gemId);
    }

    function withdraw() external {
        auction.withdraw();
    }

    // Deliberately NO receive()/fallback() — this contract cannot accept ETH.
}
