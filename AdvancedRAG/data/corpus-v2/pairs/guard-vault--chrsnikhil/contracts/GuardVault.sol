// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title GuardVault — Guardian's on-chain guard for a defensive agent wallet (ETHOnline 2026)
/// @notice Holds protected USDC. An autonomous `agent` can trigger rescues, but ONLY within the
///         bounds of a `Mandate` the `owner` physically signed on their Ledger Flex (EIP-712).
///         The chain enforces the bounds; the agent only decides *timing*. Worst case — a fully
///         compromised agent — can only move funds to an owner-approved safe haven, up to an
///         owner-signed cap, before expiry. It can never steal. That is the security guarantee.
/// @dev v1 rescue = local transfer to the safe haven. v2 swaps the transfer for a CCTP
///      `depositForBurn` to the Arc safe haven (domain 26). The mandate/authority model is identical.
contract GuardVault is EIP712 {
    using ECDSA for bytes32;

    /// @notice The hardware root of trust — the Ledger Flex address. Signs mandates; sets policy.
    address public immutable owner;
    /// @notice The protected asset.
    IERC20 public immutable usdc;
    /// @notice The autonomous relayer permitted to *trigger* rescues (bounded by the mandate).
    address public agent;

    /// @notice Owner-approved rescue destinations. A rescue can only ever go here.
    mapping(address => bool) public safeHavenAllowed;
    /// @notice Cumulative amount already rescued under each mandate (by its EIP-712 digest).
    mapping(bytes32 => uint256) public spentPerMandate;

    /// @dev The mandate the owner signs once on the Flex: "rescue up to `maxAmount` to `safeHaven`
    ///      until `expiry`." The agent may rescue repeatedly while the cumulative total stays under
    ///      `maxAmount` and the mandate hasn't expired — autonomy within bounds.
    struct Mandate {
        uint256 maxAmount;
        address safeHaven;
        uint256 expiry;
        uint256 nonce;
    }

    bytes32 private constant MANDATE_TYPEHASH =
        keccak256("Mandate(uint256 maxAmount,address safeHaven,uint256 expiry,uint256 nonce)");

    event Deposited(address indexed from, uint256 amount);
    event Rescued(address indexed safeHaven, uint256 amount, uint256 nonce, uint256 spent);
    event SafeHavenSet(address indexed haven, bool allowed);
    event AgentSet(address indexed agent);

    error NotOwner();
    error NotAgent();
    error BadMandateSigner();
    error MandateExpired();
    error AmountOverMandate();
    error SafeHavenNotAllowed();

    constructor(address _owner, IERC20 _usdc) EIP712("Guardian", "1") {
        owner = _owner;
        usdc = _usdc;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // --- owner (Ledger) policy controls ---

    function setAgent(address _agent) external onlyOwner {
        agent = _agent;
        emit AgentSet(_agent);
    }

    function setSafeHaven(address haven, bool allowed) external onlyOwner {
        safeHavenAllowed[haven] = allowed;
        emit SafeHavenSet(haven, allowed);
    }

    // --- funding ---

    function deposit(uint256 amount) external {
        usdc.transferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    // --- mandate hashing (EIP-712) ---

    function hashMandate(Mandate calldata m) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(MANDATE_TYPEHASH, m.maxAmount, m.safeHaven, m.expiry, m.nonce))
        );
    }

    // --- the autonomous rescue (bounded by the Flex-signed mandate) ---

    /// @param m   the mandate the owner signed on the Ledger
    /// @param sig the owner's EIP-712 signature over `m`
    /// @param amount how much USDC to move to safety this call
    function rescue(Mandate calldata m, bytes calldata sig, uint256 amount) external {
        if (msg.sender != agent) revert NotAgent();

        bytes32 digest = hashMandate(m);
        if (digest.recover(sig) != owner) revert BadMandateSigner();
        if (block.timestamp > m.expiry) revert MandateExpired();
        if (!safeHavenAllowed[m.safeHaven]) revert SafeHavenNotAllowed();

        uint256 newSpent = spentPerMandate[digest] + amount;
        if (newSpent > m.maxAmount) revert AmountOverMandate();
        spentPerMandate[digest] = newSpent;

        usdc.transfer(m.safeHaven, amount); // v2: CCTP depositForBurn → Arc (domain 26)
        emit Rescued(m.safeHaven, amount, m.nonce, newSpent);
    }
}
