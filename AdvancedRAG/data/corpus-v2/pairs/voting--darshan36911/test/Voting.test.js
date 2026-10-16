const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyUint } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("Voting", function () {
  let voting, owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    const Voting = await ethers.getContractFactory("Voting");
    voting = await Voting.deploy();
    await voting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("sets the deployer as owner", async function () {
      expect(await voting.owner()).to.equal(owner.address);
    });

    it("starts with zero proposals", async function () {
      expect(await voting.proposalCount()).to.equal(0);
    });
  });

  describe("Creating proposals", function () {
    it("lets anyone create a proposal", async function () {
      await voting.connect(addr1).createProposal("Should we add feature X?", 3600);
      expect(await voting.proposalCount()).to.equal(1);

      const proposal = await voting.getProposal(1);
      expect(proposal.description).to.equal("Should we add feature X?");
      expect(proposal.creator).to.equal(addr1.address);
      expect(proposal.isActive).to.equal(true);
    });

    it("emits a ProposalCreated event", async function () {
      await expect(voting.createProposal("Test proposal", 3600))
        .to.emit(voting, "ProposalCreated")
        .withArgs(1, "Test proposal", anyUint, owner.address);
    });

    it("rejects an empty description", async function () {
      await expect(voting.createProposal("", 3600)).to.be.revertedWith("Description required");
    });

    it("rejects a zero duration", async function () {
      await expect(voting.createProposal("Test", 0)).to.be.revertedWith("Duration must be positive");
    });
  });

  describe("Voting", function () {
    beforeEach(async function () {
      await voting.createProposal("Test proposal", 3600);
    });

    it("counts a For vote", async function () {
      await voting.connect(addr1).vote(1, true);
      const proposal = await voting.getProposal(1);
      expect(proposal.voteCountFor).to.equal(1);
      expect(proposal.voteCountAgainst).to.equal(0);
    });

    it("counts an Against vote", async function () {
      await voting.connect(addr1).vote(1, false);
      const proposal = await voting.getProposal(1);
      expect(proposal.voteCountFor).to.equal(0);
      expect(proposal.voteCountAgainst).to.equal(1);
    });

    it("emits a Voted event", async function () {
      await expect(voting.connect(addr1).vote(1, true))
        .to.emit(voting, "Voted")
        .withArgs(1, addr1.address, true);
    });

    it("prevents the same address from voting twice", async function () {
      await voting.connect(addr1).vote(1, true);
      await expect(voting.connect(addr1).vote(1, true)).to.be.revertedWith("Already voted");
    });

    it("allows different addresses to vote independently", async function () {
      await voting.connect(addr1).vote(1, true);
      await voting.connect(addr2).vote(1, false);

      const proposal = await voting.getProposal(1);
      expect(proposal.voteCountFor).to.equal(1);
      expect(proposal.voteCountAgainst).to.equal(1);
    });

    it("rejects votes on a nonexistent proposal", async function () {
      await expect(voting.connect(addr1).vote(99, true)).to.be.revertedWith(
        "Proposal does not exist"
      );
    });

    it("rejects votes after the deadline has passed", async function () {
      await voting.createProposal("Short-lived proposal", 10);
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine");

      await expect(voting.connect(addr1).vote(2, true)).to.be.revertedWith("Voting closed");
    });

    it("reports isActive as false once the deadline passes", async function () {
      await voting.createProposal("Short-lived proposal", 10);
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine");

      const proposal = await voting.getProposal(2);
      expect(proposal.isActive).to.equal(false);
    });
  });

  describe("Reading proposals", function () {
    it("returns all proposal ids in order", async function () {
      await voting.createProposal("Proposal 1", 3600);
      await voting.createProposal("Proposal 2", 3600);
      await voting.createProposal("Proposal 3", 3600);

      const ids = await voting.getAllProposalIds();
      expect(ids.map((id) => Number(id))).to.deep.equal([1, 2, 3]);
    });

    it("reverts when reading a nonexistent proposal", async function () {
      await expect(voting.getProposal(1)).to.be.revertedWith("Proposal does not exist");
    });

    it("correctly reports whether an address has voted", async function () {
      await voting.createProposal("Test proposal", 3600);
      expect(await voting.checkHasVoted(1, addr1.address)).to.equal(false);

      await voting.connect(addr1).vote(1, true);
      expect(await voting.checkHasVoted(1, addr1.address)).to.equal(true);
    });
  });
});
