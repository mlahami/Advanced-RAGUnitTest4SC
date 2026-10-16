const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAOGovernor", function () {
  let governor;
  let token;
  let owner, voter1, voter2, voter3;
  const VOTING_PERIOD = 86400n; // 1 day
  const TIMELOCK_DELAY = 3600n; // 1 hour

  beforeEach(async function () {
    [owner, voter1, voter2, voter3] = await ethers.getSigners();

    // Deploy voting token
    const Token = await ethers.getContractFactory("BenchmarkVotingToken");
    token = await Token.deploy("Governance Token", "GOV");
    await token.waitForDeployment();

    // Mint tokens to voters
    await token.mint(voter1.address, 1000n);
    await token.mint(voter2.address, 500n);
    await token.mint(voter3.address, 200n);

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

    it("should allow voting for a proposal", async function () {
      await expect(governor.connect(voter1).castVote(proposalId, true))
        .to.emit(governor, "VoteCast")
        .withArgs(voter1.address, proposalId, true, 1000n);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.forVotes).to.equal(1000n);
      expect(proposal.againstVotes).to.equal(0n);
      expect(await governor.hasVoted(proposalId, voter1.address)).to.be.true;
    });

    it("should allow voting against a proposal", async function () {
      await expect(governor.connect(voter1).castVote(proposalId, false))
        .to.emit(governor, "VoteCast")
        .withArgs(voter1.address, proposalId, false, 1000n);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.forVotes).to.equal(0n);
      expect(proposal.againstVotes).to.equal(1000n);
      expect(await governor.hasVoted(proposalId, voter1.address)).to.be.true;
    });

    it("should revert if voting before proposal starts", async function () {
      // Fast forward time to after proposal ends
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Create a new proposal
      const target = voter1.address;
      const callData = "0x";
      const description = "New proposal";
      await governor.propose(target, callData, description);
      const newProposalId = 1n;

      // Try to vote before proposal starts
      await expect(governor.connect(voter1).castVote(newProposalId, true))
        .to.be.revertedWith("Not active");
    });

    it("should revert if voting after proposal ends", async function () {
      // Fast forward time to after proposal ends
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(governor.connect(voter1).castVote(proposalId, true))
        .to.be.revertedWith("Not active");
    });

    it("should revert if voter has no voting power", async function () {
      await expect(governor.connect(voter3).castVote(proposalId, true))
        .to.be.revertedWith("No voting power");
    });

    it("should revert if voter has already voted", async function () {
      await governor.connect(voter1).castVote(proposalId, true);
      await expect(governor.connect(voter1).castVote(proposalId, false))
        .to.be.revertedWith("Already voted");
    });
  });

  describe("Queueing", function () {
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
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");
    });

    it("should queue a successful proposal", async function () {
      await expect(governor.queue(proposalId))
        .to.emit(governor, "ProposalQueued")
        .withArgs(proposalId, (await ethers.provider.getBlock("latest")).timestamp + TIMELOCK_DELAY);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.queued).to.be.true;
      expect(proposal.eta).to.equal(proposal.endTime + TIMELOCK_DELAY);
    });

    it("should revert if queueing before voting ends", async function () {
      // Create a new proposal
      const target = voter1.address;
      const callData = "0x";
      const description = "New proposal";
      await governor.propose(target, callData, description);
      const newProposalId = 1n;

      // Vote to pass the new proposal
      await governor.connect(voter1).castVote(newProposalId, true);

      // Don't fast forward time

      await expect(governor.queue(newProposalId))
        .to.be.revertedWith("Still active");
    });

    it("should revert if proposal was defeated", async function () {
      // Create a new proposal
      const target = voter1.address;
      const callData = "0x";
      const description = "Defeated proposal";
      await governor.propose(target, callData, description);
      const newProposalId = 1n;

      // Vote to defeat the new proposal
      await governor.connect(voter1).castVote(newProposalId, false);
      await governor.connect(voter2).castVote(newProposalId, false);

      // Fast forward time to after voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(governor.queue(newProposalId))
        .to.be.revertedWith("Proposal defeated");
    });

    it("should revert if proposal already queued", async function () {
      await governor.queue(proposalId);
      await expect(governor.queue(proposalId))
        .to.be.revertedWith("Already queued");
    });
  });

  describe("Execution", function () {
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
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Queue the proposal
      await governor.queue(proposalId);
    });

    it("should execute a queued proposal after timelock delay", async function () {
      // Fast forward time to after timelock delay
      await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DELAY) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(governor.execute(proposalId))
        .to.emit(governor, "ProposalExecuted")
        .withArgs(proposalId);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.executed).to.be.true;

      // Verify the target contract was called
      expect(await targetContract.value()).to.equal(42n);
    });

    it("should revert if executing before timelock delay", async function () {
      await expect(governor.execute(proposalId))
        .to.be.revertedWith("Timelock not expired");
    });

    it("should revert if proposal not queued", async function () {
      // Create a new proposal
      const callData = targetContract.interface.encodeFunctionData("setValue", [100n]);
      const description = "New proposal";
      await governor.propose(await targetContract.getAddress(), callData, description);
      const newProposalId = 1n;

      // Vote to pass the new proposal
      await governor.connect(voter1).castVote(newProposalId, true);
      await governor.connect(voter2).castVote(newProposalId, true);

      // Fast forward time to after voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(governor.execute(newProposalId))
        .to.be.revertedWith("Not queued or already executed");
    });

    it("should revert if proposal already executed", async function () {
      // Fast forward time to after timelock delay
      await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DELAY) + 1]);
      await ethers.provider.send("evm_mine");

      // Execute the proposal
      await governor.execute(proposalId);

      // Try to execute again
      await expect(governor.execute(proposalId))
        .to.be.revertedWith("Not queued or already executed");
    });

    it("should revert if execution fails", async function () {
      // Create a proposal that will fail
      const callData = targetContract.interface.encodeFunctionData("fail");
      const description = "Failing proposal";
      await governor.propose(await targetContract.getAddress(), callData, description);
      const newProposalId = 1n;

      // Vote to pass the new proposal
      await governor.connect(voter1).castVote(newProposalId, true);
      await governor.connect(voter2).castVote(newProposalId, true);

      // Fast forward time to after voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Queue the proposal
      await governor.queue(newProposalId);

      // Fast forward time to after timelock delay
      await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DELAY) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(governor.execute(newProposalId))
        .to.be.revertedWith("Execution failed");
    });
  });
});