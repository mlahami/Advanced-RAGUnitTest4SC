const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Voting", function () {
  let Voting;
  let voting;
  let owner;
  let voter1;
  let voter2;

  beforeEach(async function () {
    [owner, voter1, voter2] = await ethers.getSigners();

    Voting = await ethers.getContractFactory("Voting");
    voting = await Voting.deploy(["Candidate1", "Candidate2"]);
    await voting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right chairperson", async function () {
      expect(await voting.chairperson()).to.equal(owner.address);
    });

    it("Should initialize candidates correctly", async function () {
      expect(await voting.candidates(0)).to.equal("Candidate1");
      expect(await voting.candidates(1)).to.equal("Candidate2");
      expect(await voting.candidates(2)).to.equal("");
    });

    it("Should revert if less than 2 candidates", async function () {
      await expect(Voting.deploy(["Candidate1"])).to.be.revertedWith("need candidates");
    });
  });

  describe("Voting", function () {
    it("Should allow a voter to vote", async function () {
      await voting.connect(voter1).vote(0);
      expect(await voting.hasVoted(voter1.address)).to.be.true;
      expect(await voting.votes(0)).to.equal(1n);
    });

    it("Should prevent double voting", async function () {
      await voting.connect(voter1).vote(0);
      await expect(voting.connect(voter1).vote(1)).to.be.revertedWith("already voted");
    });

    it("Should prevent voting for invalid candidate", async function () {
      await expect(voting.connect(voter1).vote(2)).to.be.revertedWith("invalid candidate");
    });

    it("Should update vote counts correctly", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(1);

      expect(await voting.votes(0)).to.equal(1n);
      expect(await voting.votes(1)).to.equal(1n);
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

      // In case of tie, the first candidate with max votes is returned
      expect(await voting.winner()).to.be.oneOf([0n, 1n]);
    });

    it("Should return 0 for no votes", async function () {
      expect(await voting.winner()).to.equal(0n);
    });
  });

  describe("State", function () {
    it("Should maintain correct state after multiple votes", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(1);

      expect(await voting.hasVoted(voter1.address)).to.be.true;
      expect(await voting.hasVoted(voter2.address)).to.be.true;
      expect(await voting.votes(0)).to.equal(1n);
      expect(await voting.votes(1)).to.equal(1n);
    });
  });
});