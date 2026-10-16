// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title  InvoiceVault
/// @author 0xPenwright
/// @notice Non-custodial ERC-20 invoice processor. A merchant creates an
///         invoice on-chain; the payer settles it with `pay(id)`, which
///         pulls the exact expected token+amount and forwards to the
///         payee atomically. Off-chain services index `Paid` events to
///         confirm receipts and fire webhooks.
/// @dev    Vault never holds user funds beyond the duration of `pay()`.
///         If the off-chain webhook fails, the on-chain truth (Paid event)
///         is still the source of record.
contract InvoiceVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Stored invoice. Packed into two storage slots.
    /// @param payee          Address that receives the payment.
    /// @param token          ERC-20 expected for settlement.
    /// @param expectedAmount Exact amount required (no over/underpayment).
    /// @param createdAt      Block timestamp at creation.
    /// @param expiresAt      Block timestamp after which `pay()` reverts.
    /// @param paid           True once the invoice is settled.
    struct Invoice {
        address payee;
        address token;
        uint96  expectedAmount;
        uint32  createdAt;
        uint32  expiresAt;
        bool    paid;
    }

    /// @notice invoice id (bytes32) → invoice record.
    mapping(bytes32 => Invoice) public invoices;

    /// @notice Owner-managed allowlist of acceptable tokens.
    mapping(address => bool) public tokenAllowed;

    event TokenAllowed(address indexed token, bool allowed);
    event InvoiceCreated(
        bytes32 indexed id,
        address indexed payee,
        address indexed token,
        uint256 expectedAmount,
        uint32 expiresAt
    );
    event Paid(
        bytes32 indexed id,
        address indexed payer,
        address indexed payee,
        address token,
        uint256 amount
    );

    error InvoiceAlreadyExists(bytes32 id);
    error InvoiceNotFound(bytes32 id);
    error InvoiceAlreadyPaid(bytes32 id);
    error InvoiceExpired(bytes32 id);
    error TokenNotAllowed(address token);
    error InvalidPayee();
    error InvalidAmount();

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ─── Admin ───────────────────────────────────────────────────────────

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        tokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function setTokensAllowed(address[] calldata tokens, bool allowed) external onlyOwner {
        for (uint256 i; i < tokens.length; ++i) {
            tokenAllowed[tokens[i]] = allowed;
            emit TokenAllowed(tokens[i], allowed);
        }
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── Invoice lifecycle ───────────────────────────────────────────────

    /// @notice Create an invoice. `id` is caller-supplied — typically a hash
    ///         of (merchant, order_id, nonce) so off-chain systems can derive
    ///         it deterministically.
    /// @param id       Unique invoice identifier. Reverts if already used.
    /// @param payee    Destination address for the payment.
    /// @param token    Expected ERC-20 (must be on the allowlist).
    /// @param amount   Exact amount of `token` required.
    /// @param ttl      Seconds after which the invoice expires. Must be > 0.
    function createInvoice(
        bytes32 id,
        address payee,
        address token,
        uint96 amount,
        uint32 ttl
    ) external whenNotPaused {
        if (payee == address(0)) revert InvalidPayee();
        if (amount == 0 || ttl == 0) revert InvalidAmount();
        if (!tokenAllowed[token]) revert TokenNotAllowed(token);
        if (invoices[id].createdAt != 0) revert InvoiceAlreadyExists(id);

        uint32 created = uint32(block.timestamp);
        uint32 expires = created + ttl;
        invoices[id] = Invoice({
            payee:          payee,
            token:          token,
            expectedAmount: amount,
            createdAt:      created,
            expiresAt:      expires,
            paid:           false
        });

        emit InvoiceCreated(id, payee, token, amount, expires);
    }

    /// @notice Settle an invoice. The caller must have approved the vault
    ///         to spend `invoice.expectedAmount` of `invoice.token`.
    ///         The vault pulls the funds and forwards to the payee in one tx.
    function pay(bytes32 id) external nonReentrant whenNotPaused {
        Invoice storage inv = invoices[id];

        if (inv.createdAt == 0) revert InvoiceNotFound(id);
        if (inv.paid) revert InvoiceAlreadyPaid(id);
        if (block.timestamp > inv.expiresAt) revert InvoiceExpired(id);

        // Cache for event + cheaper SLOADs.
        address payer  = msg.sender;
        address payee  = inv.payee;
        address token  = inv.token;
        uint256 amount = inv.expectedAmount;

        inv.paid = true;

        IERC20(token).safeTransferFrom(payer, payee, amount);

        emit Paid(id, payer, payee, token, amount);
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function getInvoice(bytes32 id) external view returns (Invoice memory) {
        return invoices[id];
    }

    function isOpen(bytes32 id) external view returns (bool) {
        Invoice memory inv = invoices[id];
        return inv.createdAt != 0 && !inv.paid && block.timestamp <= inv.expiresAt;
    }
}
