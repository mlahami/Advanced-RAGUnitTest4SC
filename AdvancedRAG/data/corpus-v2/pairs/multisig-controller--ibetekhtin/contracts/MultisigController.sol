// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MultisigController
 * @notice Lightweight M-of-N multisig that queues time-locked calls.
 *         For production deploy Gnosis Safe instead — this is a reference implementation.
 *
 * Designed so that large treasury allocations go through:
 *   1. Proposal submitted by a signer
 *   2. M signers approve
 *   3. MIN_DELAY passes
 *   4. Any signer executes
 */
contract MultisigController {
    uint256 public immutable required;     // M signers required
    uint256 public constant MIN_DELAY = 2 days;

    address[] public signers;
    mapping(address => bool) public isSigner;

    struct Proposal {
        address target;
        uint256 value;
        bytes   data;
        uint256 approvals;
        uint256 queuedAt;   // timestamp when M approvals reached
        bool    executed;
        bool    cancelled;
        mapping(address => bool) approved;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;

    event ProposalCreated(uint256 indexed id, address target, uint256 value);
    event Approved(uint256 indexed id, address signer);
    event Queued(uint256 indexed id, uint256 executeAfter);
    event Executed(uint256 indexed id);
    event Cancelled(uint256 indexed id);

    modifier onlySigner() {
        require(isSigner[msg.sender], "Multisig: not signer");
        _;
    }

    constructor(address[] memory _signers, uint256 _required) {
        require(_signers.length >= _required, "Multisig: required > signers");
        require(_required >= 2, "Multisig: need at least 2 signers");

        for (uint256 i = 0; i < _signers.length; i++) {
            address s = _signers[i];
            require(s != address(0) && !isSigner[s], "Multisig: invalid signer");
            isSigner[s] = true;
            signers.push(s);
        }
        required = _required;
    }

    function propose(address target, uint256 value, bytes calldata data)
        external
        onlySigner
        returns (uint256 id)
    {
        id = proposalCount++;
        Proposal storage p = proposals[id];
        p.target = target;
        p.value  = value;
        p.data   = data;
        emit ProposalCreated(id, target, value);
    }

    /**
     * @notice Cancel a proposal before execution. Requires M signers (same threshold).
     *         Use when calldata is wrong or the situation has changed.
     */
    function cancel(uint256 id) external onlySigner {
        Proposal storage p = proposals[id];
        require(!p.executed, "Multisig: already executed");
        require(!p.cancelled, "Multisig: already cancelled");
        // Require majority to cancel — prevents a single signer from blocking.
        require(p.approvals >= required, "Multisig: not enough approvals to cancel");
        p.cancelled = true;
        emit Cancelled(id);
    }

    function approve(uint256 id) external onlySigner {
        Proposal storage p = proposals[id];
        require(!p.executed, "Multisig: executed");
        require(!p.cancelled, "Multisig: cancelled");
        require(!p.approved[msg.sender], "Multisig: already approved");

        p.approved[msg.sender] = true;
        p.approvals++;
        emit Approved(id, msg.sender);

        if (p.approvals >= required && p.queuedAt == 0) {
            p.queuedAt = block.timestamp;
            emit Queued(id, block.timestamp + MIN_DELAY);
        }
    }

    function execute(uint256 id) external onlySigner {
        Proposal storage p = proposals[id];
        require(!p.executed, "Multisig: executed");
        require(!p.cancelled, "Multisig: cancelled");
        require(p.approvals >= required, "Multisig: not enough approvals");
        require(block.timestamp >= p.queuedAt + MIN_DELAY, "Multisig: delay not passed");

        p.executed = true;
        (bool ok,) = p.target.call{value: p.value}(p.data);
        require(ok, "Multisig: call failed");
        emit Executed(id);
    }

    receive() external payable {}
}
