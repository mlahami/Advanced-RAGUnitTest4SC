const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAOGovernor", function () {
  let governor;
  let token;
  let owner, proposer, voter1, voter2, target;
  const VOTING_PERIOD = 86400n; // 1 day
  const TIMELOCK_DELAY = 3600n; // 1 hour

  beforeEach(async function () {
    [owner, proposer, voter1, voter2, target] = await ethers.getSigners();

    // Deploy voting token
    const Token = await ethers.getContractFactory("BenchmarkVotingToken");
    token = await Token.deploy("Governance Token", "GOV");
    await token.waitForDeployment();

    // Mint tokens to voters
    await token.mint(voter1.address, ethers.parseEther("1000"));
    await token.mint(voter2.address, ethers.parseEther("1000"));

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
    it("should create a proposal and emit ProposalCreated event", async function () {
      const description = "Test proposal";
      const callData = "0x";

      await expect(governor.connect(proposer).propose(target.address, callData, description))
        .to.emit(governor, "ProposalCreated")
        .withArgs(0n, proposer.address, description);
    });

    it("should store proposal details correctly", async function () {
      const description = "Test proposal";
      const callData = "0x";

      await governor.connect(proposer).propose(target.address, callData, description);
      const proposal = await governor.proposals(0n);

      expect(proposal.proposer).to.equal(proposer.address);
      expect(proposal.target).to.equal(target.address);
      expect(proposal.callData).to.equal(callData);
      expect(proposal.description).to.equal(description);
      expect(proposal.startTime).to.be.closeTo(await time.latest(), 2n);
      expect(proposal.endTime).to.equal(proposal.startTime + VOTING_PERIOD);
      expect(proposal.forVotes).to.equal(0n);
      expect(proposal.againstVotes).to.equal(0n);
      expect(proposal.executed).to.be.false;
      expect(proposal.queued).to.be.false;
      expect(proposal.eta).to.equal(0n);
    });
  });

  describe("Voting", function () {
    let proposalId;

    beforeEach(async function () {
      const description = "Test proposal";
      const callData = "0x";
      await governor.connect(proposer).propose(target.address, callData, description);
      proposalId = 0n;
    });

    it("should allow voting on active proposal", async function () {
      const weight = await token.balanceOf(voter1.address);

      await expect(governor.connect(voter1).castVote(proposalId, true))
        .to.emit(governor, "VoteCast")
        .withArgs(voter1.address, proposalId, true, weight);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.forVotes).to.equal(weight);
      expect(proposal.againstVotes).to.equal(0n);
    });

    it("should prevent voting on inactive proposal", async function () {
      // Fast forward past voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
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
      // Transfer all tokens away from voter2
      await token.connect(voter2).transfer(voter1.address, await token.balanceOf(voter2.address));

      await expect(governor.connect(voter2).castVote(proposalId, true))
        .to.be.revertedWith("No voting power");
    });
  });

  describe("Proposal Queueing", function () {
    let proposalId;

    beforeEach(async function () {
      const description = "Test proposal";
      const callData = "0x";
      await governor.connect(proposer).propose(target.address, callData, description);
      proposalId = 0n;

      // Vote to pass the proposal
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, true);

      // Fast forward past voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
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

    it("should prevent queueing an unsuccessful proposal", async function () {
      // Create a new proposal that will be defeated
      const description = "Defeated proposal";
      const callData = "0x";
      await governor.connect(proposer).propose(target.address, callData, description);
      const defeatedProposalId = 1n;

      // Vote to defeat the proposal
      await governor.connect(voter1).castVote(defeatedProposalId, false);
      await governor.connect(voter2).castVote(defeatedProposalId, false);

      // Fast forward past voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(governor.queue(defeatedProposalId))
        .to.be.revertedWith("Proposal defeated");
    });

    it("should prevent queueing an already queued proposal", async function () {
      await governor.queue(proposalId);

      await expect(governor.queue(proposalId))
        .to.be.revertedWith("Already queued");
    });

    it("should prevent queueing an active proposal", async function () {
      // Create a new proposal that's still active
      const description = "Active proposal";
      const callData = "0x";
      await governor.connect(proposer).propose(target.address, callData, description);
      const activeProposalId = 1n;

      await expect(governor.queue(activeProposalId))
        .to.be.revertedWith("Still active");
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
      const description = "Set value to 42";
      const callData = targetContract.interface.encodeFunctionData("setValue", [42n]);
      await governor.connect(proposer).propose(await targetContract.getAddress(), callData, description);
      proposalId = 0n;

      // Vote to pass the proposal
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, true);

      // Fast forward past voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Queue the proposal
      await governor.queue(proposalId);

      // Fast forward past timelock delay
      await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DELAY) + 1]);
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

    it("should prevent executing an unqueued proposal", async function () {
      // Create a new proposal that's not queued
      const description = "Unqueued proposal";
      const callData = "0x";
      await governor.connect(proposer).propose(target.address, callData, description);
      const unqueuedProposalId = 1n;

      await expect(governor.execute(unqueuedProposalId))
        .to.be.revertedWith("Not queued or already executed");
    });

    it("should prevent executing an already executed proposal", async function () {
      await governor.execute(proposalId);

      await expect(governor.execute(proposalId))
        .to.be.revertedWith("Not queued or already executed");
    });

    it("should prevent executing before timelock expires", async function () {
      // Create a new proposal with a longer timelock
      const description = "Timelocked proposal";
      const callData = "0x";
      const longTimelock = 7200n; // 2 hours
      const Governor = await ethers.getContractFactory("DAOGovernor");
      const longTimelockGovernor = await Governor.deploy(
        await token.getAddress(),
        VOTING_PERIOD,
        longTimelock
      );
      await longTimelockGovernor.waitForDeployment();

      await longTimelockGovernor.connect(proposer).propose(target.address, callData, description);
      const timelockedProposalId = 0n;

      // Vote to pass the proposal
      await longTimelockGovernor.connect(voter1).castVote(timelockedProposalId, true);
      await longTimelockGovernor.connect(voter2).castVote(timelockedProposalId, true);

      // Fast forward past voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Queue the proposal
      await longTimelockGovernor.queue(timelockedProposalId);

      // Try to execute before timelock expires
      await expect(longTimelockGovernor.execute(timelockedProposalId))
        .to.be.revertedWith("Timelock not expired");
    });

    it("should prevent executing a failed proposal call", async function () {
      // Create proposal to call fail() on target contract
      const description = "Fail proposal";
      const callData = targetContract.interface.encodeFunctionData("fail");
      await governor.connect(proposer).propose(await targetContract.getAddress(), callData, description);
      const failProposalId = 1n;

      // Vote to pass the proposal
      await governor.connect(voter1).castVote(failProposalId, true);
      await governor.connect(voter2).castVote(failProposalId, true);

      // Fast forward past voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Queue the proposal
      await governor.queue(failProposalId);

      // Fast forward past timelock delay
      await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DELAY) + 1]);
      await ethers.provider.send("evm_mine");

      // Execute should fail
      await expect(governor.execute(failProposalId))
        .to.be.revertedWith("Execution failed");
    });
  });
});