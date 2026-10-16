# voting--axysar

- domain: voting-governance (voting)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/axysar/imavote @ ef33645c63f6c078b253e8c0e240aae7f268d466
- license: MIT
- targets: Voting.sol
- validation: 7 passing tests, 0 failing; statement coverage Voting.sol 100.0 %

## Contract: Voting.sol (primary target)

```solidity
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
```

## Tests: Voting.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Voting Contract", function () {
  let voting;
  let admin;
  let voter1;
  let voter2;

  beforeEach(async function () {
    [admin, voter1, voter2] = await ethers.getSigners();
    const VotingFactory = await ethers.getContractFactory("Voting");
    voting = await VotingFactory.deploy();
    await voting.waitForDeployment();
  });

  describe("Candidate Registration", function () {
    it("should allow admin to add candidates", async function () {
      await voting.addCandidate("Alice");
      expect(await voting.candidateCount()).to.equal(1);
      const candidate = await voting.candidates(1);
      expect(candidate.name).to.equal("Alice");
    });

    it("should reject non-admin candidate registration", async function () {
      await expect(
        voting.connect(voter1).addCandidate("Bob")
      ).to.be.revertedWith("Voting: caller is not admin");
    });

    it("should track multiple candidates correctly", async function () {
      await voting.addCandidate("Alice");
      await voting.addCandidate("Bob");
      await voting.addCandidate("Charlie");
      expect(await voting.candidateCount()).to.equal(3);
    });
  });

  describe("Voting", function () {
    beforeEach(async function () {
      await voting.addCandidate("Alice");
      await voting.addCandidate("Bob");
    });

    it("should allow a voter to cast a vote", async function () {
      await voting.connect(voter1).vote(1);
      expect(await voting.getVotes(1)).to.equal(1);
      expect(await voting.hasVoted(voter1.address)).to.be.true;
    });

    it("should prevent double voting", async function () {
      await voting.connect(voter1).vote(1);
      await expect(
        voting.connect(voter1).vote(2)
      ).to.be.revertedWith("Voting: already voted");
    });

    it("should reject votes for invalid candidates", async function () {
      await expect(voting.connect(voter1).vote(0)).to.be.revertedWith(
        "Voting: invalid candidate"
      );
      await expect(voting.connect(voter1).vote(99)).to.be.revertedWith(
        "Voting: invalid candidate"
      );
    });

    it("should correctly tally votes from multiple voters", async function () {
      await voting.connect(voter1).vote(1);
      await voting.connect(voter2).vote(1);
      expect(await voting.getVotes(1)).to.equal(2);
      expect(await voting.getVotes(2)).to.equal(0);
    });
  });
});
```
