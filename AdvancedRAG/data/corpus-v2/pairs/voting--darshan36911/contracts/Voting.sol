// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title A simple decentralized voting contract
/// @notice Anyone can create a proposal and anyone can vote For or Against it once,
///         until the proposal's deadline passes. Built as a beginner-friendly
///         introduction to core Solidity patterns: structs, mappings, modifiers,
///         events, and access control.
contract Voting {
    struct Proposal {
        uint256 id;
        string description;
        uint256 voteCountFor;
        uint256 voteCountAgainst;
        uint256 deadline;
        address creator;
        bool exists;
    }

    address public owner;
    uint256 public proposalCount;

    // proposalId => Proposal
    mapping(uint256 => Proposal) public proposals;
    // proposalId => voterAddress => hasVoted
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(
        uint256 indexed id,
        string description,
        uint256 deadline,
        address indexed creator
    );
    event Voted(uint256 indexed id, address indexed voter, bool support);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier proposalExists(uint256 _proposalId) {
        require(proposals[_proposalId].exists, "Proposal does not exist");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Create a new proposal that stays open for `_durationInSeconds`.
    /// @param _description Human-readable text describing what's being voted on.
    /// @param _durationInSeconds How long (from now) voting stays open.
    function createProposal(string calldata _description, uint256 _durationInSeconds) external {
        require(bytes(_description).length > 0, "Description required");
        require(_durationInSeconds > 0, "Duration must be positive");

        proposalCount++;
        uint256 deadline = block.timestamp + _durationInSeconds;

        proposals[proposalCount] = Proposal({
            id: proposalCount,
            description: _description,
            voteCountFor: 0,
            voteCountAgainst: 0,
            deadline: deadline,
            creator: msg.sender,
            exists: true
        });

        emit ProposalCreated(proposalCount, _description, deadline, msg.sender);
    }

    /// @notice Cast a vote on a proposal. Each address can vote once per proposal.
    /// @param _proposalId The proposal to vote on.
    /// @param _support True for "For", false for "Against".
    function vote(uint256 _proposalId, bool _support) external proposalExists(_proposalId) {
        Proposal storage p = proposals[_proposalId];
        require(block.timestamp < p.deadline, "Voting closed");
        require(!hasVoted[_proposalId][msg.sender], "Already voted");

        hasVoted[_proposalId][msg.sender] = true;

        if (_support) {
            p.voteCountFor++;
        } else {
            p.voteCountAgainst++;
        }

        emit Voted(_proposalId, msg.sender, _support);
    }

    /// @notice Read all details of a single proposal, including whether it's still active.
    function getProposal(uint256 _proposalId)
        external
        view
        proposalExists(_proposalId)
        returns (
            uint256 id,
            string memory description,
            uint256 voteCountFor,
            uint256 voteCountAgainst,
            uint256 deadline,
            address creator,
            bool isActive
        )
    {
        Proposal memory p = proposals[_proposalId];
        return (
            p.id,
            p.description,
            p.voteCountFor,
            p.voteCountAgainst,
            p.deadline,
            p.creator,
            block.timestamp < p.deadline
        );
    }

    /// @notice Returns the ids of every proposal ever created, for easy frontend iteration.
    function getAllProposalIds() external view returns (uint256[] memory) {
        uint256[] memory ids = new uint256[](proposalCount);
        for (uint256 i = 1; i <= proposalCount; i++) {
            ids[i - 1] = i;
        }
        return ids;
    }

    /// @notice Check whether a given address has already voted on a proposal.
    function checkHasVoted(uint256 _proposalId, address _voter) external view returns (bool) {
        return hasVoted[_proposalId][_voter];
    }
}
