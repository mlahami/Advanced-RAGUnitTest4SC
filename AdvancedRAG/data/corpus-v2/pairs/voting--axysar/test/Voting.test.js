const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Voting Contract", function () {
  let voting;
  let admin;
  let voter1;
  let voter2;

  beforeEach(async function () {
    [admin, voter1, voter2] = await ethers.getSigners();
    const VotingFactory = await ethers.getContractFactory("Voting");
    voting = await VotingFactory.deploy();
    await voting.waitForDeployment();
  });

  describe("Candidate Registration", function () {
    it("should allow admin to add candidates", async function () {
      await voting.addCandidate("Alice");
      expect(await voting.candidateCount()).to.equal(1);
      const candidate = await voting.candidates(1);
      expect(candidate.name).to.equal("Alice");
    });

    it("should reject non-admin candidate registration", async function () {
      await expect(
        voting.connect(voter1).addCandidate("Bob")
      ).to.be.revertedWith("Voting: caller is not admin");
    });

    it("should track multiple candidates correctly", async function () {
      await voting.addCandidate("Alice");
      await voting.addCandidate("Bob");
      await voting.addCandidate("Charlie");
      expect(await voting.candidateCount()).to.equal(3);
    });
  });

  describe("Voting", function () {
    beforeEach(async function () {
      await voting.addCandidate("Alice");
      await voting.addCandidate("Bob");
    });

    it("should allow a voter to cast a vote", async function () {
      await voting.connect(voter1).vote(1);
      expect(await voting.getVotes(1)).to.equal(1);
      expect(await voting.hasVoted(voter1.address)).to.be.true;
    });

    it("should prevent double voting", async function () {
      await voting.connect(voter1).vote(1);
      await expect(
        voting.connect(voter1).vote(2)
      ).to.be.revertedWith("Voting: already voted");
    });

    it("should reject votes for invalid candidates", async function () {
      await expect(voting.connect(voter1).vote(0)).to.be.revertedWith(
        "Voting: invalid candidate"
      );
      await expect(voting.connect(voter1).vote(99)).to.be.revertedWith(
        "Voting: invalid candidate"
      );
    });

    it("should correctly tally votes from multiple voters", async function () {
      await voting.connect(voter1).vote(1);
      await voting.connect(voter2).vote(1);
      expect(await voting.getVotes(1)).to.equal(2);
      expect(await voting.getVotes(2)).to.equal(0);
    });
  });
});
