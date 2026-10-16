const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAOGovernor", function () {
  let governor;
  let token;
  let proposer;
  let voter1;
  let voter2;
  let target;
  const VOTING_PERIOD = 604800n; // 1 week in seconds
  const TIMELOCK_DELAY = 86400n; // 1 day in seconds

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
      VOTING_PERIOD,
      TIMELOCK_DELAY
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

      expect(receipt.logs[0].fragment.name).to.equal("ProposalCreated");
      expect(receipt.logs[0].args.id).to.equal(0n);
      expect(receipt.logs[0].args.proposer).to.equal(proposer.address);
      expect(receipt.logs[0].args.description).to.equal(description);

      const proposal = await governor.proposals(0n);
      expect(proposal.proposer).to.equal(proposer.address);
      expect(proposal.target).to.equal(await target.getAddress());
      expect(proposal.description).to.equal(description);
      expect(proposal.startTime).to.be.closeTo(await time.latest(), 10n);
      expect(proposal.endTime).to.equal(proposal.startTime + VOTING_PERIOD);
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
      proposalId = receipt.logs[0].args.id;
    });

    it("should allow voting on active proposal", async function () {
      const tx = await governor.connect(voter1).castVote(proposalId, true);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("VoteCast");
      expect(receipt.logs[0].args.voter).to.equal(voter1.address);
      expect(receipt.logs[0].args.proposalId).to.equal(proposalId);
      expect(receipt.logs[0].args.support).to.be.true;
      expect(receipt.logs[0].args.weight).to.equal(1000n);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.forVotes).to.equal(1000n);
      expect(proposal.againstVotes).to.equal(0n);
      expect(await governor.hasVoted(proposalId, voter1.address)).to.be.true;
    });

    it("should revert when voting on inactive proposal", async function () {
      // Fast forward time beyond voting period
      await time.increase(VOTING_PERIOD + 1n);

      await expect(
        governor.connect(voter1).castVote(proposalId, true)
      ).to.be.revertedWith("Not active");
    });

    it("should revert when voting twice", async function () {
      await governor.connect(voter1).castVote(proposalId, true);
      await expect(
        governor.connect(voter1).castVote(proposalId, false)
      ).to.be.revertedWith("Already voted");
    });

    it("should revert when voter has no voting power", async function () {
      const [, , , noVoter] = await ethers.getSigners();
      await expect(
        governor.connect(noVoter).castVote(proposalId, true)
      ).to.be.revertedWith("No voting power");
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
      proposalId = receipt.logs[0].args.id;

      // Vote to pass the proposal
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, true);

      // Fast forward time beyond voting period
      await time.increase(VOTING_PERIOD + 1n);
    });

    it("should queue a successful proposal", async function () {
      const tx = await governor.connect(proposer).queue(proposalId);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("ProposalQueued");
      expect(receipt.logs[0].args.id).to.equal(proposalId);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.queued).to.be.true;
      expect(proposal.eta).to.equal((await time.latest()) + TIMELOCK_DELAY);
    });

    it("should revert when queueing an unsuccessful proposal", async function () {
      // Create a new proposal that will be defeated
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Defeated proposal"
      );
      const receipt = await tx.wait();
      const defeatedProposalId = receipt.logs[0].args.id;

      // Vote to defeat the proposal
      await governor.connect(voter1).castVote(defeatedProposalId, true);
      await governor.connect(voter2).castVote(defeatedProposalId, false);

      // Fast forward time beyond voting period
      await time.increase(VOTING_PERIOD + 1n);

      await expect(
        governor.connect(proposer).queue(defeatedProposalId)
      ).to.be.revertedWith("Proposal defeated");
    });

    it("should revert when queueing an already queued proposal", async function () {
      await governor.connect(proposer).queue(proposalId);
      await expect(
        governor.connect(proposer).queue(proposalId)
      ).to.be.revertedWith("Already queued");
    });

    it("should revert when queueing an active proposal", async function () {
      // Create a new proposal that's still active
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Active proposal"
      );
      const receipt = await tx.wait();
      const activeProposalId = receipt.logs[0].args.id;

      await expect(
        governor.connect(proposer).queue(activeProposalId)
      ).to.be.revertedWith("Still active");
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
      proposalId = receipt.logs[0].args.id;

      // Vote to pass the proposal
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, true);

      // Fast forward time beyond voting period
      await time.increase(VOTING_PERIOD + 1n);

      // Queue the proposal
      await governor.connect(proposer).queue(proposalId);

      // Fast forward time beyond timelock delay
      await time.increase(TIMELOCK_DELAY + 1n);
    });

    it("should execute a queued proposal", async function () {
      const tx = await governor.connect(proposer).execute(proposalId);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("ProposalExecuted");
      expect(receipt.logs[0].args.id).to.equal(proposalId);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.executed).to.be.true;

      // Verify the target contract was called
      expect(await target.value()).to.equal(42n);
    });

    it("should revert when executing a non-queued proposal", async function () {
      // Create a new proposal that's not queued
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Non-queued proposal"
      );
      const receipt = await tx.wait();
      const nonQueuedProposalId = receipt.logs[0].args.id;

      await expect(
        governor.connect(proposer).execute(nonQueuedProposalId)
      ).to.be.revertedWith("Not queued or already executed");
    });

    it("should revert when executing an already executed proposal", async function () {
      await governor.connect(proposer).execute(proposalId);
      await expect(
        governor.connect(proposer).execute(proposalId)
      ).to.be.revertedWith("Not queued or already executed");
    });

    it("should revert when executing before timelock expires", async function () {
      // Create a new proposal with a longer timelock
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Timelocked proposal"
      );
      const receipt = await tx.wait();
      const timelockedProposalId = receipt.logs[0].args.id;

      // Vote to pass the proposal
      await governor.connect(voter1).castVote(timelockedProposalId, true);
      await governor.connect(voter2).castVote(timelockedProposalId, true);

      // Fast forward time beyond voting period
      await time.increase(VOTING_PERIOD + 1n);

      // Queue the proposal
      await governor.connect(proposer).queue(timelockedProposalId);

      // Don't fast forward time beyond timelock delay
      await expect(
        governor.connect(proposer).execute(timelockedProposalId)
      ).to.be.revertedWith("Timelock not expired");
    });

    it("should revert when execution fails", async function () {
      // Create a proposal that will fail
      const callData = target.interface.encodeFunctionData("fail");
      const tx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Failing proposal"
      );
      const receipt = await tx.wait();
      const failingProposalId = receipt.logs[0].args.id;

      // Vote to pass the proposal
      await governor.connect(voter1).castVote(failingProposalId, true);
      await governor.connect(voter2).castVote(failingProposalId, true);

      // Fast forward time beyond voting period
      await time.increase(VOTING_PERIOD + 1n);

      // Queue the proposal
      await governor.connect(proposer).queue(failingProposalId);

      // Fast forward time beyond timelock delay
      await time.increase(TIMELOCK_DELAY + 1n);

      await expect(
        governor.connect(proposer).execute(failingProposalId)
      ).to.be.revertedWith("Execution failed");
    });
  });
});

// Helper function to get current timestamp
async function getCurrentTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block.timestamp);
}

// Time manipulation helper
const time = {
  latest: getCurrentTimestamp,
  increase: async function (duration) {
    await ethers.provider.send("evm_increaseTime", [Number(duration)]);
    await ethers.provider.send("evm_mine");
  }
};