const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAOGovernor", function () {
  let governor;
  let token;
  let proposer;
  let voter1;
  let voter2;
  let target;
  const VOTING_PERIOD = 100n; // 100 seconds
  const TIMELOCK_DELAY = 50n; // 50 seconds

  beforeEach(async function () {
    [proposer, voter1, voter2] = await ethers.getSigners();

    // Deploy token
    const Token = await ethers.getContractFactory("BenchmarkVotingToken");
    token = await Token.deploy("Governance Token", "GOV");
    await token.waitForDeployment();

    // Mint tokens to voters
    await token.mint(voter1.address, 100n);
    await token.mint(voter2.address, 100n);

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

      expect(receipt.logs.length).to.equal(1);
      expect(receipt.logs[0].fragment.name).to.equal("ProposalCreated");

      const proposalId = 0n;
      const proposal = await governor.proposals(proposalId);
      expect(proposal.proposer).to.equal(proposer.address);
      expect(proposal.target).to.equal(await target.getAddress());
      expect(proposal.description).to.equal(description);
      expect(proposal.startTime).to.be.closeTo(await time.latest(), 2n);
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
      proposalId = 0n;
    });

    it("should allow voting on active proposal", async function () {
      const tx = await governor.connect(voter1).castVote(proposalId, true);
      const receipt = await tx.wait();

      expect(receipt.logs.length).to.equal(1);
      expect(receipt.logs[0].fragment.name).to.equal("VoteCast");

      const proposal = await governor.proposals(proposalId);
      expect(proposal.forVotes).to.equal(100n);
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
      const [noVoter] = await ethers.getSigners();
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
      proposalId = 0n;

      // Vote
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, true);

      // Fast forward time beyond voting period
      await time.increase(VOTING_PERIOD + 1n);
    });

    it("should queue a successful proposal", async function () {
      const tx = await governor.connect(proposer).queue(proposalId);
      const receipt = await tx.wait();

      expect(receipt.logs.length).to.equal(1);
      expect(receipt.logs[0].fragment.name).to.equal("ProposalQueued");

      const proposal = await governor.proposals(proposalId);
      expect(proposal.queued).to.be.true;
      expect(proposal.eta).to.equal((await time.latest()) + TIMELOCK_DELAY);
    });

    it("should revert when queueing an inactive proposal", async function () {
      // Create a new proposal that hasn't ended yet
      const callData = target.interface.encodeFunctionData("setValue", [43n]);
      const newTx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "New proposal"
      );
      const newReceipt = await newTx.wait();
      const newProposalId = 1n;

      await expect(
        governor.connect(proposer).queue(newProposalId)
      ).to.be.revertedWith("Still active");
    });

    it("should revert when queueing a defeated proposal", async function () {
      // Create a proposal with more against votes
      const callData = target.interface.encodeFunctionData("setValue", [43n]);
      const newTx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Defeated proposal"
      );
      const newReceipt = await newTx.wait();
      const newProposalId = 1n;

      // Vote
      await governor.connect(voter1).castVote(newProposalId, true);
      await governor.connect(voter2).castVote(newProposalId, false);

      // Fast forward time beyond voting period
      await time.increase(VOTING_PERIOD + 1n);

      await expect(
        governor.connect(proposer).queue(newProposalId)
      ).to.be.revertedWith("Proposal defeated");
    });

    it("should revert when queueing twice", async function () {
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
      proposalId = 0n;

      // Vote
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, true);

      // Fast forward time beyond voting period
      await time.increase(VOTING_PERIOD + 1n);

      // Queue
      await governor.connect(proposer).queue(proposalId);

      // Fast forward time beyond timelock delay
      await time.increase(TIMELOCK_DELAY + 1n);
    });

    it("should execute a queued proposal", async function () {
      const tx = await governor.connect(proposer).execute(proposalId);
      const receipt = await tx.wait();

      expect(receipt.logs.length).to.equal(1);
      expect(receipt.logs[0].fragment.name).to.equal("ProposalExecuted");

      const proposal = await governor.proposals(proposalId);
      expect(proposal.executed).to.be.true;

      // Verify target contract state was updated
      expect(await target.value()).to.equal(42n);
    });

    it("should revert when executing a non-queued proposal", async function () {
      // Create a new proposal
      const callData = target.interface.encodeFunctionData("setValue", [43n]);
      const newTx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "New proposal"
      );
      const newReceipt = await newTx.wait();
      const newProposalId = 1n;

      await expect(
        governor.connect(proposer).execute(newProposalId)
      ).to.be.revertedWith("Not queued or already executed");
    });

    it("should revert when executing before timelock expires", async function () {
      // Create a new proposal
      const callData = target.interface.encodeFunctionData("setValue", [43n]);
      const newTx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "New proposal"
      );
      const newReceipt = await newTx.wait();
      const newProposalId = 1n;

      // Vote
      await governor.connect(voter1).castVote(newProposalId, true);
      await governor.connect(voter2).castVote(newProposalId, true);

      // Fast forward time beyond voting period
      await time.increase(VOTING_PERIOD + 1n);

      // Queue
      await governor.connect(proposer).queue(newProposalId);

      // Don't fast forward time beyond timelock delay
      await expect(
        governor.connect(proposer).execute(newProposalId)
      ).to.be.revertedWith("Timelock not expired");
    });

    it("should revert when executing a failing call", async function () {
      // Create a proposal that will fail
      const callData = target.interface.encodeFunctionData("fail");
      const newTx = await governor.connect(proposer).propose(
        await target.getAddress(),
        callData,
        "Failing proposal"
      );
      const newReceipt = await newTx.wait();
      const newProposalId = 1n;

      // Vote
      await governor.connect(voter1).castVote(newProposalId, true);
      await governor.connect(voter2).castVote(newProposalId, true);

      // Fast forward time beyond voting period
      await time.increase(VOTING_PERIOD + 1n);

      // Queue
      await governor.connect(proposer).queue(newProposalId);

      // Fast forward time beyond timelock delay
      await time.increase(TIMELOCK_DELAY + 1n);

      await expect(
        governor.connect(proposer).execute(newProposalId)
      ).to.be.revertedWith("Execution failed");
    });
  });
});