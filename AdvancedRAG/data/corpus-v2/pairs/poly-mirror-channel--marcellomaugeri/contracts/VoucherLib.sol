// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title Voucher
 * @notice A struct representing a voucher that can be redeemed for a certain amount.
 */
struct Voucher {
    address channel;    // The address of the user's channel (for now, this is the user's address)
    uint256 nonce;      // A unique number to prevent replay attacks (from the channel owner)
    uint256 deadline;   // The timestamp after which the voucher is no longer valid
    string model;       // The name of the chosen model (e.g., "gpt-4o-mini")
    uint256 inputTokenAmount; // The amount of token to be used for the service
    uint256 maxOutputTokenAmount; // The maximum amount of output token that can be received
}
