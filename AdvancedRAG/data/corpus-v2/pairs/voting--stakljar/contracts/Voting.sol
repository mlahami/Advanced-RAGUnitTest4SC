// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Voting {
    struct Candidate {
        bytes32 fullName;
        uint32 voteCount;
    }

    enum VotingStatus { UNALLOWED, PENDING, VOTED }

    Candidate[] private candidates;
    mapping(address => VotingStatus) private voters;
    address[] private allowedVotersAddresses;
    address private owner;
    uint256 private startTime;
    uint256 private endTime;

    constructor(bytes32[] memory _candidates, address[] memory _allowedVoters, uint256 votingTime) {
        for(uint16 i = 0; i < _candidates.length; i++) {
            candidates.push(Candidate(_candidates[i], 0));
        }
        for(uint32 i = 0; i < _allowedVoters.length; i++) {
            voters[_allowedVoters[i]] = VotingStatus.PENDING;
            allowedVotersAddresses.push(_allowedVoters[i]);
        }
        startTime = block.timestamp;
        endTime = votingTime + block.timestamp;
        owner = msg.sender;
    }

    event Vote(address voter, bytes32 candidate);
    event Restart();

    modifier OnlyOwner() {
        require(msg.sender == owner, "Caller must be owner");
        _;
    }

    modifier VotingEnded() {
        require(endTime <= block.timestamp, "Voting needs to end");
        _;
    }

    modifier VotingInProgress() {
        require(endTime > block.timestamp, "Voting needs to be in progress");
        _;
    }

    function getStartTime() public view returns(uint256) {
        return startTime;
    }

    function getEndTime() public view returns(uint256) {
        return endTime;
    }

    function getCandidates() public view returns(Candidate[] memory) {
        return candidates;
    }

    function getVotingStatus() public view returns(VotingStatus) {
        return voters[msg.sender];
    }

    function getOwner() public view returns(address) {
        return owner;
    }

    function getHighestVoteCountOccurencies() private view returns(uint16) {
        uint32 highestVoteCount = 0;
        uint16 highestVoteOccurencies = 0;
        for(uint16 i = 0; i < candidates.length; i++) {
            if(highestVoteCount < candidates[i].voteCount) {
                highestVoteCount = candidates[i].voteCount;
                highestVoteOccurencies = 1;
            }
            else if(highestVoteCount == candidates[i].voteCount) {
                highestVoteOccurencies++;
            }
        }
        return highestVoteOccurencies;
    }

    function vote(uint16 candidateIndex) public VotingInProgress {
        require(voters[msg.sender] != VotingStatus.VOTED, "You have already voted");
        require(voters[msg.sender] != VotingStatus.UNALLOWED, "You do not have permission to vote");
        require(candidates.length > candidateIndex, "Candidate index is out of bounds");
        candidates[candidateIndex].voteCount++;
        voters[msg.sender] = VotingStatus.VOTED;
        emit Vote(msg.sender, candidates[candidateIndex].fullName);
    }

    function restartVoting(uint256 votingTime) public OnlyOwner VotingEnded {
        require(getHighestVoteCountOccurencies() > 1, "There needs to be more than 1 candidate with highest votes");
        endTime = votingTime + block.timestamp;
        for(uint16 i = 0; i < candidates.length; i++) {
            candidates[i].voteCount = 0;
        }
        for(uint32 i = 0; i < allowedVotersAddresses.length; i++) {
            voters[allowedVotersAddresses[i]] = VotingStatus.PENDING;
        }
        emit Restart();
    }
}
