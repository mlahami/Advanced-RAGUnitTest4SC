// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RecurringScheduler — prefunded recurring subscription
/// @notice Payer deposits `amountPerPeriod * totalPeriods` upfront. Merchant pulls accrued
///         periods whenever convenient.
/// @dev Pausable kill-switch (Owner). FoT tokens rejected in createSubscription.
contract RecurringScheduler is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    uint64 public constant MIN_INTERVAL = 1 hours;
    uint256 public constant MIN_AMOUNT_PER_PERIOD = 1000;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    enum Status { Active, Completed, Cancelled }

    struct Sub {
        address payer;
        address merchant;
        address token;            // address(0) = native QIE
        uint256 amountPerPeriod;
        uint64 interval;          // seconds
        uint32 totalPeriods;
        uint32 claimedPeriods;
        uint64 startedAt;
        Status status;
    }

    mapping(bytes32 => Sub) public subs;

    /// @notice Pull-fallback bucket. When `cancel()` cannot push to a party
    ///         (e.g. recipient is a contract with reverting `receive()`), the funds are
    ///         credited here and the party can `withdrawPending(token)` later.
    mapping(address => mapping(address => uint256)) public pendingBalances;

    event SubscriptionCreated(
        bytes32 indexed subId,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 amountPerPeriod,
        uint64 interval,
        uint32 totalPeriods
    );
    event PeriodsClaimed(bytes32 indexed subId, uint32 periodsClaimed, uint256 amount, uint32 cumulativeClaimed);
    event SubscriptionCompleted(bytes32 indexed subId);
    event SubscriptionCancelled(bytes32 indexed subId, uint256 refundedToPayer, uint256 claimedByMerchant);
    event PendingCredited(address indexed party, address indexed token, uint256 amount);
    event PendingWithdrawn(address indexed party, address indexed token, uint256 amount);

    error SubExists();
    error SubNotFound();
    error NotPayer();
    error NotMerchant();
    error WrongStatus(Status current);
    error IntervalTooShort();
    error ZeroAmount();
    error ZeroPeriods();
    error NoPeriodsAccrued();
    error NothingPending();
    error AmountMismatch(uint256 expected, uint256 got);
    error TransferFailed();
    error FeeOnTransferNotSupported();

    /// @notice Deterministic id — UI pre-computes the link.
    function computeSubId(address payer, address merchant, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(payer, merchant, salt, block.chainid, address(this)));
    }

    /// @notice Open and fund a subscription. msg.sender == payer.
    ///         For native: send `amountPerPeriod * totalPeriods` as msg.value.
    ///         For ERC-20: pre-approve the contract.
    function createSubscription(
        address merchant,
        address token,
        uint256 amountPerPeriod,
        uint64 interval,
        uint32 totalPeriods,
        bytes32 salt
    ) external payable nonReentrant whenNotPaused returns (bytes32 subId) {
        if (amountPerPeriod < MIN_AMOUNT_PER_PERIOD) revert ZeroAmount();
        if (totalPeriods == 0) revert ZeroPeriods();
        if (interval < MIN_INTERVAL) revert IntervalTooShort();

        subId = computeSubId(msg.sender, merchant, salt);
        if (subs[subId].payer != address(0)) revert SubExists();

        uint256 total = amountPerPeriod * totalPeriods;

        // Effects
        subs[subId] = Sub({
            payer: msg.sender,
            merchant: merchant,
            token: token,
            amountPerPeriod: amountPerPeriod,
            interval: interval,
            totalPeriods: totalPeriods,
            claimedPeriods: 0,
            startedAt: uint64(block.timestamp),
            status: Status.Active
        });

        // Interactions
        if (token == address(0)) {
            if (msg.value != total) revert AmountMismatch(total, msg.value);
        } else {
            if (msg.value != 0) revert AmountMismatch(0, msg.value);
            // Fee-on-transfer guard
            IERC20 erc = IERC20(token);
            uint256 before = erc.balanceOf(address(this));
            erc.safeTransferFrom(msg.sender, address(this), total);
            if (erc.balanceOf(address(this)) - before != total) revert FeeOnTransferNotSupported();
        }

        emit SubscriptionCreated(subId, msg.sender, merchant, token, amountPerPeriod, interval, totalPeriods);
    }

    /// @notice How many periods are claimable right now (capped at remaining periods).
    function accruedPeriods(bytes32 subId) public view returns (uint32) {
        Sub storage s = subs[subId];
        if (s.payer == address(0) || s.status != Status.Active) return 0;
        uint256 elapsed = block.timestamp - s.startedAt;
        uint256 dueFromTime = elapsed / s.interval;
        uint32 total = s.totalPeriods;
        uint32 already = s.claimedPeriods;
        if (dueFromTime > total) dueFromTime = total;
        if (dueFromTime <= already) return 0;
        return uint32(dueFromTime - already);
    }

    /// @notice Merchant claims all accrued periods.
    function claim(bytes32 subId) external nonReentrant whenNotPaused {
        Sub storage s = subs[subId];
        if (s.payer == address(0)) revert SubNotFound();
        if (msg.sender != s.merchant) revert NotMerchant();
        if (s.status != Status.Active) revert WrongStatus(s.status);

        uint32 due = accruedPeriods(subId);
        if (due == 0) revert NoPeriodsAccrued();

        uint256 payout = uint256(due) * s.amountPerPeriod;

        // Effects
        s.claimedPeriods += due;
        if (s.claimedPeriods == s.totalPeriods) {
            s.status = Status.Completed;
        }

        // Interactions
        _payOut(s.token, s.merchant, payout);

        emit PeriodsClaimed(subId, due, payout, s.claimedPeriods);
        if (s.status == Status.Completed) emit SubscriptionCompleted(subId);
    }

    /// @notice Cancel — pays out merchant's accrued share, refunds remainder to payer.
    ///         Either party may call this (mutual exit ramp).
    /// @dev Asymmetric pattern with safe push-then-pull fallback: tries to
    ///      transfer funds directly; if a party's receiver reverts (e.g. a contract with
    ///      reverting `receive()`), credits them in `pendingBalances` for later withdrawal.
    ///      Guarantees the OTHER party always gets their funds regardless.
    function cancel(bytes32 subId) external nonReentrant whenNotPaused {
        Sub storage s = subs[subId];
        if (s.payer == address(0)) revert SubNotFound();
        if (msg.sender != s.payer && msg.sender != s.merchant) revert NotPayer();
        if (s.status != Status.Active) revert WrongStatus(s.status);

        uint32 due = accruedPeriods(subId);
        uint256 merchantShare = uint256(due) * s.amountPerPeriod;
        uint32 newClaimed = s.claimedPeriods + due;
        uint256 totalDeposited = uint256(s.totalPeriods) * s.amountPerPeriod;
        uint256 alreadyPaidOut = uint256(s.claimedPeriods) * s.amountPerPeriod;
        uint256 payerRefund = totalDeposited - alreadyPaidOut - merchantShare;

        // Effects
        s.claimedPeriods = newClaimed;
        s.status = Status.Cancelled;

        // Interactions — try push, fall back to pending credit on revert.
        if (merchantShare > 0) _safePayOut(s.token, s.merchant, merchantShare);
        if (payerRefund > 0) _safePayOut(s.token, s.payer, payerRefund);

        emit SubscriptionCancelled(subId, payerRefund, merchantShare);
    }

    /// @notice Withdraw funds credited to `pendingBalances` after a `cancel()` push failed.
    function withdrawPending(address token) external nonReentrant whenNotPaused {
        uint256 amount = pendingBalances[msg.sender][token];
        if (amount == 0) revert NothingPending();
        pendingBalances[msg.sender][token] = 0;
        _payOut(token, msg.sender, amount);
        emit PendingWithdrawn(msg.sender, token, amount);
    }

    function getSubscription(bytes32 subId) external view returns (Sub memory) {
        return subs[subId];
    }

    /// @dev Strict push. Reverts on receiver failure.
    function _payOut(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @dev Tolerant push. On receiver failure, credits `pendingBalances` so the OTHER party
    ///      in `cancel()` still gets their funds. Only used in `cancel()`.
    function _safePayOut(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) {
                pendingBalances[to][token] += amount;
                emit PendingCredited(to, token, amount);
            }
        } else {
            // For ERC-20, safeTransfer reverts on token failure; we can't try/catch a SafeERC20 call
            // cleanly. Instead, do raw transfer and treat false return as failure.
            try IERC20(token).transfer(to, amount) returns (bool ok) {
                if (!ok) {
                    pendingBalances[to][token] += amount;
                    emit PendingCredited(to, token, amount);
                }
            } catch {
                pendingBalances[to][token] += amount;
                emit PendingCredited(to, token, amount);
            }
        }
    }

    receive() external payable {
        revert TransferFailed();
    }
}
