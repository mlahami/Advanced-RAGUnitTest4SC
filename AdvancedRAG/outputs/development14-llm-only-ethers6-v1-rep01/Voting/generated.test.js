const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Voting", function () {
  let Voting;
  let voting;
  let owner;
  let voter1;
  let voter2;
  let candidates;

  beforeEach(async function () {
    [owner, voter1, voter2] = await ethers.getSigners();
    candidates = ["Candidate1", "Candidate2", "Candidate3"];
    Voting = await ethers.getContractFactory("Voting");
    voting = await Voting.deploy(candidates);
    await voting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right chairperson", async function () {
      expect(await voting.chairperson()).to.equal(owner.address);
    });

    it("Should set the correct candidates", async function () {
      for (let i = 0; i < candidates.length; i++) {
        expect(await voting.candidates(i)).to.equal(candidates[i]);
      }
    });

    it("Should revert if less than 2 candidates", async function () {
      await expect(Voting.deploy(["SingleCandidate"])).to.be.revertedWith("need candidates");
    });
  });

  describe("Voting", function () {
    it("Should allow a voter to vote", async function () {
      await voting.connect(voter1).vote(0);
      expect(await voting.hasVoted(voter1.address)).to.be.true;
      expect(await voting.votes(0)).to.equal(1n);
    });

    it("Should not allow a voter to vote twice", async function () {
      await voting.connect(voter1).vote(0);
      await expect(voting.connect(voter1).vote(1)).to.be.revertedWith("already voted");
    });

    it("Should not allow voting for invalid candidate", async function () {
      await expect(voting.connect(voter1).vote(3)).to.be.revertedWith("invalid candidate");
    });

    it("Should track multiple votes correctly", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(1);
      expect(await voting.votes(0)).to.equal(1n);
      expect(await voting.votes(1)).to.equal(1n);
      expect(await voting.votes(2)).to.equal(0n);
    });
  });

  describe("Winner", function () {
    it("Should return the correct winner", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(0);
      expect(await voting.winner()).to.equal(0n);
    });

    it("Should handle a tie correctly", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(1);
      const winner = await voting.winner();
      expect(winner).to.be.oneOf([0n, 1n]);
    });

    it("Should return 0 for no votes", async function () {
      expect(await voting.winner()).to.equal(0n);
    });
  });
});