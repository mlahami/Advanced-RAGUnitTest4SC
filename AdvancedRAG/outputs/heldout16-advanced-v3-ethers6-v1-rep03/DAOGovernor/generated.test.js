const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAOGovernor", function () {
  let governor;
  let token;
  let owner, voter1, voter2, nonVoter;
  const VOTING_PERIOD = 86400n; // 1 day in seconds
  const TIMELOCK_DELAY = 3600n; // 1 hour in seconds

  beforeEach(async function () {
    [owner, voter1, voter2, nonVoter] = await ethers.getSigners();

    // Deploy voting token
    const VotingToken = await ethers.getContractFactory("BenchmarkVotingToken");
    token = await VotingToken.deploy("Governance Token", "GOV");
    await token.waitForDeployment();

    // Mint tokens to voters
    await token.mint(voter1.address, 1000n);
    await token.mint(voter2.address, 500n);

    // Deploy governor
    const DAOGovernor = await ethers.getContractFactory("DAOGovernor");
    governor = await DAOGovernor.deploy(
      await token.getAddress(),
      VOTING_PERIOD,
      TIMELOCK_DELAY
    );
    await governor.waitForDeployment();
  });

  describe("Proposal Creation", function () {
    it("should create a proposal and emit ProposalCreated event", async function () {
      const target = voter1.address;
      const callData = "0x";
      const description = "Test proposal";

      await expect(governor.propose(target, callData, description))
        .to.emit(governor, "ProposalCreated")
        .withArgs(0n, owner.address, description);

      const proposal = await governor.proposals(0n);
      expect(proposal.proposer).to.equal(owner.address);
      expect(proposal.target).to.equal(target);
      expect(proposal.description).to.equal(description);
      expect(proposal.startTime).to.be.closeTo(await time.latest(), 5n);
      expect(proposal.endTime).to.equal(proposal.startTime + VOTING_PERIOD);
    });
  });

  describe("Voting", function () {
    let proposalId;

    beforeEach(async function () {
      const target = voter1.address;
      const callData = "0x";
      const description = "Test proposal";

      await governor.propose(target, callData, description);
      proposalId = 0n;
    });

    it("should allow voting on active proposal", async function () {
      await expect(governor.connect(voter1).castVote(proposalId, true))
        .to.emit(governor, "VoteCast")
        .withArgs(voter1.address, proposalId, true, 1000n);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.forVotes).to.equal(1000n);
      expect(proposal.againstVotes).to.equal(0n);
      expect(await governor.hasVoted(proposalId, voter1.address)).to.be.true;
    });

    it("should prevent voting before proposal is active", async function () {
      // Fast forward time to before proposal start
      await ethers.provider.send("evm_increaseTime", [-VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.connect(voter1).castVote(proposalId, true))
        .to.be.revertedWith("Not active");
    });

    it("should prevent voting after proposal has ended", async function () {
      // Fast forward time to after proposal end
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.connect(voter1).castVote(proposalId, true))
        .to.be.revertedWith("Not active");
    });

    it("should prevent double voting", async function () {
      await governor.connect(voter1).castVote(proposalId, true);
      await expect(governor.connect(voter1).castVote(proposalId, false))
        .to.be.revertedWith("Already voted");
    });

    it("should prevent voting with zero voting power", async function () {
      await expect(governor.connect(nonVoter).castVote(proposalId, true))
        .to.be.revertedWith("No voting power");
    });
  });

  describe("Proposal Queueing", function () {
    let proposalId;

    beforeEach(async function () {
      const target = voter1.address;
      const callData = "0x";
      const description = "Test proposal";

      await governor.propose(target, callData, description);
      proposalId = 0n;

      // Vote to pass the proposal
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, true);

      // Fast forward time to after voting period
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");
    });

    it("should queue a successful proposal", async function () {
      const currentTime = await time.latest();
      await expect(governor.queue(proposalId))
        .to.emit(governor, "ProposalQueued")
        .withArgs(proposalId, currentTime + TIMELOCK_DELAY);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.queued).to.be.true;
      expect(proposal.eta).to.equal(currentTime + TIMELOCK_DELAY);
    });

    it("should prevent queuing before voting period ends", async function () {
      // Reset time to before voting period ends
      await ethers.provider.send("evm_increaseTime", [-VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.queue(proposalId))
        .to.be.revertedWith("Still active");
    });

    it("should prevent queuing a defeated proposal", async function () {
      // Create a new proposal that will be defeated
      const target = voter1.address;
      const callData = "0x";
      const description = "Defeated proposal";

      await governor.propose(target, callData, description);
      const defeatedProposalId = 1n;

      // Vote to defeat the proposal
      await governor.connect(voter1).castVote(defeatedProposalId, false);
      await governor.connect(voter2).castVote(defeatedProposalId, false);

      // Fast forward time to after voting period
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.queue(defeatedProposalId))
        .to.be.revertedWith("Proposal defeated");
    });

    it("should prevent double queuing", async function () {
      await governor.queue(proposalId);
      await expect(governor.queue(proposalId))
        .to.be.revertedWith("Already queued");
    });
  });

  describe("Proposal Execution", function () {
    let proposalId;
    let targetContract;

    beforeEach(async function () {
      // Deploy target contract
      const Target = await ethers.getContractFactory("BenchmarkTarget");
      targetContract = await Target.deploy();
      await targetContract.waitForDeployment();

      // Create proposal to call setValue on target contract
      const callData = targetContract.interface.encodeFunctionData("setValue", [42n]);
      const description = "Set value to 42";

      await governor.propose(await targetContract.getAddress(), callData, description);
      proposalId = 0n;

      // Vote to pass the proposal
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, true);

      // Fast forward time to after voting period
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      // Queue the proposal
      await governor.queue(proposalId);

      // Fast forward time to after timelock delay
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY * 2n]);
      await ethers.provider.send("evm_mine");
    });

    it("should execute a queued proposal", async function () {
      await expect(governor.execute(proposalId))
        .to.emit(governor, "ProposalExecuted")
        .withArgs(proposalId);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.executed).to.be.true;

      // Verify the target contract was called
      expect(await targetContract.value()).to.equal(42n);
    });

    it("should prevent execution before timelock expires", async function () {
      // Reset time to before timelock expires
      await ethers.provider.send("evm_increaseTime", [-TIMELOCK_DELAY * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.execute(proposalId))
        .to.be.revertedWith("Timelock not expired");
    });

    it("should prevent execution of non-queued proposal", async function () {
      // Create a new proposal that isn't queued
      const target = voter1.address;
      const callData = "0x";
      const description = "Unqueued proposal";

      await governor.propose(target, callData, description);
      const unqueuedProposalId = 1n;

      await expect(governor.execute(unqueuedProposalId))
        .to.be.revertedWith("Not queued or already executed");
    });

    it("should prevent double execution", async function () {
      await governor.execute(proposalId);
      await expect(governor.execute(proposalId))
        .to.be.revertedWith("Not queued or already executed");
    });

    it("should revert if target call fails", async function () {
      // Create proposal to call fail() on target contract
      const callData = targetContract.interface.encodeFunctionData("fail");
      const description = "Call fail function";

      await governor.propose(await targetContract.getAddress(), callData, description);
      const failProposalId = 1n;

      // Vote to pass the proposal
      await governor.connect(voter1).castVote(failProposalId, true);
      await governor.connect(voter2).castVote(failProposalId, true);

      // Fast forward time to after voting period
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      // Queue the proposal
      await governor.queue(failProposalId);

      // Fast forward time to after timelock delay
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.execute(failProposalId))
        .to.be.revertedWith("Execution failed");
    });
  });
});