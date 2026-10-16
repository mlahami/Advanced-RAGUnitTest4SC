const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VotingCore", function () {
  let votingCore;
  let admin, registrar, voter1, voter2, outsider;

  beforeEach(async function () {
    [admin, registrar, voter1, voter2, outsider] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("VotingCore");
    votingCore = await Factory.deploy();
    await votingCore.waitForDeployment();

    // Grant registrar role
    const REGISTRAR_ROLE = await votingCore.REGISTRAR_ROLE();
    await votingCore.grantRole(REGISTRAR_ROLE, registrar.address);
  });

  describe("Voter Registration", function () {
    it("should allow registrar to register voters", async function () {
      await votingCore.connect(registrar).registerVoter(voter1.address);
      expect(await votingCore.isVoterRegistered(voter1.address)).to.be.true;
      expect(await votingCore.totalRegisteredVoters()).to.equal(1);
    });

    it("should prevent duplicate registration", async function () {
      await votingCore.connect(registrar).registerVoter(voter1.address);
      await expect(
        votingCore.connect(registrar).registerVoter(voter1.address)
      ).to.be.revertedWith("VotingCore: already registered");
    });

    it("should reject unauthorized registration attempts", async function () {
      await expect(
        votingCore.connect(outsider).registerVoter(voter1.address)
      ).to.be.reverted;
    });
  });

  describe("Proposal Lifecycle", function () {
    it("should create, activate, and close proposals", async function () {
      await votingCore.createProposal("Budget 2025", "Approve annual budget");
      expect(await votingCore.proposalCount()).to.equal(1);

      await votingCore.activateProposal(1);
      const proposal = await votingCore.proposals(1);
      expect(proposal.state).to.equal(1); // Active

      await votingCore.closeProposal(1);
      const closed = await votingCore.proposals(1);
      expect(closed.state).to.equal(2); // Closed
    });
  });

  describe("Vote Casting", function () {
    beforeEach(async function () {
      await votingCore.connect(registrar).registerVoter(voter1.address);
      await votingCore.connect(registrar).registerVoter(voter2.address);
      await votingCore.createProposal("Test Proposal", "A test");
      await votingCore.activateProposal(1);
    });

    it("should accept valid votes", async function () {
      await votingCore.connect(voter1).castVote(1, 0); // Yes
      await votingCore.connect(voter2).castVote(1, 1); // No
      const p = await votingCore.proposals(1);
      expect(p.yesVotes).to.equal(1);
      expect(p.noVotes).to.equal(1);
    });

    it("should prevent double voting", async function () {
      await votingCore.connect(voter1).castVote(1, 0);
      await expect(
        votingCore.connect(voter1).castVote(1, 1)
      ).to.be.revertedWith("VotingCore: already voted");
    });

    it("should reject unregistered voters", async function () {
      await expect(
        votingCore.connect(outsider).castVote(1, 0)
      ).to.be.revertedWith("VotingCore: not registered");
    });
  });

  describe("Emergency Controls", function () {
    it("should pause and unpause voting", async function () {
      await votingCore.connect(registrar).registerVoter(voter1.address);
      await votingCore.createProposal("Test", "test");
      await votingCore.activateProposal(1);

      await votingCore.pause();
      await expect(
        votingCore.connect(voter1).castVote(1, 0)
      ).to.be.reverted;

      await votingCore.unpause();
      await votingCore.connect(voter1).castVote(1, 0);
      const p = await votingCore.proposals(1);
      expect(p.yesVotes).to.equal(1);
    });
  });
});
