// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LeashManager
/// @notice A leash is a scoped spending key into its owner's balance: the
///         beneficiary may pull up to `spendLimit` of `token` from the owner,
///         until `expiry`, unless revoked. Funds are never escrowed — the
///         owner keeps custody and grants this contract an ERC20 allowance;
///         every spend moves owner → recipient directly. Revocation therefore
///         "returns" unspent balance by construction: it never left.
contract LeashManager is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Leash {
        address owner;
        address beneficiary;
        address token;
        uint256 spendLimit;
        uint256 spent;
        uint64 expiry; // unix seconds; 0 = no expiry
        bool revoked;
    }

    mapping(bytes32 => Leash) private _leashes;
    uint256 private _nonce;

    event LeashCreated(
        bytes32 indexed leashId,
        address indexed owner,
        address indexed beneficiary,
        address token,
        uint256 spendLimit,
        uint64 expiry
    );

    event LeashSpent(
        bytes32 indexed leashId,
        address indexed beneficiary,
        address indexed to,
        uint256 amount,
        uint256 remaining
    );

    event LeashRevoked(bytes32 indexed leashId, address indexed owner, uint256 unspent);

    error LeashNotFound();
    error NotBeneficiary();
    error NotOwner();
    error AlreadyRevoked();
    error LeashExpired();
    error ZeroAddress();
    error ZeroAmount();
    error SelfLeash();
    error SpendLimitExceeded(uint256 requested, uint256 remaining);
    error ExpiryInPast();

    /// @notice Create a leash from the caller's balance to `beneficiary`.
    /// @dev The owner must separately grant this contract an ERC20 allowance
    ///      covering intended spends; the leash caps what the beneficiary can
    ///      pull regardless of how large that allowance is.
    function createLeash(
        address beneficiary,
        address token,
        uint256 spendLimit,
        uint64 expiry
    ) external returns (bytes32 leashId) {
        if (beneficiary == address(0) || token == address(0)) revert ZeroAddress();
        if (beneficiary == msg.sender) revert SelfLeash();
        if (spendLimit == 0) revert ZeroAmount();
        if (expiry != 0 && expiry <= block.timestamp) revert ExpiryInPast();

        leashId = keccak256(abi.encode(msg.sender, beneficiary, token, _nonce++));

        _leashes[leashId] = Leash({
            owner: msg.sender,
            beneficiary: beneficiary,
            token: token,
            spendLimit: spendLimit,
            spent: 0,
            expiry: expiry,
            revoked: false
        });

        emit LeashCreated(leashId, msg.sender, beneficiary, token, spendLimit, expiry);
    }

    /// @notice Pull `amount` from the leash owner's balance to `to`.
    ///         Beneficiary-only, within the cap, before expiry, unless revoked.
    function spend(bytes32 leashId, uint256 amount, address to) external nonReentrant {
        Leash storage leash = _leashes[leashId];

        if (leash.owner == address(0)) revert LeashNotFound();
        if (msg.sender != leash.beneficiary) revert NotBeneficiary();
        if (leash.revoked) revert AlreadyRevoked();
        if (leash.expiry != 0 && block.timestamp > leash.expiry) revert LeashExpired();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 remaining = leash.spendLimit - leash.spent;
        if (amount > remaining) revert SpendLimitExceeded(amount, remaining);

        // Effects before interaction: the cap is committed before the token
        // call, so a reentrant beneficiary meets the updated `spent`.
        leash.spent += amount;

        IERC20(leash.token).safeTransferFrom(leash.owner, to, amount);

        emit LeashSpent(leashId, msg.sender, to, amount, leash.spendLimit - leash.spent);
    }

    /// @notice Revoke the leash. Owner-only. Blocks all further spending;
    ///         unspent balance stays where it always was — with the owner.
    function revoke(bytes32 leashId) external {
        Leash storage leash = _leashes[leashId];

        if (leash.owner == address(0)) revert LeashNotFound();
        if (msg.sender != leash.owner) revert NotOwner();
        if (leash.revoked) revert AlreadyRevoked();

        leash.revoked = true;

        emit LeashRevoked(leashId, msg.sender, leash.spendLimit - leash.spent);
    }

    /// @notice Spendable amount right now: 0 if revoked, expired, or unknown.
    function remainingBalance(bytes32 leashId) external view returns (uint256) {
        Leash storage leash = _leashes[leashId];
        if (leash.owner == address(0) || leash.revoked) return 0;
        if (leash.expiry != 0 && block.timestamp > leash.expiry) return 0;
        return leash.spendLimit - leash.spent;
    }

    /// @notice Full leash state, for the indexer and any off-chain reader.
    function getLeash(bytes32 leashId) external view returns (Leash memory) {
        return _leashes[leashId];
    }
}
