# daogovernance--mohin-io

- domain: voting-governance (voting)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/mohin-io/Decentralized-Autonomous-Hedge-Fund-AI-DAO @ 8dbc75dbd1ab7b1dc89ac2a7265f624e7b0854a7
- license: MIT
- targets: DAOGovernance.sol
- validation: 38 passing tests, 0 failing; statement coverage DAOGovernance.sol 91.89 %

## Contract: DAOGovernance.sol (primary target)

```solidity
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
```

## Tests: DAOGovernance.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DAOGovernance", function () {
  let daoGovernance;
  let owner, addr1, addr2, addr3;
  const VOTING_PERIOD = 3 * 24 * 60 * 60; // 3 days in seconds
  const PROPOSAL_THRESHOLD = 100;
  const QUORUM = 10; // 10%

  beforeEach(async function () {
    // Get signers
    [owner, addr1, addr2, addr3] = await ethers.getSigners();

    // Deploy DAOGovernance contract
    const DAOGovernance = await ethers.getContractFactory("DAOGovernance");
    daoGovernance = await DAOGovernance.deploy();
    await daoGovernance.waitForDeployment();

    // Grant voting power to test addresses
    await daoGovernance.grantVotingPower(owner.address, 5000);
    await daoGovernance.grantVotingPower(addr1.address, 3000);
    await daoGovernance.grantVotingPower(addr2.address, 2000);
  });

  describe("Deployment", function () {
    it("Should set the correct admin", async function () {
      expect(await daoGovernance.admin()).to.equal(owner.address);
    });

    it("Should initialize with paused = false", async function () {
      expect(await daoGovernance.paused()).to.equal(false);
    });

    it("Should set correct voting period", async function () {
      expect(await daoGovernance.votingPeriod()).to.equal(VOTING_PERIOD);
    });

    it("Should set correct quorum", async function () {
      expect(await daoGovernance.quorum()).to.equal(QUORUM);
    });

    it("Should set correct proposal threshold", async function () {
      expect(await daoGovernance.proposalThreshold()).to.equal(PROPOSAL_THRESHOLD);
    });
  });

  describe("Voting Power Management", function () {
    it("Should allow admin to grant voting power", async function () {
      await daoGovernance.grantVotingPower(addr3.address, 1000);
      expect(await daoGovernance.votingPower(addr3.address)).to.equal(1000);
    });

    it("Should update total voting power correctly", async function () {
      const initialTotal = await daoGovernance.totalVotingPower();
      await daoGovernance.grantVotingPower(addr3.address, 1000);
      expect(await daoGovernance.totalVotingPower()).to.equal(initialTotal + BigInt(1000));
    });

    it("Should emit VotingPowerUpdated event", async function () {
      await expect(daoGovernance.grantVotingPower(addr3.address, 1000))
        .to.emit(daoGovernance, "VotingPowerUpdated")
        .withArgs(addr3.address, 1000);
    });

    it("Should revert if non-admin tries to grant voting power", async function () {
      await expect(
        daoGovernance.connect(addr1).grantVotingPower(addr3.address, 1000)
      ).to.be.revertedWith("Only admin");
    });
  });

  describe("Proposal Creation", function () {
    it("Should allow user with sufficient voting power to create proposal", async function () {
      await daoGovernance.grantVotingPower(addr1.address, 100);

      await expect(
        daoGovernance.connect(addr1).propose(
          "Enable new momentum agent",
          0, // ENABLE_AGENT
          ethers.encodeBytes32String("agent_data")
        )
      ).to.emit(daoGovernance, "ProposalCreated");
    });

    it("Should revert if user has insufficient voting power", async function () {
      await expect(
        daoGovernance.connect(addr3).propose(
          "Test proposal",
          0,
          ethers.encodeBytes32String("data")
        )
      ).to.be.revertedWith("Insufficient voting power to propose");
    });

    it("Should increment proposal count", async function () {
      const initialCount = await daoGovernance.proposalCount();

      await daoGovernance.propose(
        "Test proposal",
        0,
        ethers.encodeBytes32String("data")
      );

      expect(await daoGovernance.proposalCount()).to.equal(initialCount + BigInt(1));
    });

    it("Should set correct proposal parameters", async function () {
      await daoGovernance.propose(
        "Enable new agent",
        0, // ENABLE_AGENT
        ethers.encodeBytes32String("data")
      );

      const proposal = await daoGovernance.proposals(1);
      expect(proposal.proposer).to.equal(owner.address);
      expect(proposal.description).to.equal("Enable new agent");
      expect(proposal.proposalType).to.equal(0);
      expect(proposal.forVotes).to.equal(0);
      expect(proposal.againstVotes).to.equal(0);
      expect(proposal.executed).to.equal(false);
      expect(proposal.canceled).to.equal(false);
    });

    it("Should revert when paused", async function () {
      await daoGovernance.pause();

      await expect(
        daoGovernance.propose(
          "Test proposal",
          0,
          ethers.encodeBytes32String("data")
        )
      ).to.be.revertedWith("Contract is paused");
    });
  });

  describe("Voting", function () {
    let proposalId;

    beforeEach(async function () {
      // Create a proposal
      const tx = await daoGovernance.propose(
        "Enable new agent",
        0,
        ethers.encodeBytes32String("data")
      );
      const receipt = await tx.wait();
      proposalId = 1; // First proposal
    });

    it("Should allow users to vote in favor", async function () {
      await expect(daoGovernance.connect(addr1).castVote(proposalId, true))
        .to.emit(daoGovernance, "VoteCast")
        .withArgs(proposalId, addr1.address, true, 3000);
    });

    it("Should allow users to vote against", async function () {
      await expect(daoGovernance.connect(addr1).castVote(proposalId, false))
        .to.emit(daoGovernance, "VoteCast")
        .withArgs(proposalId, addr1.address, false, 3000);
    });

    it("Should update vote counts correctly", async function () {
      await daoGovernance.connect(addr1).castVote(proposalId, true);
      await daoGovernance.connect(addr2).castVote(proposalId, false);

      const proposal = await daoGovernance.proposals(proposalId);
      expect(proposal.forVotes).to.equal(3000);
      expect(proposal.againstVotes).to.equal(2000);
    });

    it("Should prevent double voting", async function () {
      await daoGovernance.connect(addr1).castVote(proposalId, true);

      await expect(
        daoGovernance.connect(addr1).castVote(proposalId, true)
      ).to.be.revertedWith("Already voted");
    });

    it("Should revert voting on non-existent proposal", async function () {
      await expect(
        daoGovernance.connect(addr1).castVote(999, true)
      ).to.be.revertedWith("Proposal does not exist");
    });

    it("Should revert voting after voting period ends", async function () {
      // Fast forward time past voting period
      await time.increase(VOTING_PERIOD + 1);

      await expect(
        daoGovernance.connect(addr1).castVote(proposalId, true)
      ).to.be.revertedWith("Voting period has ended");
    });

    it("Should revert if user has no voting power", async function () {
      await expect(
        daoGovernance.connect(addr3).castVote(proposalId, true)
      ).to.be.revertedWith("No voting power");
    });
  });

  describe("Proposal Execution", function () {
    let proposalId;

    beforeEach(async function () {
      const tx = await daoGovernance.propose(
        "Enable new agent",
        0,
        ethers.encodeBytes32String("data")
      );
      proposalId = 1;
    });

    it("Should execute proposal that passes quorum", async function () {
      // Vote with enough voting power to pass quorum (>10% of total)
      await daoGovernance.connect(owner).castVote(proposalId, true);
      await daoGovernance.connect(addr1).castVote(proposalId, true);

      // Fast forward past voting period
      await time.increase(VOTING_PERIOD + 1);

      await expect(daoGovernance.executeProposal(proposalId))
        .to.emit(daoGovernance, "ProposalExecuted")
        .withArgs(proposalId);
    });

    it("Should revert if proposal doesn't meet quorum", async function () {
      // Grant minimal voting power to addr3 (less than quorum)
      await daoGovernance.grantVotingPower(addr3.address, 500); // 5% of total

      // Vote with insufficient voting power
      await daoGovernance.connect(addr3).castVote(proposalId, true);

      await time.increase(VOTING_PERIOD + 1);

      await expect(
        daoGovernance.executeProposal(proposalId)
      ).to.be.revertedWith("Quorum not reached");
    });

    it("Should revert if proposal doesn't have majority support", async function () {
      await daoGovernance.connect(owner).castVote(proposalId, false);
      await daoGovernance.connect(addr1).castVote(proposalId, false);

      await time.increase(VOTING_PERIOD + 1);

      await expect(
        daoGovernance.executeProposal(proposalId)
      ).to.be.revertedWith("Proposal did not pass");
    });

    it("Should revert execution before voting period ends", async function () {
      await daoGovernance.connect(owner).castVote(proposalId, true);

      await expect(
        daoGovernance.executeProposal(proposalId)
      ).to.be.revertedWith("Voting period has not ended");
    });

    it("Should prevent double execution", async function () {
      await daoGovernance.connect(owner).castVote(proposalId, true);
      await daoGovernance.connect(addr1).castVote(proposalId, true);

      await time.increase(VOTING_PERIOD + 1);

      await daoGovernance.executeProposal(proposalId);

      await expect(
        daoGovernance.executeProposal(proposalId)
      ).to.be.revertedWith("Proposal already executed");
    });
  });

  describe("Proposal Cancellation", function () {
    let proposalId;

    beforeEach(async function () {
      const tx = await daoGovernance.propose(
        "Test proposal",
        0,
        ethers.encodeBytes32String("data")
      );
      proposalId = 1;
    });

    it("Should allow proposer to cancel their proposal", async function () {
      await expect(daoGovernance.cancelProposal(proposalId))
        .to.emit(daoGovernance, "ProposalCanceled")
        .withArgs(proposalId);
    });

    it("Should revert if non-proposer tries to cancel", async function () {
      await expect(
        daoGovernance.connect(addr1).cancelProposal(proposalId)
      ).to.be.revertedWith("Only proposer can cancel");
    });

    it("Should prevent voting on canceled proposal", async function () {
      await daoGovernance.cancelProposal(proposalId);

      await expect(
        daoGovernance.connect(addr1).castVote(proposalId, true)
      ).to.be.revertedWith("Proposal is canceled");
    });

    it("Should prevent executing canceled proposal", async function () {
      await daoGovernance.cancelProposal(proposalId);
      await time.increase(VOTING_PERIOD + 1);

      await expect(
        daoGovernance.executeProposal(proposalId)
      ).to.be.revertedWith("Proposal is canceled");
    });
  });

  describe("Pause Functionality", function () {
    it("Should allow admin to pause contract", async function () {
      await daoGovernance.pause();
      expect(await daoGovernance.paused()).to.equal(true);
    });

    it("Should allow admin to unpause contract", async function () {
      await daoGovernance.pause();
      await daoGovernance.unpause();
      expect(await daoGovernance.paused()).to.equal(false);
    });

    it("Should revert if non-admin tries to pause", async function () {
      await expect(
        daoGovernance.connect(addr1).pause()
      ).to.be.revertedWith("Only admin");
    });

    it("Should prevent proposals when paused", async function () {
      await daoGovernance.pause();

      await expect(
        daoGovernance.propose(
          "Test",
          0,
          ethers.encodeBytes32String("data")
        )
      ).to.be.revertedWith("Contract is paused");
    });
  });

  describe("Governance Parameter Updates", function () {
    it("Should allow admin to update voting period", async function () {
      const newPeriod = 7 * 24 * 60 * 60; // 7 days
      await daoGovernance.setVotingPeriod(newPeriod);
      expect(await daoGovernance.votingPeriod()).to.equal(newPeriod);
    });

    it("Should allow admin to update quorum", async function () {
      await daoGovernance.setQuorum(20);
      expect(await daoGovernance.quorum()).to.equal(20);
    });

    it("Should allow admin to update proposal threshold", async function () {
      await daoGovernance.setProposalThreshold(500);
      expect(await daoGovernance.proposalThreshold()).to.equal(500);
    });

    it("Should revert if non-admin tries to update parameters", async function () {
      await expect(
        daoGovernance.connect(addr1).setQuorum(20)
      ).to.be.revertedWith("Only admin");
    });
  });
});
```
