// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Voting {
    address public immutable chairperson;
    string[] public candidates;
    mapping(address => bool) public hasVoted;
    mapping(uint256 => uint256) public votes;

    constructor(string[] memory names) {
        require(names.length >= 2, "need candidates");
        chairperson = msg.sender;
        candidates = names;
    }

    function vote(uint256 candidateId) external {
        require(!hasVoted[msg.sender], "already voted");
        require(candidateId < candidates.length, "invalid candidate");
        hasVoted[msg.sender] = true;
        votes[candidateId] += 1;
    }

    function winner() external view returns (uint256 winningId) {
        uint256 best;
        for (uint256 i = 0; i < candidates.length; i++) {
            if (votes[i] > best) {
                best = votes[i];
                winningId = i;
            }
        }
    }
}

