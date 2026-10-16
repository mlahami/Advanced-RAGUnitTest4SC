// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ExclusiveClaim
 * @notice A contract that allows users to deposit ETH or ERC20 tokens for a specific claimant.
 *         The claimant can claim at any time. After the deadline, the depositor can also refund.
 */
contract ExclusiveClaim is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Represents a deposit with its associated data
    struct Deposit {
        address depositor;      // The address that made the deposit
        address claimant;       // The address that can claim the deposit
        address token;          // Token address (address(0) for ETH)
        uint256 amount;         // Amount deposited
        uint256 startTime;      // Timestamp from which claimant can claim (0 = immediate)
        uint256 deadline;       // Timestamp after which depositor can also withdraw
        bool claimed;           // Whether the deposit has been claimed/refunded
        string title;           // Optional title/label for the deposit
    }

    /// @notice Mapping from deposit ID to Deposit struct
    mapping(uint256 => Deposit) public deposits;

    /// @notice Total number of deposits created
    uint256 public depositCount;

    /// @notice Emitted when a new deposit is created
    event DepositCreated(
        uint256 indexed depositId,
        address indexed depositor,
        address indexed claimant,
        address token,
        uint256 amount,
        uint256 startTime,
        uint256 deadline,
        string title
    );

    /// @notice Emitted when a deposit is claimed by the claimant
    event Claimed(uint256 indexed depositId, address indexed claimant);

    /// @notice Emitted when a deposit is refunded to the depositor (after deadline)
    event Refunded(uint256 indexed depositId, address indexed depositor);

    /// @notice Error thrown when deposit amount is zero
    error ZeroAmount();

    /// @notice Error thrown when claimant address is zero
    error ZeroClaimant();

    /// @notice Error thrown when deadline is not in the future
    error DeadlineNotInFuture();

    /// @notice Error thrown when deposit has already been claimed
    error AlreadyClaimed();

    /// @notice Error thrown when caller is not the claimant
    error NotClaimant();

    /// @notice Error thrown when caller is not the depositor
    error NotDepositor();

    /// @notice Error thrown when trying to refund before deadline
    error DeadlineNotReached();

    /// @notice Error thrown when ETH amount doesn't match for ERC20 deposit
    error InvalidETHAmount();

    /// @notice Error thrown when deposit doesn't exist
    error DepositNotFound();

    /// @notice Error thrown when title exceeds maximum length
    error TitleTooLong();

    /// @notice Error thrown when startTime is after deadline
    error StartTimeAfterDeadline();

    /// @notice Error thrown when trying to claim before startTime
    error ClaimNotYetAllowed();

    /// @notice Maximum allowed length for deposit title (in bytes)
    uint256 public constant MAX_TITLE_LENGTH = 128;

    /**
     * @notice Create a new deposit for ETH
     * @param claimant The address that can claim this deposit
     * @param startTime Timestamp from which claimant can claim (0 for immediate)
     * @param deadline The timestamp after which the depositor can also withdraw
     * @param title Optional title/label for the deposit
     * @return depositId The ID of the newly created deposit
     */
    function depositETH(
        address claimant,
        uint256 startTime,
        uint256 deadline,
        string calldata title
    ) external payable nonReentrant returns (uint256 depositId) {
        if (msg.value == 0) revert ZeroAmount();
        if (claimant == address(0)) revert ZeroClaimant();
        if (deadline <= block.timestamp) revert DeadlineNotInFuture();
        if (startTime > deadline) revert StartTimeAfterDeadline();
        if (bytes(title).length > MAX_TITLE_LENGTH) revert TitleTooLong();

        depositId = depositCount++;
        
        deposits[depositId] = Deposit({
            depositor: msg.sender,
            claimant: claimant,
            token: address(0),
            amount: msg.value,
            startTime: startTime,
            deadline: deadline,
            claimed: false,
            title: title
        });

        emit DepositCreated(depositId, msg.sender, claimant, address(0), msg.value, startTime, deadline, title);
    }

    /**
     * @notice Create a new deposit for an ERC20 token
     * @dev Supports fee-on-transfer tokens by recording actual balance change
     * @param claimant The address that can claim this deposit
     * @param token The ERC20 token address
     * @param amount The amount of tokens to deposit (may differ from actual if fee-on-transfer)
     * @param startTime Timestamp from which claimant can claim (0 for immediate)
     * @param deadline The timestamp after which the depositor can also withdraw
     * @param title Optional title/label for the deposit
     * @return depositId The ID of the newly created deposit
     */
    function depositToken(
        address claimant,
        address token,
        uint256 amount,
        uint256 startTime,
        uint256 deadline,
        string calldata title
    ) external nonReentrant returns (uint256 depositId) {
        if (amount == 0) revert ZeroAmount();
        if (claimant == address(0)) revert ZeroClaimant();
        if (token == address(0)) revert InvalidETHAmount();
        if (deadline <= block.timestamp) revert DeadlineNotInFuture();
        if (startTime > deadline) revert StartTimeAfterDeadline();
        if (bytes(title).length > MAX_TITLE_LENGTH) revert TitleTooLong();

        // Record balance before transfer to handle fee-on-transfer tokens
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        
        // Transfer tokens from sender to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        // Calculate actual amount received (handles fee-on-transfer tokens)
        uint256 actualAmount = IERC20(token).balanceOf(address(this)) - balanceBefore;
        
        // Ensure we actually received tokens
        if (actualAmount == 0) revert ZeroAmount();

        depositId = depositCount++;

        deposits[depositId] = Deposit({
            depositor: msg.sender,
            claimant: claimant,
            token: token,
            amount: actualAmount, // Store actual amount received, not requested amount
            startTime: startTime,
            deadline: deadline,
            claimed: false,
            title: title
        });

        emit DepositCreated(depositId, msg.sender, claimant, token, actualAmount, startTime, deadline, title);
    }

    /**
     * @notice Claim a deposit (only callable by the designated claimant)
     * @param depositId The ID of the deposit to claim
     */
    function claim(uint256 depositId) external nonReentrant {
        if (depositId >= depositCount) revert DepositNotFound();
        
        Deposit storage d = deposits[depositId];
        
        if (d.claimed) revert AlreadyClaimed();
        if (msg.sender != d.claimant) revert NotClaimant();
        if (d.startTime > 0 && block.timestamp < d.startTime) revert ClaimNotYetAllowed();

        d.claimed = true;

        _transfer(d.token, d.claimant, d.amount);

        emit Claimed(depositId, d.claimant);
    }

    /**
     * @notice Refund a deposit to the depositor (only after deadline has passed)
     * @param depositId The ID of the deposit to refund
     */
    function refund(uint256 depositId) external nonReentrant {
        if (depositId >= depositCount) revert DepositNotFound();
        
        Deposit storage d = deposits[depositId];
        
        if (d.claimed) revert AlreadyClaimed();
        if (msg.sender != d.depositor) revert NotDepositor();
        if (block.timestamp <= d.deadline) revert DeadlineNotReached();

        d.claimed = true;

        _transfer(d.token, d.depositor, d.amount);

        emit Refunded(depositId, d.depositor);
    }

    /**
     * @notice Get deposit details
     * @param depositId The ID of the deposit
     * @return depositor The address that made the deposit
     * @return claimant The address that can claim
     * @return token The token address (address(0) for ETH)
     * @return amount The deposit amount
     * @return startTime The timestamp from which claiming is allowed
     * @return deadline The claim deadline
     * @return claimed Whether already claimed/refunded
     * @return title The deposit title/label
     */
    function getDeposit(uint256 depositId) external view returns (
        address depositor,
        address claimant,
        address token,
        uint256 amount,
        uint256 startTime,
        uint256 deadline,
        bool claimed,
        string memory title
    ) {
        if (depositId >= depositCount) revert DepositNotFound();
        Deposit storage d = deposits[depositId];
        return (d.depositor, d.claimant, d.token, d.amount, d.startTime, d.deadline, d.claimed, d.title);
    }

    /**
     * @notice Internal function to transfer ETH or ERC20 tokens
     * @param token The token address (address(0) for ETH)
     * @param to The recipient address
     * @param amount The amount to transfer
     */
    function _transfer(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}

