// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DAOGovernance
 * @dev Decentralized governance for AI hedge fund agents
 * @notice This contract manages proposals, voting, and execution of governance decisions
 */
contract DAOGovernance {

    // Governance token for voting
    mapping(address => uint256) public votingPower;
    uint256 public totalVotingPower;

    // Proposal structure
    struct Proposal {
        uint256 id;
        address proposer;
        string description;
        ProposalType proposalType;
        bytes data;
        uint256 startTime;
        uint256 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        bool canceled;
        mapping(address => bool) hasVoted;
    }

    enum ProposalType {
        ENABLE_AGENT,
        DISABLE_AGENT,
        ADJUST_ALLOCATION,
        WITHDRAW_FUNDS,
        EMERGENCY_STOP,
        PARAMETER_CHANGE
    }

    // State variables
    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;
    uint256 public votingPeriod = 3 days;
    uint256 public quorum = 10; // 10%
    uint256 public proposalThreshold = 100; // Minimum tokens to propose

    address public admin;
    bool public paused;

    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string description,
        ProposalType proposalType
    );

    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 weight
    );

    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);
    event VotingPowerUpdated(address indexed account, uint256 newPower);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier notPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    constructor() {
        admin = msg.sender;
        paused = false;
    }

    /**
     * @dev Distribute voting power to participants
     * @param account Address to receive voting power
     * @param amount Amount of voting power
     */
    function grantVotingPower(address account, uint256 amount) external onlyAdmin {
        votingPower[account] += amount;
        totalVotingPower += amount;
        emit VotingPowerUpdated(account, votingPower[account]);
    }

    /**
     * @dev Create a new governance proposal
     * @param description Human-readable description
     * @param proposalType Type of proposal
     * @param data Encoded data for execution
     */
    function propose(
        string memory description,
        ProposalType proposalType,
        bytes memory data
    ) external notPaused returns (uint256) {
        require(
            votingPower[msg.sender] >= proposalThreshold,
            "Insufficient voting power to propose"
        );

        proposalCount++;
        uint256 proposalId = proposalCount;
        Proposal storage proposal = proposals[proposalId];

        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.description = description;
        proposal.proposalType = proposalType;
        proposal.data = data;
        proposal.startTime = block.timestamp;
        proposal.endTime = block.timestamp + votingPeriod;
        proposal.executed = false;
        proposal.canceled = false;

        emit ProposalCreated(proposalId, msg.sender, description, proposalType);

        return proposalId;
    }

    /**
     * @dev Cast a vote on a proposal
     * @param proposalId ID of the proposal
     * @param support True for yes, false for no
     */
    function castVote(uint256 proposalId, bool support) external notPaused {
        require(proposalId > 0 && proposalId <= proposalCount, "Proposal does not exist");
        Proposal storage proposal = proposals[proposalId];
        require(!proposal.canceled, "Proposal is canceled");
        require(block.timestamp >= proposal.startTime, "Voting not started");
        require(block.timestamp <= proposal.endTime, "Voting period has ended");
        require(!proposal.hasVoted[msg.sender], "Already voted");
        require(votingPower[msg.sender] > 0, "No voting power");

        uint256 weight = votingPower[msg.sender];
        proposal.hasVoted[msg.sender] = true;

        if (support) {
            proposal.forVotes += weight;
        } else {
            proposal.againstVotes += weight;
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    /**
     * @dev Execute a passed proposal
     * @param proposalId ID of the proposal to execute
     */
    function executeProposal(uint256 proposalId) external notPaused {
        Proposal storage proposal = proposals[proposalId];

        require(block.timestamp > proposal.endTime, "Voting period has not ended");
        require(!proposal.executed, "Proposal already executed");
        require(!proposal.canceled, "Proposal is canceled");

        // Check quorum and majority
        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
        require(
            totalVotes * 100 >= totalVotingPower * quorum,
            "Quorum not reached"
        );
        require(proposal.forVotes > proposal.againstVotes, "Proposal did not pass");

        proposal.executed = true;

        // Execution logic would interface with TreasuryManager or AgentRegistry
        // For now, we emit an event that can be monitored off-chain

        emit ProposalExecuted(proposalId);
    }

    /**
     * @dev Cancel a proposal (proposer or admin only)
     * @param proposalId ID of the proposal to cancel
     */
    function cancelProposal(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];

        require(
            msg.sender == proposal.proposer || msg.sender == admin,
            "Only proposer can cancel"
        );
        require(!proposal.executed, "Proposal already executed");
        require(block.timestamp <= proposal.endTime, "Voting period has ended");

        proposal.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    /**
     * @dev Get proposal details
     * @param proposalId ID of the proposal
     */
    function getProposal(uint256 proposalId) external view returns (
        address proposer,
        string memory description,
        ProposalType proposalType,
        uint256 startTime,
        uint256 endTime,
        uint256 forVotes,
        uint256 againstVotes,
        bool executed,
        bool canceled
    ) {
        Proposal storage proposal = proposals[proposalId];
        return (
            proposal.proposer,
            proposal.description,
            proposal.proposalType,
            proposal.startTime,
            proposal.endTime,
            proposal.forVotes,
            proposal.againstVotes,
            proposal.executed,
            proposal.canceled
        );
    }

    /**
     * @dev Check if an address has voted on a proposal
     * @param proposalId ID of the proposal
     * @param voter Address to check
     */
    function hasVoted(uint256 proposalId, address voter) external view returns (bool) {
        return proposals[proposalId].hasVoted[voter];
    }

    /**
     * @dev Emergency pause
     */
    function pause() external onlyAdmin {
        paused = true;
    }

    /**
     * @dev Unpause
     */
    function unpause() external onlyAdmin {
        paused = false;
    }

    /**
     * @dev Update voting period
     * @param newPeriod New voting period in seconds
     */
    function setVotingPeriod(uint256 newPeriod) external onlyAdmin {
        require(newPeriod >= 1 days && newPeriod <= 7 days, "Invalid period");
        votingPeriod = newPeriod;
    }

    /**
     * @dev Update quorum percentage
     * @param newQuorum New quorum (0-100)
     */
    function setQuorum(uint256 newQuorum) external onlyAdmin {
        require(newQuorum > 0 && newQuorum <= 100, "Invalid quorum");
        quorum = newQuorum;
    }

    /**
     * @dev Update proposal threshold
     * @param newThreshold New minimum voting power required to create proposals
     */
    function setProposalThreshold(uint256 newThreshold) external onlyAdmin {
        require(newThreshold > 0, "Threshold must be > 0");
        proposalThreshold = newThreshold;
    }

}
