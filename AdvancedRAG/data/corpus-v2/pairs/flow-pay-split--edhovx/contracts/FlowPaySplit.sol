// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title FlowPaySplit
 * @notice Multi-recipient USDC payment split for Arc.
 * @dev A funder creates a split with N recipients, funds it once, and each
 *      recipient claims their share. Claim pattern = 1 transfer per claim
 *      (gas optimized, no payout loop). Unclaimed funds can be pulled back
 *      by the funder after the expiry deadline.
 */
contract FlowPaySplit is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Recipient {
        address account;
        uint256 amount;
        bool claimed;
    }

    struct Split {
        uint256 id;
        address funder;
        string title;
        uint256 total;
        uint256 expiry; // timestamp after which unclaimed funds can be pulled back
        uint256 createdAt;
        uint256 fundedAt;
        uint256 claimedCount;
        uint256 claimedTotal;
        bool funded;
        bool refunded;
    }

    IERC20 public immutable usdc;
    uint256 public nextSplitId;
    mapping(uint256 => Split) public splits;
    mapping(uint256 => Recipient[]) public recipients;
    mapping(address => uint256[]) public splitsByFunder;
    mapping(address => uint256[]) public splitsByRecipient;

    event SplitCreated(
        uint256 indexed splitId,
        address indexed funder,
        uint256 total,
        uint256 expiry,
        uint256 recipientCount
    );
    event SplitFunded(uint256 indexed splitId, address indexed funder, uint256 total);
    event SplitClaimed(uint256 indexed splitId, uint256 indexed index, address indexed recipient, uint256 amount);
    event SplitRefunded(uint256 indexed splitId, address indexed funder, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error EmptyRecipients();
    error MismatchedArrays();
    error DuplicateRecipient();
    error InvalidDeadline();
    error SplitNotFound();
    error AlreadyFunded();
    error NotFunded();
    error AlreadyClaimed();
    error Unauthorized();
    error NotExpired();
    error AlreadyRefunded();
    error NothingToRefund();

    constructor(address _usdc) Ownable(msg.sender) {
        if (_usdc == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
    }

    modifier onlyFunder(uint256 splitId) {
        if (splits[splitId].funder != msg.sender) revert Unauthorized();
        _;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Create a split with N recipients. Expiry must be in the future.
    function createSplit(
        address[] calldata accounts,
        uint256[] calldata amounts,
        string calldata title,
        uint256 expiry
    ) external returns (uint256 splitId) {
        if (accounts.length == 0) revert EmptyRecipients();
        if (accounts.length != amounts.length) revert MismatchedArrays();
        if (expiry <= block.timestamp) revert InvalidDeadline();

        uint256 total;
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            for (uint256 j = 0; j < i; j++) {
                if (accounts[j] == accounts[i]) revert DuplicateRecipient();
            }
            total += amounts[i];
        }

        splitId = nextSplitId++;
        Split storage s = splits[splitId];
        s.id = splitId;
        s.funder = msg.sender;
        s.title = title;
        s.total = total;
        s.expiry = expiry;
        s.createdAt = block.timestamp;

        for (uint256 i = 0; i < accounts.length; i++) {
            recipients[splitId].push(Recipient({ account: accounts[i], amount: amounts[i], claimed: false }));
        }

        splitsByFunder[msg.sender].push(splitId);
        for (uint256 i = 0; i < accounts.length; i++) {
            splitsByRecipient[accounts[i]].push(splitId);
        }

        emit SplitCreated(splitId, msg.sender, total, expiry, accounts.length);
    }

    /// @notice Funder locks the total USDC into the contract.
    function fundSplit(uint256 splitId) external nonReentrant whenNotPaused onlyFunder(splitId) {
        Split storage s = splits[splitId];
        if (s.funder == address(0)) revert SplitNotFound();
        if (s.funded) revert AlreadyFunded();

        usdc.safeTransferFrom(msg.sender, address(this), s.total);
        s.funded = true;
        s.fundedAt = block.timestamp;

        emit SplitFunded(splitId, msg.sender, s.total);
    }

    /// @notice Recipient claims their own share (or anyone calls claimFor on their behalf).
    function claim(uint256 splitId, uint256 index) external nonReentrant whenNotPaused {
        Recipient storage r = recipients[splitId][index];
        if (r.account != msg.sender) revert Unauthorized();
        _payout(splitId, index, r);
    }

    function claimFor(uint256 splitId, uint256 index) external nonReentrant whenNotPaused {
        Recipient storage r = recipients[splitId][index];
        _payout(splitId, index, r);
    }

    function _payout(uint256 splitId, uint256 index, Recipient storage r) internal {
        Split storage s = splits[splitId];
        if (s.funder == address(0)) revert SplitNotFound();
        if (!s.funded) revert NotFunded();
        if (r.claimed) revert AlreadyClaimed();

        r.claimed = true;
        s.claimedCount += 1;
        s.claimedTotal += r.amount;

        usdc.safeTransfer(r.account, r.amount);
        emit SplitClaimed(splitId, index, r.account, r.amount);
    }

    /// @notice Funder pulls back unclaimed funds after expiry (dust = anything left).
    function refundUnclaimed(uint256 splitId) external nonReentrant onlyFunder(splitId) {
        Split storage s = splits[splitId];
        if (s.funder == address(0)) revert SplitNotFound();
        if (!s.funded) revert NotFunded();
        if (s.refunded) revert AlreadyRefunded();
        if (block.timestamp <= s.expiry) revert NotExpired();

        uint256 remaining = s.total - s.claimedTotal;
        if (remaining == 0) revert NothingToRefund();

        s.refunded = true;
        usdc.safeTransfer(msg.sender, remaining);
        emit SplitRefunded(splitId, msg.sender, remaining);
    }

    // ---------- Views ----------

    function getSplit(uint256 splitId) external view returns (Split memory) {
        return splits[splitId];
    }

    function getRecipient(uint256 splitId, uint256 index) external view returns (Recipient memory) {
        return recipients[splitId][index];
    }

    function getRecipients(uint256 splitId) external view returns (Recipient[] memory) {
        return recipients[splitId];
    }

    function getRecipientCount(uint256 splitId) external view returns (uint256) {
        return recipients[splitId].length;
    }

    function getSplitsByFunder(address funder) external view returns (uint256[] memory) {
        return splitsByFunder[funder];
    }

    function getSplitsByRecipient(address recipient) external view returns (uint256[] memory) {
        return splitsByRecipient[recipient];
    }
}