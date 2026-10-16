const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAOGovernor", function () {
  let governor;
  let token;
  let proposer;
  let voter1;
  let voter2;
  let target;
  const votingPeriod = 604800n; // 1 week in seconds
  const timelockDelay = 86400n; // 1 day in seconds

  beforeEach(async function () {
    [proposer, voter1, voter2] = await ethers.getSigners();

    // Deploy token
    const Token = await ethers.getContractFactory("BenchmarkVotingToken");
    token = await Token.deploy("Governance Token", "GOV");
    await token.waitForDeployment();

    // Mint tokens to voters
    await token.mint(voter1.address, 1000n);
    await token.mint(voter2.address, 1000n);

    // Deploy target contract
    const Target = await ethers.getContractFactory("BenchmarkTarget");
    target = await Target.deploy();
    await target.waitForDeployment();

    // Deploy governor
    const Governor = await ethers.getContractFactory("DAOGovernor");
    governor = await Governor.deploy(
      await token.getAddress(),
      votingPeriod,
      timelockDelay
    );
    await governor.waitForDeployment();
  });

  describe("Proposal Creation", function () {
    it("should create a proposal", async function () {
      const description = "Test proposal";
      const callData = target.interface.encodeFunctionData("setValue", [42n]);

      const tx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        description
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "ProposalCreated");

      expect(event.args.id).to.equal(0n);
      expect(event.args.proposer).to.equal(proposer.address);
      expect(event.args.description).to.equal(description);

      const proposal = await governor.proposals(0n);
      expect(proposal.proposer).to.equal(proposer.address);
      expect(proposal.target).to.equal(await target.getAddress());
      expect(proposal.description).to.equal(description);
      expect(proposal.startTime).to.be.closeTo(await time.latest(), 10n);
      expect(proposal.endTime).to.equal(proposal.startTime + votingPeriod);
    });
  });

  describe("Voting", function () {
    let proposalId;

    beforeEach(async function () {
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Test proposal"
      );
      const receipt = await tx.wait();
      proposalId = receipt.logs.find(log => log.fragment.name === "ProposalCreated").args.id;
    });

    it("should allow voting", async function () {
      // Advance time to start voting period
      await time.increaseTo((await governor.proposals(proposalId)).startTime + 1n);

      const tx = await governor.connect(voter1).castVote(proposalId, true);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "VoteCast");

      expect(event.args.voter).to.equal(voter1.address);
      expect(event.args.proposalId).to.equal(proposalId);
      expect(event.args.support).to.be.true;
      expect(event.args.weight).to.equal(1000n);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.forVotes).to.equal(1000n);
      expect(proposal.againstVotes).to.equal(0n);
      expect(await governor.hasVoted(proposalId, voter1.address)).to.be.true;
    });

    it("should revert if voting before start time", async function () {
      await expect(
        governor.connect(voter1).castVote(proposalId, true)
      ).to.be.revertedWith("Not active");
    });

    it("should revert if voting after end time", async function () {
      await time.increaseTo((await governor.proposals(proposalId)).endTime + 1n);
      await expect(
        governor.connect(voter1).castVote(proposalId, true)
      ).to.be.revertedWith("Not active");
    });

    it("should revert if voting without tokens", async function () {
      await time.increaseTo((await governor.proposals(proposalId)).startTime + 1n);
      await expect(
        governor.connect(proposer).castVote(proposalId, true)
      ).to.be.revertedWith("No voting power");
    });

    it("should revert if voting twice", async function () {
      await time.increaseTo((await governor.proposals(proposalId)).startTime + 1n);
      await governor.connect(voter1).castVote(proposalId, true);
      await expect(
        governor.connect(voter1).castVote(proposalId, false)
      ).to.be.revertedWith("Already voted");
    });
  });

  describe("Proposal Queueing", function () {
    let proposalId;

    beforeEach(async function () {
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Test proposal"
      );
      const receipt = await tx.wait();
      proposalId = receipt.logs.find(log => log.fragment.name === "ProposalCreated").args.id;

      // Vote to pass the proposal
      await time.increaseTo((await governor.proposals(proposalId)).startTime + 1n);
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, true);
    });

    it("should queue a successful proposal", async function () {
      await time.increaseTo((await governor.proposals(proposalId)).endTime + 1n);

      const tx = await governor.connect(proposer).queue(proposalId);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "ProposalQueued");

      expect(event.args.id).to.equal(proposalId);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.queued).to.be.true;
      expect(proposal.eta).to.equal((await time.latest()) + timelockDelay);
    });

    it("should revert if queueing before voting ends", async function () {
      await expect(
        governor.connect(proposer).queue(proposalId)
      ).to.be.revertedWith("Still active");
    });

    it("should revert if proposal was defeated", async function () {
      await time.increaseTo((await governor.proposals(proposalId)).startTime + 1n);
      await governor.connect(voter1).castVote(proposalId, false);
      await time.increaseTo((await governor.proposals(proposalId)).endTime + 1n);

      await expect(
        governor.connect(proposer).queue(proposalId)
      ).to.be.revertedWith("Proposal defeated");
    });

    it("should revert if already queued", async function () {
      await time.increaseTo((await governor.proposals(proposalId)).endTime + 1n);
      await governor.connect(proposer).queue(proposalId);

      await expect(
        governor.connect(proposer).queue(proposalId)
      ).to.be.revertedWith("Already queued");
    });
  });

  describe("Proposal Execution", function () {
    let proposalId;

    beforeEach(async function () {
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Test proposal"
      );
      const receipt = await tx.wait();
      proposalId = receipt.logs.find(log => log.fragment.name === "ProposalCreated").args.id;

      // Vote and queue the proposal
      await time.increaseTo((await governor.proposals(proposalId)).startTime + 1n);
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, true);
      await time.increaseTo((await governor.proposals(proposalId)).endTime + 1n);
      await governor.connect(proposer).queue(proposalId);
    });

    it("should execute a queued proposal after timelock", async function () {
      const proposal = await governor.proposals(proposalId);
      await time.increaseTo(proposal.eta + 1n);

      const tx = await governor.connect(proposer).execute(proposalId);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "ProposalExecuted");

      expect(event.args.id).to.equal(proposalId);

      const updatedProposal = await governor.proposals(proposalId);
      expect(updatedProposal.executed).to.be.true;

      expect(await target.value()).to.equal(42n);
    });

    it("should revert if executing before timelock", async function () {
      await expect(
        governor.connect(proposer).execute(proposalId)
      ).to.be.revertedWith("Timelock not expired");
    });

    it("should revert if not queued", async function () {
      const callData = target.interface.encodeFunctionData("setValue", [43n]);
      const tx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Another proposal"
      );
      const receipt = await tx.wait();
      const newProposalId = receipt.logs.find(log => log.fragment.name === "ProposalCreated").args.id;

      await expect(
        governor.connect(proposer).execute(newProposalId)
      ).to.be.revertedWith("Not queued or already executed");
    });

    it("should revert if already executed", async function () {
      const proposal = await governor.proposals(proposalId);
      await time.increaseTo(proposal.eta + 1n);
      await governor.connect(proposer).execute(proposalId);

      await expect(
        governor.connect(proposer).execute(proposalId)
      ).to.be.revertedWith("Not queued or already executed");
    });

    it("should revert if execution fails", async function () {
      const callData = target.interface.encodeFunctionData("fail");
      const tx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Failing proposal"
      );
      const receipt = await tx.wait();
      const failingProposalId = receipt.logs.find(log => log.fragment.name === "ProposalCreated").args.id;

      // Vote and queue the failing proposal
      await time.increaseTo((await governor.proposals(failingProposalId)).startTime + 1n);
      await governor.connect(voter1).castVote(failingProposalId, true);
      await time.increaseTo((await governor.proposals(failingProposalId)).endTime + 1n);
      await governor.connect(proposer).queue(failingProposalId);

      const proposal = await governor.proposals(failingProposalId);
      await time.increaseTo(proposal.eta + 1n);

      await expect(
        governor.connect(proposer).execute(failingProposalId)
      ).to.be.revertedWith("Execution failed");
    });
  });
});