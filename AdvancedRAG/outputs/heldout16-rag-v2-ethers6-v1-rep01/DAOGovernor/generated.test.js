const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAOGovernor", function () {
  let governor;
  let token;
  let owner;
  let voter1;
  let voter2;
  let target;
  const VOTING_PERIOD = 3600n; // 1 hour
  const TIMELOCK_DELAY = 1800n; // 30 minutes

  beforeEach(async function () {
    [owner, voter1, voter2] = await ethers.getSigners();

    // Deploy voting token
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
    it("Should create a proposal", async function () {
      const description = "Test proposal";
      const callData = target.interface.encodeFunctionData("setValue", [42n]);

      const tx = await governor.propose(
        await target.getAddress(),
        callData,
        description
      );
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("ProposalCreated");
      expect(receipt.logs[0].args[1]).to.equal(owner.address);
      expect(receipt.logs[0].args[2]).to.equal(description);

      const proposal = await governor.proposals(0);
      expect(proposal.proposer).to.equal(owner.address);
      expect(proposal.target).to.equal(await target.getAddress());
      expect(proposal.description).to.equal(description);
      expect(proposal.startTime).to.equal(receipt.blockNumber);
      expect(proposal.endTime).to.equal(receipt.blockNumber + VOTING_PERIOD);
    });
  });

  describe("Voting", function () {
    let proposalId;

    beforeEach(async function () {
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(
        await target.getAddress(),
        callData,
        "Test proposal"
      );
      const receipt = await tx.wait();
      proposalId = 0n;
    });

    it("Should allow voting for a proposal", async function () {
      const tx = await governor.connect(voter1).castVote(proposalId, true);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("VoteCast");
      expect(receipt.logs[0].args[0]).to.equal(voter1.address);
      expect(receipt.logs[0].args[1]).to.equal(proposalId);
      expect(receipt.logs[0].args[2]).to.equal(true);
      expect(receipt.logs[0].args[3]).to.equal(1000n);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.forVotes).to.equal(1000n);
      expect(proposal.againstVotes).to.equal(0n);
    });

    it("Should allow voting against a proposal", async function () {
      const tx = await governor.connect(voter1).castVote(proposalId, false);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("VoteCast");
      expect(receipt.logs[0].args[0]).to.equal(voter1.address);
      expect(receipt.logs[0].args[1]).to.equal(proposalId);
      expect(receipt.logs[0].args[2]).to.equal(false);
      expect(receipt.logs[0].args[3]).to.equal(1000n);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.forVotes).to.equal(0n);
      expect(proposal.againstVotes).to.equal(1000n);
    });

    it("Should prevent double voting", async function () {
      await governor.connect(voter1).castVote(proposalId, true);
      await expect(
        governor.connect(voter1).castVote(proposalId, false)
      ).to.be.revertedWith("Already voted");
    });

    it("Should prevent voting before proposal is active", async function () {
      // Create a new proposal with a future start time
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(
        await target.getAddress(),
        callData,
        "Future proposal"
      );
      const receipt = await tx.wait();
      const futureProposalId = 1n;

      // Try to vote before the proposal is active
      await expect(
        governor.connect(voter1).castVote(futureProposalId, true)
      ).to.be.revertedWith("Not active");
    });

    it("Should prevent voting after proposal has ended", async function () {
      // Fast forward time to after the voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(
        governor.connect(voter1).castVote(proposalId, true)
      ).to.be.revertedWith("Not active");
    });

    it("Should prevent voting with zero voting power", async function () {
      // Create a new proposal
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(
        await target.getAddress(),
        callData,
        "Test proposal"
      );
      const receipt = await tx.wait();
      const newProposalId = 1n;

      // Try to vote with an account that has no voting power
      await expect(
        governor.connect(owner).castVote(newProposalId, true)
      ).to.be.revertedWith("No voting power");
    });
  });

  describe("Proposal Execution", function () {
    let proposalId;

    beforeEach(async function () {
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(
        await target.getAddress(),
        callData,
        "Test proposal"
      );
      const receipt = await tx.wait();
      proposalId = 0n;

      // Cast votes
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, true);

      // Fast forward time to after the voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");
    });

    it("Should queue a successful proposal", async function () {
      const tx = await governor.queue(proposalId);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("ProposalQueued");
      expect(receipt.logs[0].args[0]).to.equal(proposalId);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.queued).to.be.true;
      expect(proposal.eta).to.be.gt(0n);
    });

    it("Should prevent queuing before voting period ends", async function () {
      // Create a new proposal
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(
        await target.getAddress(),
        callData,
        "New proposal"
      );
      const receipt = await tx.wait();
      const newProposalId = 1n;

      // Cast votes
      await governor.connect(voter1).castVote(newProposalId, true);

      // Try to queue before voting period ends
      await expect(
        governor.queue(newProposalId)
      ).to.be.revertedWith("Still active");
    });

    it("Should prevent queuing a defeated proposal", async function () {
      // Create a new proposal
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(
        await target.getAddress(),
        callData,
        "Defeated proposal"
      );
      const receipt = await tx.wait();
      const newProposalId = 1n;

      // Cast votes
      await governor.connect(voter1).castVote(newProposalId, false);
      await governor.connect(voter2).castVote(newProposalId, false);

      // Fast forward time to after the voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Try to queue a defeated proposal
      await expect(
        governor.queue(newProposalId)
      ).to.be.revertedWith("Proposal defeated");
    });

    it("Should execute a queued proposal after timelock delay", async function () {
      // Queue the proposal
      await governor.queue(proposalId);

      // Fast forward time to after the timelock delay
      await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DELAY) + 1]);
      await ethers.provider.send("evm_mine");

      // Execute the proposal
      const tx = await governor.execute(proposalId);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("ProposalExecuted");
      expect(receipt.logs[0].args[0]).to.equal(proposalId);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.executed).to.be.true;

      // Verify the target contract was updated
      expect(await target.value()).to.equal(42n);
    });

    it("Should prevent executing before timelock delay expires", async function () {
      // Queue the proposal
      await governor.queue(proposalId);

      // Try to execute before timelock delay expires
      await expect(
        governor.execute(proposalId)
      ).to.be.revertedWith("Timelock not expired");
    });

    it("Should prevent executing a non-queued proposal", async function () {
      // Create a new proposal
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(
        await target.getAddress(),
        callData,
        "New proposal"
      );
      const receipt = await tx.wait();
      const newProposalId = 1n;

      // Cast votes
      await governor.connect(voter1).castVote(newProposalId, true);
      await governor.connect(voter2).castVote(newProposalId, true);

      // Fast forward time to after the voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Try to execute without queuing
      await expect(
        governor.execute(newProposalId)
      ).to.be.revertedWith("Not queued or already executed");
    });

    it("Should prevent executing a proposal twice", async function () {
      // Queue and execute the proposal
      await governor.queue(proposalId);
      await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DELAY) + 1]);
      await ethers.provider.send("evm_mine");
      await governor.execute(proposalId);

      // Try to execute again
      await expect(
        governor.execute(proposalId)
      ).to.be.revertedWith("Not queued or already executed");
    });

    it("Should revert if proposal execution fails", async function () {
      // Create a proposal that will fail
      const callData = target.interface.encodeFunctionData("fail");
      const tx = await governor.propose(
        await target.getAddress(),
        callData,
        "Failing proposal"
      );
      const receipt = await tx.wait();
      const failingProposalId = 1n;

      // Cast votes
      await governor.connect(voter1).castVote(failingProposalId, true);
      await governor.connect(voter2).castVote(failingProposalId, true);

      // Fast forward time to after the voting period
      await ethers.provider.send("evm_increaseTime", [Number(VOTING_PERIOD) + 1]);
      await ethers.provider.send("evm_mine");

      // Queue the proposal
      await governor.queue(failingProposalId);

      // Fast forward time to after the timelock delay
      await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DELAY) + 1]);
      await ethers.provider.send("evm_mine");

      // Try to execute the failing proposal
      await expect(
        governor.execute(failingProposalId)
      ).to.be.revertedWith("Execution failed");
    });
  });
});