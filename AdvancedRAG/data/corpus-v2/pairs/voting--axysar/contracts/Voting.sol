// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title iMaVote - Core Voting Contract (Draft)
/// @author AxAy Labs
/// @notice This is the initial prototype. Not production-ready.
contract Voting {
    address public admin;

    struct Candidate {
        uint256 id;
        string name;
        uint256 voteCount;
    }

    mapping(uint256 => Candidate) public candidates;
    uint256 public candidateCount;
    mapping(address => bool) public hasVoted;

    event CandidateAdded(uint256 indexed id, string name);
    event VoteCast(address indexed voter, uint256 indexed candidateId);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Voting: caller is not admin");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /// @notice Register a new candidate for the election
    /// @param _name Display name of the candidate
    function addCandidate(string calldata _name) external onlyAdmin {
        candidateCount++;
        candidates[candidateCount] = Candidate(candidateCount, _name, 0);
        emit CandidateAdded(candidateCount, _name);
    }

    /// @notice Cast a vote for a candidate
    /// @param _candidateId The ID of the candidate to vote for
    function vote(uint256 _candidateId) external {
        require(!hasVoted[msg.sender], "Voting: already voted");
        require(
            _candidateId > 0 && _candidateId <= candidateCount,
            "Voting: invalid candidate"
        );

        hasVoted[msg.sender] = true;
        candidates[_candidateId].voteCount++;
        emit VoteCast(msg.sender, _candidateId);
    }

    /// @notice Get the vote count for a specific candidate
    function getVotes(uint256 _candidateId) external view returns (uint256) {
        return candidates[_candidateId].voteCount;
    }
}
