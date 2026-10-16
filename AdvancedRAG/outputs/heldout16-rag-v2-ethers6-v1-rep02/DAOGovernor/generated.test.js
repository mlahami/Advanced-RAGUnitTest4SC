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
    token = await Token.deploy("Governance Token", "GT");
    await token.waitForDeployment();

    // Mint tokens to voters
    await token.mint(voter1.address, 1000n);
    await token.mint(voter2.address, 500n);

    // Deploy target contract
    const Target = await ethers.getContractFactory("BenchmarkTarget");
    target = await Target.deploy();
    await target.waitForDeployment();

    // Deploy governor
    const Governor = await ethers.getContractFactory("DAOGovernor");
    governor = await Governor.deploy(await token.getAddress(), VOTING_PERIOD, TIMELOCK_DELAY);
    await governor.waitForDeployment();
  });

  describe("Proposal Creation", function () {
    it("Should create a proposal and emit ProposalCreated event", async function () {
      const description = "Test proposal";
      const callData = target.interface.encodeFunctionData("setValue", [42n]);

      await expect(governor.propose(await target.getAddress(), callData, description))
        .to.emit(governor, "ProposalCreated")
        .withArgs(0n, owner.address, description);

      const proposal = await governor.proposals(0n);
      expect(proposal.proposer).to.equal(owner.address);
      expect(proposal.target).to.equal(await target.getAddress());
      expect(proposal.description).to.equal(description);
      expect(proposal.startTime).to.be.closeTo(await time.latest(), 5n);
      expect(proposal.endTime).to.equal(proposal.startTime + VOTING_PERIOD);
    });
  });

  describe("Voting", function () {
    let proposalId;

    beforeEach(async function () {
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(await target.getAddress(), callData, "Test proposal");
      const receipt = await tx.wait();
      proposalId = 0n;
    });

    it("Should allow voting and emit VoteCast event", async function () {
      await expect(governor.connect(voter1).castVote(proposalId, true))
        .to.emit(governor, "VoteCast")
        .withArgs(voter1.address, proposalId, true, 1000n);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.forVotes).to.equal(1000n);
      expect(proposal.againstVotes).to.equal(0n);
      expect(await governor.hasVoted(proposalId, voter1.address)).to.be.true;
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
      const callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(await target.getAddress(), callData, "Future proposal");
      const receipt = await tx.wait();
      const newProposalId = 1n;

      // Move time before proposal starts
      await ethers.provider.send("evm_increaseTime", [-VOTING_PERIOD * 2n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.connect(voter1).castVote(newProposalId, true))
        .to.be.revertedWith("Not active");
    });

    it("Should prevent voting after proposal ends", async function () {
      // Move time past voting period
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.connect(voter1).castVote(proposalId, true))
        .to.be.revertedWith("Not active");
    });
  });

  describe("Proposal Execution", function () {
    let proposalId;
    let callData;

    beforeEach(async function () {
      callData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(await target.getAddress(), callData, "Test proposal");
      const receipt = await tx.wait();
      proposalId = 0n;

      // Cast votes
      await governor.connect(voter1).castVote(proposalId, true);
      await governor.connect(voter2).castVote(proposalId, false);

      // Move time past voting period
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1n]);
      await ethers.provider.send("evm_mine");
    });

    it("Should queue a proposal and emit ProposalQueued event", async function () {
      await expect(governor.queue(proposalId))
        .to.emit(governor, "ProposalQueued")
        .withArgs(proposalId, (await time.latest()) + TIMELOCK_DELAY);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.queued).to.be.true;
      expect(proposal.eta).to.equal((await time.latest()) + TIMELOCK_DELAY);
    });

    it("Should prevent queuing a defeated proposal", async function () {
      // Create a new proposal that will be defeated
      const newCallData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(await target.getAddress(), newCallData, "Defeated proposal");
      const receipt = await tx.wait();
      const newProposalId = 1n;

      // Cast votes (against wins)
      await governor.connect(voter1).castVote(newProposalId, false);
      await governor.connect(voter2).castVote(newProposalId, false);

      // Move time past voting period
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.queue(newProposalId))
        .to.be.revertedWith("Proposal defeated");
    });

    it("Should prevent queuing an already queued proposal", async function () {
      await governor.queue(proposalId);
      await expect(governor.queue(proposalId))
        .to.be.revertedWith("Already queued");
    });

    it("Should prevent queuing an active proposal", async function () {
      // Create a new proposal that is still active
      const newCallData = target.interface.encodeFunctionData("setValue", [42n]);
      const tx = await governor.propose(await target.getAddress(), newCallData, "Active proposal");
      const receipt = await tx.wait();
      const newProposalId = 1n;

      await expect(governor.queue(newProposalId))
        .to.be.revertedWith("Still active");
    });

    it("Should execute a queued proposal and emit ProposalExecuted event", async function () {
      await governor.queue(proposalId);

      // Move time past timelock delay
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY + 1n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.execute(proposalId))
        .to.emit(governor, "ProposalExecuted")
        .withArgs(proposalId);

      const proposal = await governor.proposals(proposalId);
      expect(proposal.executed).to.be.true;

      // Verify target contract state was updated
      expect(await target.value()).to.equal(42n);
    });

    it("Should prevent executing a non-queued proposal", async function () {
      await expect(governor.execute(proposalId))
        .to.be.revertedWith("Not queued or already executed");
    });

    it("Should prevent executing before timelock expires", async function () {
      await governor.queue(proposalId);

      await expect(governor.execute(proposalId))
        .to.be.revertedWith("Timelock not expired");
    });

    it("Should prevent executing an already executed proposal", async function () {
      await governor.queue(proposalId);

      // Move time past timelock delay
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY + 1n]);
      await ethers.provider.send("evm_mine");

      await governor.execute(proposalId);

      await expect(governor.execute(proposalId))
        .to.be.revertedWith("Not queued or already executed");
    });

    it("Should revert if proposal execution fails", async function () {
      // Create a proposal that will fail
      const failCallData = target.interface.encodeFunctionData("fail");
      const tx = await governor.propose(await target.getAddress(), failCallData, "Failing proposal");
      const receipt = await tx.wait();
      const failProposalId = 1n;

      // Cast votes
      await governor.connect(voter1).castVote(failProposalId, true);

      // Move time past voting period
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1n]);
      await ethers.provider.send("evm_mine");

      await governor.queue(failProposalId);

      // Move time past timelock delay
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY + 1n]);
      await ethers.provider.send("evm_mine");

      await expect(governor.execute(failProposalId))
        .to.be.revertedWith("Execution failed");
    });
  });
});