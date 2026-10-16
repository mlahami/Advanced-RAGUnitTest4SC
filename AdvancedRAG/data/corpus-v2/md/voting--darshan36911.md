# voting--darshan36911

- domain: voting-governance (voting)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Darshan36911/onchain-voting-dapp @ b1528351ce222ba6d3e2ea33b98fc2957d828ae4
- license: MIT
- targets: Voting.sol
- validation: 17 passing tests, 0 failing; statement coverage Voting.sol 94.12 %

## Contract: Voting.sol (primary target)

```solidity
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
```

## Tests: Voting.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyUint } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("Voting", function () {
  let voting, owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    const Voting = await ethers.getContractFactory("Voting");
    voting = await Voting.deploy();
    await voting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("sets the deployer as owner", async function () {
      expect(await voting.owner()).to.equal(owner.address);
    });

    it("starts with zero proposals", async function () {
      expect(await voting.proposalCount()).to.equal(0);
    });
  });

  describe("Creating proposals", function () {
    it("lets anyone create a proposal", async function () {
      await voting.connect(addr1).createProposal("Should we add feature X?", 3600);
      expect(await voting.proposalCount()).to.equal(1);

      const proposal = await voting.getProposal(1);
      expect(proposal.description).to.equal("Should we add feature X?");
      expect(proposal.creator).to.equal(addr1.address);
      expect(proposal.isActive).to.equal(true);
    });

    it("emits a ProposalCreated event", async function () {
      await expect(voting.createProposal("Test proposal", 3600))
        .to.emit(voting, "ProposalCreated")
        .withArgs(1, "Test proposal", anyUint, owner.address);
    });

    it("rejects an empty description", async function () {
      await expect(voting.createProposal("", 3600)).to.be.revertedWith("Description required");
    });

    it("rejects a zero duration", async function () {
      await expect(voting.createProposal("Test", 0)).to.be.revertedWith("Duration must be positive");
    });
  });

  describe("Voting", function () {
    beforeEach(async function () {
      await voting.createProposal("Test proposal", 3600);
    });

    it("counts a For vote", async function () {
      await voting.connect(addr1).vote(1, true);
      const proposal = await voting.getProposal(1);
      expect(proposal.voteCountFor).to.equal(1);
      expect(proposal.voteCountAgainst).to.equal(0);
    });

    it("counts an Against vote", async function () {
      await voting.connect(addr1).vote(1, false);
      const proposal = await voting.getProposal(1);
      expect(proposal.voteCountFor).to.equal(0);
      expect(proposal.voteCountAgainst).to.equal(1);
    });

    it("emits a Voted event", async function () {
      await expect(voting.connect(addr1).vote(1, true))
        .to.emit(voting, "Voted")
        .withArgs(1, addr1.address, true);
    });

    it("prevents the same address from voting twice", async function () {
      await voting.connect(addr1).vote(1, true);
      await expect(voting.connect(addr1).vote(1, true)).to.be.revertedWith("Already voted");
    });

    it("allows different addresses to vote independently", async function () {
      await voting.connect(addr1).vote(1, true);
      await voting.connect(addr2).vote(1, false);

      const proposal = await voting.getProposal(1);
      expect(proposal.voteCountFor).to.equal(1);
      expect(proposal.voteCountAgainst).to.equal(1);
    });

    it("rejects votes on a nonexistent proposal", async function () {
      await expect(voting.connect(addr1).vote(99, true)).to.be.revertedWith(
        "Proposal does not exist"
      );
    });

    it("rejects votes after the deadline has passed", async function () {
      await voting.createProposal("Short-lived proposal", 10);
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine");

      await expect(voting.connect(addr1).vote(2, true)).to.be.revertedWith("Voting closed");
    });

    it("reports isActive as false once the deadline passes", async function () {
      await voting.createProposal("Short-lived proposal", 10);
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine");

      const proposal = await voting.getProposal(2);
      expect(proposal.isActive).to.equal(false);
    });
  });

  describe("Reading proposals", function () {
    it("returns all proposal ids in order", async function () {
      await voting.createProposal("Proposal 1", 3600);
      await voting.createProposal("Proposal 2", 3600);
      await voting.createProposal("Proposal 3", 3600);

      const ids = await voting.getAllProposalIds();
      expect(ids.map((id) => Number(id))).to.deep.equal([1, 2, 3]);
    });

    it("reverts when reading a nonexistent proposal", async function () {
      await expect(voting.getProposal(1)).to.be.revertedWith("Proposal does not exist");
    });

    it("correctly reports whether an address has voted", async function () {
      await voting.createProposal("Test proposal", 3600);
      expect(await voting.checkHasVoted(1, addr1.address)).to.equal(false);

      await voting.connect(addr1).vote(1, true);
      expect(await voting.checkHasVoted(1, addr1.address)).to.equal(true);
    });
  });
});
```
