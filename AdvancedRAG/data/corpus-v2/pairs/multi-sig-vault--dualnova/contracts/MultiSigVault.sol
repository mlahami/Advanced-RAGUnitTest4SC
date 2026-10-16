// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MultiSigVault
 * @author DualNova LLC (https://dualnova.org)
 * @notice Minimal M-of-N multi-signature vault for ETH and ERC-20 custody.
 *         Designed for institutional custody flows where 2-of-3 or 3-of-5
 *         signers approve withdrawals on a per-transaction basis.
 *
 * Design choices:
 *  - Owners are fixed at deployment. Adding/removing owners or changing the
 *    threshold requires a self-call via {executeTransaction}, so the existing
 *    quorum must approve it.
 *  - Transactions are submitted, confirmed, then executed when the threshold
 *    is met. Each owner can confirm or revoke their confirmation any time
 *    before execution.
 *  - Replay-protected via per-transaction nonce.
 *
 * This contract is a template. Audit before mainnet use. For production
 * custody flows DualNova combines this with MPC (multi-party computation)
 * for the key shards; see https://dualnova.org/services.
 */
contract MultiSigVault {
    using SafeERC20 for IERC20;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint64 confirmations;
    }

    address[] private _owners;
    mapping(address owner => bool) public isOwner;
    uint64 public threshold;

    Transaction[] private _transactions;
    mapping(uint256 txId => mapping(address owner => bool)) public confirmed;

    event Deposit(address indexed sender, uint256 amount);
    event Submitted(uint256 indexed txId, address indexed submitter, address indexed to, uint256 value, bytes data);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event ConfirmationRevoked(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event ConfigChanged(address[] newOwners, uint64 newThreshold);

    error NotAnOwner();
    error InvalidConfig();
    error AlreadyExecuted();
    error AlreadyConfirmed();
    error NotConfirmed();
    error NotEnoughConfirmations();
    error ExecutionFailed(bytes returnData);
    error TxDoesNotExist();

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotAnOwner();
        _;
    }

    modifier onlyVault() {
        if (msg.sender != address(this)) revert NotAnOwner();
        _;
    }

    modifier txExists(uint256 txId) {
        if (txId >= _transactions.length) revert TxDoesNotExist();
        _;
    }

    /**
     * @param owners_ Initial set of owner addresses. Must contain at least
     *        `threshold_` distinct, non-zero addresses.
     * @param threshold_ Minimum confirmations required to execute.
     */
    constructor(address[] memory owners_, uint64 threshold_) {
        _setOwners(owners_, threshold_);
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    // ─── Owner management (self-call only) ─────────────────────────────────

    /**
     * @notice Replace the entire owner set and threshold. Can only be called
     *         by the vault itself (via {executeTransaction}), so the existing
     *         quorum must approve.
     */
    function setOwners(address[] memory newOwners, uint64 newThreshold) external onlyVault {
        _setOwners(newOwners, newThreshold);
        emit ConfigChanged(newOwners, newThreshold);
    }

    function _setOwners(address[] memory newOwners, uint64 newThreshold) private {
        if (newOwners.length == 0 || newThreshold == 0 || newThreshold > newOwners.length) {
            revert InvalidConfig();
        }

        // Clear the previous owner mapping. For typical vaults (3-7 owners)
        // this loop is bounded and cheap; for large owner sets, redeploy.
        for (uint256 i = 0; i < _owners.length; i++) {
            isOwner[_owners[i]] = false;
        }
        delete _owners;

        for (uint256 i = 0; i < newOwners.length; i++) {
            address o = newOwners[i];
            if (o == address(0) || isOwner[o]) revert InvalidConfig();
            isOwner[o] = true;
            _owners.push(o);
        }
        threshold = newThreshold;
    }

    function owners() external view returns (address[] memory) {
        return _owners;
    }

    // ─── Transaction lifecycle ─────────────────────────────────────────────

    function submit(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256 txId) {
        txId = _transactions.length;
        _transactions.push(Transaction({to: to, value: value, data: data, executed: false, confirmations: 0}));
        emit Submitted(txId, msg.sender, to, value, data);
        _confirm(txId, msg.sender);
    }

    function confirm(uint256 txId) external onlyOwner txExists(txId) {
        _confirm(txId, msg.sender);
    }

    function _confirm(uint256 txId, address owner_) private {
        Transaction storage txn = _transactions[txId];
        if (txn.executed) revert AlreadyExecuted();
        if (confirmed[txId][owner_]) revert AlreadyConfirmed();
        confirmed[txId][owner_] = true;
        txn.confirmations += 1;
        emit Confirmed(txId, owner_);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner txExists(txId) {
        Transaction storage txn = _transactions[txId];
        if (txn.executed) revert AlreadyExecuted();
        if (!confirmed[txId][msg.sender]) revert NotConfirmed();
        confirmed[txId][msg.sender] = false;
        txn.confirmations -= 1;
        emit ConfirmationRevoked(txId, msg.sender);
    }

    /**
     * @notice Execute a transaction once the confirmation threshold is met.
     *         Any owner can trigger execution.
     */
    function execute(uint256 txId) external onlyOwner txExists(txId) {
        Transaction storage txn = _transactions[txId];
        if (txn.executed) revert AlreadyExecuted();
        if (txn.confirmations < threshold) revert NotEnoughConfirmations();
        txn.executed = true;
        (bool ok, bytes memory ret) = txn.to.call{value: txn.value}(txn.data);
        if (!ok) revert ExecutionFailed(ret);
        emit Executed(txId);
    }

    // ─── Views ─────────────────────────────────────────────────────────────

    function transactionCount() external view returns (uint256) {
        return _transactions.length;
    }

    function getTransaction(uint256 txId)
        external
        view
        txExists(txId)
        returns (address to, uint256 value, bytes memory data, bool executed, uint64 confirmations)
    {
        Transaction memory txn = _transactions[txId];
        return (txn.to, txn.value, txn.data, txn.executed, txn.confirmations);
    }
}
