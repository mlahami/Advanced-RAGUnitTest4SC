// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PledgeVault
/// @notice Commitment device with real stakes. The pledger locks tokens in
///         this vault against a goal. A witness resolves the pledge: success
///         returns the stake to the pledger, failure fires it to the
///         pre-nominated failure destination. If the witness never acts,
///         anyone may slash after the deadline plus a grace window.
///
///         The witness is notified AT the deadline (product behavior), so
///         resolution stays valid after the deadline; WITNESS_GRACE_PERIOD
///         exists so a griefer cannot front-run the witness with claimExpired
///         one second past the deadline. failureDestination is a per-pledge
///         parameter — any nonzero address — by design; the curated list is
///         a frontend concern.
contract PledgeVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Window after the deadline in which only the witness can act.
    uint64 public constant WITNESS_GRACE_PERIOD = 72 hours;

    struct Pledge {
        address pledger;
        address witness;
        address failureDestination;
        address token;
        uint256 amount;
        uint64 deadline; // unix seconds
        bool resolved;
        bool succeeded;
    }

    mapping(bytes32 => Pledge) private _pledges;
    uint256 private _nonce;

    event PledgeCreated(
        bytes32 indexed pledgeId,
        address indexed pledger,
        address indexed witness,
        address token,
        uint256 amount,
        uint64 deadline,
        address failureDestination
    );

    event PledgeSucceeded(bytes32 indexed pledgeId, address indexed witness, uint256 amountReturned);

    event PledgeFailed(
        bytes32 indexed pledgeId,
        address indexed witness,
        address indexed failureDestination,
        uint256 amountSlashed
    );

    event PledgeExpiredSlashed(
        bytes32 indexed pledgeId,
        address indexed caller,
        address indexed failureDestination,
        uint256 amountSlashed
    );

    error PledgeNotFound();
    error NotWitness();
    error AlreadyResolved();
    error ZeroAddress();
    error ZeroAmount();
    error WitnessIsPledger();
    error DeadlineInPast();
    error GracePeriodActive(uint64 claimableAt);

    /// @notice Lock `amount` of `token` against a goal. Pulls the stake into
    ///         the vault; the pledger must have approved it beforehand.
    function createPledge(
        address witness,
        address failureDestination,
        address token,
        uint256 amount,
        uint64 deadline
    ) external nonReentrant returns (bytes32 pledgeId) {
        if (witness == address(0) || token == address(0)) revert ZeroAddress();
        if (failureDestination == address(0)) revert ZeroAddress();
        if (witness == msg.sender) revert WitnessIsPledger();
        if (amount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert DeadlineInPast();

        pledgeId = keccak256(abi.encode(msg.sender, witness, token, _nonce++));

        _pledges[pledgeId] = Pledge({
            pledger: msg.sender,
            witness: witness,
            failureDestination: failureDestination,
            token: token,
            amount: amount,
            deadline: deadline,
            resolved: false,
            succeeded: false
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit PledgeCreated(pledgeId, msg.sender, witness, token, amount, deadline, failureDestination);
    }

    /// @notice Witness confirms the goal was met: stake returns to the pledger.
    ///         Valid any time before another resolution path lands — early
    ///         completion and post-deadline confirmation both work.
    function confirmSuccess(bytes32 pledgeId) external nonReentrant {
        Pledge storage pledge = _loadForWitness(pledgeId);

        pledge.resolved = true;
        pledge.succeeded = true;

        IERC20(pledge.token).safeTransfer(pledge.pledger, pledge.amount);

        emit PledgeSucceeded(pledgeId, msg.sender, pledge.amount);
    }

    /// @notice Witness confirms failure: the stake fires to the nominated
    ///         failure destination. That was the point.
    function confirmFailure(bytes32 pledgeId) external nonReentrant {
        Pledge storage pledge = _loadForWitness(pledgeId);

        pledge.resolved = true;

        IERC20(pledge.token).safeTransfer(pledge.failureDestination, pledge.amount);

        emit PledgeFailed(pledgeId, msg.sender, pledge.failureDestination, pledge.amount);
    }

    /// @notice Permissionless slash when the witness never acted: callable by
    ///         anyone once the deadline plus grace window has fully passed.
    function claimExpired(bytes32 pledgeId) external nonReentrant {
        Pledge storage pledge = _pledges[pledgeId];

        if (pledge.pledger == address(0)) revert PledgeNotFound();
        if (pledge.resolved) revert AlreadyResolved();

        uint64 claimableAt = pledge.deadline + WITNESS_GRACE_PERIOD;
        if (block.timestamp <= claimableAt) revert GracePeriodActive(claimableAt);

        pledge.resolved = true;

        IERC20(pledge.token).safeTransfer(pledge.failureDestination, pledge.amount);

        emit PledgeExpiredSlashed(pledgeId, msg.sender, pledge.failureDestination, pledge.amount);
    }

    /// @notice Full pledge state, for the indexer and any off-chain reader.
    function getPledge(bytes32 pledgeId) external view returns (Pledge memory) {
        return _pledges[pledgeId];
    }

    function _loadForWitness(bytes32 pledgeId) private view returns (Pledge storage pledge) {
        pledge = _pledges[pledgeId];
        if (pledge.pledger == address(0)) revert PledgeNotFound();
        if (msg.sender != pledge.witness) revert NotWitness();
        if (pledge.resolved) revert AlreadyResolved();
    }
}
