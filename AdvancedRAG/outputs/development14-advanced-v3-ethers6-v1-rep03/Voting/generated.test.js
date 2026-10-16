const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Voting", function () {
  let voting;
  let chairperson;
  let voter1;
  let voter2;
  let candidates;

  beforeEach(async function () {
    [chairperson, voter1, voter2] = await ethers.getSigners();
    candidates = ["Alice", "Bob"];
    const VotingFactory = await ethers.getContractFactory("Voting");
    voting = await VotingFactory.deploy(candidates);
    await voting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct chairperson", async function () {
      expect(await voting.chairperson()).to.equal(chairperson.address);
    });

    it("should initialize candidates correctly", async function () {
      expect(await voting.candidates(0)).to.equal("Alice");
      expect(await voting.candidates(1)).to.equal("Bob");
    });

    it("should revert if less than 2 candidates are provided", async function () {
      const VotingFactory = await ethers.getContractFactory("Voting");
      await expect(VotingFactory.deploy(["Single"])).to.be.revertedWith("need candidates");
    });
  });

  describe("Voting", function () {
    it("should allow a voter to cast a vote", async function () {
      await voting.connect(voter1).vote(0);
      expect(await voting.hasVoted(voter1.address)).to.be.true;
      expect(await voting.votes(0)).to.equal(1n);
    });

    it("should prevent double voting", async function () {
      await voting.connect(voter1).vote(0);
      await expect(voting.connect(voter1).vote(1)).to.be.revertedWith("already voted");
    });

    it("should reject votes for invalid candidates", async function () {
      await expect(voting.connect(voter1).vote(2)).to.be.revertedWith("invalid candidate");
    });

    it("should correctly tally votes from multiple voters", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(0);
      expect(await voting.votes(0)).to.equal(2n);
      expect(await voting.votes(1)).to.equal(0n);
    });
  });

  describe("Winner", function () {
    it("should return the correct winner", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(0);
      expect(await voting.winner()).to.equal(0n);
    });

    it("should handle a tie correctly", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(1);
      const winner = await voting.winner();
      expect(winner).to.be.oneOf([0n, 1n]);
    });

    it("should return 0 for no votes", async function () {
      expect(await voting.winner()).to.equal(0n);
    });
  });
});