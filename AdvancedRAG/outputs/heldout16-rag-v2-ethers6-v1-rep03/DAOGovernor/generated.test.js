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
  const TIMELOCK_DELAY = 86400n; // 1 day

  beforeEach(async function () {
    [owner, voter1, voter2] = await ethers.getSigners();

    // Deploy voting token
    const Token = await ethers.getContractFactory("BenchmarkVotingToken");
    token = await Token.deploy("Governance Token", "GT");
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
    it("Should create a proposal and emit ProposalCreated event", async function () {
      const description = "Test proposal";
      const callData = target.interface.encodeFunctionData("setValue", [42n]);

      await expect(governor.propose(
        await target.getAddress(),
        callData,
        description
      ))
        .to.emit(governor, "ProposalCreated")
        .withArgs(0n, owner.address, description);
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

    it("Should allow voting and emit VoteCast event", async function () {
      await expect(governor.connect(voter1).castVote(proposalId, true))
        .to.emit(governor, "VoteCast")
        .withArgs(voter1.address, proposalId, true, 1000n);
    });

    it("Should prevent double voting", async function () {
      await governor.connect(voter1).castVote(proposalId, true);
      await expect(governor.connect(voter1).castVote(proposalId, false))
        .to.be.revertedWith("Already voted");
    });

    it("Should prevent voting with zero balance", async function () {
      const [, , , noVotingPower] = await ethers.getSigners();
      await expect(governor.connect(noVotingPower).castVote(proposalId, true))
        .to.be.revertedWith("No voting power");
    });

    it("Should prevent voting before proposal is active", async function () {
      // Create a new proposal that hasn't started yet
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(
        await target.getAddress(),
        callData,
        "Future proposal"
      );
      const receipt = await tx.wait();
      const futureProposalId = 1n;

      // Fast forward time to before the proposal starts
      await ethers.provider.send("evm_increaseTime", [-VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.connect(voter1).castVote(futureProposalId, true))
        .to.be.revertedWith("Not active");
    });

    it("Should prevent voting after proposal ends", async function () {
      // Fast forward time to after the proposal ends
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.connect(voter1).castVote(proposalId, true))
        .to.be.revertedWith("Not active");
    });
  });

  describe("Proposal Queueing", function () {
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

      // Fast forward time to after voting period ends
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");
    });

    it("Should queue a successful proposal and emit ProposalQueued event", async function () {
      await expect(governor.queue(proposalId))
        .to.emit(governor, "ProposalQueued")
        .withArgs(proposalId, (await ethers.provider.getBlock("latest")).timestamp + TIMELOCK_DELAY);
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

      // Don't fast forward time

      await expect(governor.queue(newProposalId))
        .to.be.revertedWith("Still active");
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
      const defeatedProposalId = 1n;

      // Cast votes
      await governor.connect(voter1).castVote(defeatedProposalId, false);
      await governor.connect(voter2).castVote(defeatedProposalId, false);

      // Fast forward time to after voting period ends
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.queue(defeatedProposalId))
        .to.be.revertedWith("Proposal defeated");
    });

    it("Should prevent double queuing", async function () {
      await governor.queue(proposalId);
      await expect(governor.queue(proposalId))
        .to.be.revertedWith("Already queued");
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

      // Fast forward time to after voting period ends
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      // Queue the proposal
      await governor.queue(proposalId);
    });

    it("Should execute a queued proposal and emit ProposalExecuted event", async function () {
      // Fast forward time to after timelock delay
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.execute(proposalId))
        .to.emit(governor, "ProposalExecuted")
        .withArgs(proposalId);

      // Verify the target contract was called
      expect(await target.value()).to.equal(42n);
    });

    it("Should prevent execution before timelock expires", async function () {
      await expect(governor.execute(proposalId))
        .to.be.revertedWith("Timelock not expired");
    });

    it("Should prevent execution of unqueued proposal", async function () {
      // Create a new proposal
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(
        await target.getAddress(),
        callData,
        "New proposal"
      );
      const receipt = await tx.wait();
      const newProposalId = 1n;

      // Fast forward time to after timelock delay
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.execute(newProposalId))
        .to.be.revertedWith("Not queued or already executed");
    });

    it("Should prevent double execution", async function () {
      // Fast forward time to after timelock delay
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY * 2n]);
      await ethers.provider.send("evm_mine");

      await governor.execute(proposalId);
      await expect(governor.execute(proposalId))
        .to.be.revertedWith("Not queued or already executed");
    });

    it("Should revert if target call fails", async function () {
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

      // Fast forward time to after voting period ends
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      // Queue the proposal
      await governor.queue(failingProposalId);

      // Fast forward time to after timelock delay
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.execute(failingProposalId))
        .to.be.revertedWith("Execution failed");
    });
  });
});