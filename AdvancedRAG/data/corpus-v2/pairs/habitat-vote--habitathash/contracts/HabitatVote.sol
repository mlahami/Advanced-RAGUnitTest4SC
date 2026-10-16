// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

contract HabitatVote {
    struct Voter {
        address voter; // The person who voted
        bool voted; // if true, that person already voted
        bool vote; // index of the voted proposal
    }

    struct InsuranceCase {
        address relatedTo; // Case is related to rental contract
        string description; // A description of why the person wants to claim insurance
        uint value; // How much the person wants to claim
    }

    //Owner of the contract
    address public owner;
    //How many votes needed to close the case. Increase as application scales.
    uint numberOfVotes = 11;
    //Case details
    InsuranceCase insuranceCase;

    // Keep track of the voters
    address[] public voters;
    mapping(address => Voter) public votes;

    constructor(
        address contractOwner,
        address relatedTo,
        string memory description,
        uint256 value
    ) {
        owner = contractOwner;
        insuranceCase = InsuranceCase(relatedTo, description, value);
    }

    event voted(address indexed _user, bool vote);
    event votingFinished(bool result);

    //Get the details of the case
    function getCase() public view returns (InsuranceCase memory) {
        return insuranceCase;
    }

    //Vote on the case
    function vote(bool value) public {
        require(votes[msg.sender].voted == false, "You have already voted");
        require(msg.sender != owner, "You can not vote for your own claim");
        require(voters.length < numberOfVotes, "The voting is over");

        votes[msg.sender].voted = true;
        voters.push(msg.sender);
        votes[msg.sender].vote = value;

        emit voted(msg.sender, value);
        if (voters.length == numberOfVotes) {
            emit votingFinished(getResult());
        }
    }

    //See what a specific address voted
    function getVoteByAddress(address addr) public view returns (bool) {
        require(votes[addr].voted, "This address has not voted");
        return votes[addr].vote;
    }

    //Get the final result of the voting
    function getResult() public view returns (bool) {
        require(voters.length == numberOfVotes, "Voting is not over");

        uint yesVote = 0;

        for (uint i = 0; i < voters.length; i++) {
            if (getVoteByAddress(voters[i])) {
                yesVote += 1;
            }
        }
        return yesVote > (numberOfVotes / 2);
    }
}
