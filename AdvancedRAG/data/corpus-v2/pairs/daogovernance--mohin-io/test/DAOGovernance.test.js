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
