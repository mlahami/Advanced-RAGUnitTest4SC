// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MilestoneEscrow
 * @notice Per-job escrow contract cloned by EscrowFactory. Holds funds for each milestone
 *         and releases them upon client approval or arbitrator resolution.
 */
contract MilestoneEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum MilestoneState { Pending, Submitted, Approved, Paid, Disputed, Resolved }
    enum EscrowState { Created, Funded, InProgress, Completed, Cancelled }

    struct Milestone {
        uint128 amount;
        uint64  dueDate;
        string  description;
        string  deliverableURI;
        bytes32 deliverableHash;
        MilestoneState state;
    }

    address public client;
    address public freelancer;
    address public arbitrator;
    IERC20  public token;
    EscrowState public escrowState;

    Milestone[] public milestones;

    // mutual cancel consent
    bool public clientConsentsCancel;
    bool public freelancerConsentsCancel;

    event Funded(uint256 totalAmount);
    event DeliverableSubmitted(uint256 indexed milestoneId, string uri, bytes32 hash);
    event MilestoneApproved(uint256 indexed milestoneId, uint256 amount);
    event DisputeOpened(uint256 indexed milestoneId, address indexed by, string reasonURI);
    event DisputeResolved(uint256 indexed milestoneId, bool awardedToFreelancer, uint256 amount);
    event CancelConsented(address indexed by);
    event Cancelled();

    error NotClient();
    error NotFreelancer();
    error NotArbitrator(address caller);
    error NotParty();
    error WrongEscrowState(EscrowState current);
    error WrongMilestoneState(uint256 id, MilestoneState current);
    error InvalidMilestone(uint256 id);
    error AlreadyInitialized();

    bool private _initialized;

    modifier onlyClient() {
        if (msg.sender != client) revert NotClient();
        _;
    }

    modifier onlyFreelancer() {
        if (msg.sender != freelancer) revert NotFreelancer();
        _;
    }

    modifier onlyArbitrator() {
        if (msg.sender != arbitrator) revert NotArbitrator(msg.sender);
        _;
    }

    modifier onlyParty() {
        if (msg.sender != client && msg.sender != freelancer) revert NotParty();
        _;
    }

    modifier inEscrowState(EscrowState expected) {
        if (escrowState != expected) revert WrongEscrowState(escrowState);
        _;
    }

    modifier validMilestone(uint256 id) {
        if (id >= milestones.length) revert InvalidMilestone(id);
        _;
    }

    struct MilestoneInput {
        uint128 amount;
        uint64  dueDate;
        string  description;
    }

    function initialize(
        address _client,
        address _freelancer,
        address _arbitrator,
        address _token,
        MilestoneInput[] calldata _milestones
    ) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;

        client     = _client;
        freelancer = _freelancer;
        arbitrator = _arbitrator;
        token      = IERC20(_token);
        escrowState = EscrowState.Created;

        for (uint256 i = 0; i < _milestones.length; i++) {
            milestones.push(Milestone({
                amount:          _milestones[i].amount,
                dueDate:         _milestones[i].dueDate,
                description:     _milestones[i].description,
                deliverableURI:  "",
                deliverableHash: bytes32(0),
                state:           MilestoneState.Pending
            }));
        }
    }

    // ── Client: deposit total funds ──────────────────────────────────────────

    function fund() external onlyClient inEscrowState(EscrowState.Created) nonReentrant {
        uint256 total = _totalAmount();
        token.safeTransferFrom(client, address(this), total);
        escrowState = EscrowState.Funded;
        emit Funded(total);
    }

    // ── Freelancer: submit deliverable for a milestone ───────────────────────

    function submitDeliverable(
        uint256 milestoneId,
        string calldata uri,
        bytes32 hash
    ) external onlyFreelancer validMilestone(milestoneId) {
        if (escrowState != EscrowState.Funded && escrowState != EscrowState.InProgress)
            revert WrongEscrowState(escrowState);

        Milestone storage m = milestones[milestoneId];
        if (m.state != MilestoneState.Pending) revert WrongMilestoneState(milestoneId, m.state);

        m.deliverableURI  = uri;
        m.deliverableHash = hash;
        m.state = MilestoneState.Submitted;

        if (escrowState == EscrowState.Funded) escrowState = EscrowState.InProgress;

        emit DeliverableSubmitted(milestoneId, uri, hash);
    }

    // ── Client: approve milestone → release payment ──────────────────────────

    function approveMilestone(uint256 milestoneId)
        external
        onlyClient
        validMilestone(milestoneId)
        nonReentrant
    {
        Milestone storage m = milestones[milestoneId];
        if (m.state != MilestoneState.Submitted) revert WrongMilestoneState(milestoneId, m.state);

        m.state = MilestoneState.Approved;
        _releaseMilestone(milestoneId, m);

        if (_allPaid()) escrowState = EscrowState.Completed;

        emit MilestoneApproved(milestoneId, m.amount);
    }

    // ── Party: open dispute on a submitted milestone ─────────────────────────

    function openDispute(uint256 milestoneId, string calldata reasonURI)
        external
        onlyParty
        validMilestone(milestoneId)
    {
        Milestone storage m = milestones[milestoneId];
        if (m.state != MilestoneState.Submitted) revert WrongMilestoneState(milestoneId, m.state);

        m.state = MilestoneState.Disputed;
        emit DisputeOpened(milestoneId, msg.sender, reasonURI);
    }

    // ── Arbitrator: resolve dispute ──────────────────────────────────────────

    function resolveDispute(uint256 milestoneId, bool awardToFreelancer)
        external
        onlyArbitrator
        validMilestone(milestoneId)
        nonReentrant
    {
        Milestone storage m = milestones[milestoneId];
        if (m.state != MilestoneState.Disputed) revert WrongMilestoneState(milestoneId, m.state);

        m.state = MilestoneState.Resolved;

        uint256 amount = m.amount;
        address recipient = awardToFreelancer ? freelancer : client;
        token.safeTransfer(recipient, amount);

        emit DisputeResolved(milestoneId, awardToFreelancer, amount);

        if (_allPaid()) escrowState = EscrowState.Completed;
    }

    // ── Mutual cancel ────────────────────────────────────────────────────────

    function consentCancel() external onlyParty {
        if (msg.sender == client) clientConsentsCancel = true;
        else freelancerConsentsCancel = true;

        emit CancelConsented(msg.sender);

        if (clientConsentsCancel && freelancerConsentsCancel) {
            _refundUnpaid();
        }
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function milestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    function getMilestone(uint256 id) external view returns (Milestone memory) {
        return milestones[id];
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _totalAmount() internal view returns (uint256 total) {
        for (uint256 i = 0; i < milestones.length; i++) {
            total += milestones[i].amount;
        }
    }

    function _releaseMilestone(uint256, Milestone storage m) internal {
        m.state = MilestoneState.Paid;
        token.safeTransfer(freelancer, m.amount);
    }

    function _allPaid() internal view returns (bool) {
        for (uint256 i = 0; i < milestones.length; i++) {
            MilestoneState s = milestones[i].state;
            if (s != MilestoneState.Paid && s != MilestoneState.Resolved) return false;
        }
        return true;
    }

    function _refundUnpaid() internal nonReentrant {
        uint256 refund;
        for (uint256 i = 0; i < milestones.length; i++) {
            Milestone storage m = milestones[i];
            if (m.state == MilestoneState.Pending || m.state == MilestoneState.Submitted) {
                refund += m.amount;
                m.state = MilestoneState.Resolved;
            }
        }
        escrowState = EscrowState.Cancelled;
        if (refund > 0) token.safeTransfer(client, refund);
        emit Cancelled();
    }
}
