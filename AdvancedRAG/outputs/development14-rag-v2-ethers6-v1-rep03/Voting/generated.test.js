const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Voting", function () {
  let voting;
  let chairperson;
  let voter1;
  let voter2;
  let voter3;

  beforeEach(async function () {
    [chairperson, voter1, voter2, voter3] = await ethers.getSigners();

    const Voting = await ethers.getContractFactory("Voting");
    voting = await Voting.deploy(["Candidate1", "Candidate2"]);
    await voting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct chairperson", async function () {
      expect(await voting.chairperson()).to.equal(chairperson.address);
    });

    it("Should initialize candidates correctly", async function () {
      expect(await voting.candidates(0)).to.equal("Candidate1");
      expect(await voting.candidates(1)).to.equal("Candidate2");
      expect(await voting.candidates(2)).to.equal("");
    });

    it("Should revert if less than 2 candidates", async function () {
      const Voting = await ethers.getContractFactory("Voting");
      await expect(Voting.deploy(["SingleCandidate"])).to.be.revertedWith("need candidates");
    });
  });

  describe("Voting", function () {
    it("Should allow a voter to vote", async function () {
      await expect(voting.connect(voter1).vote(0))
        .to.emit(voting, "VoteCast")
        .withArgs(voter1.address, 0);

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

    it("Should track multiple votes correctly", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(1);
      await voting.connect(voter3).vote(0);

      expect(await voting.votes(0)).to.equal(2n);
      expect(await voting.votes(1)).to.equal(1n);
    });
  });

  describe("Winner", function () {
    it("Should return the correct winner", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(1);
      await voting.connect(voter3).vote(0);

      expect(await voting.winner()).to.equal(0n);
    });

    it("Should handle a tie correctly", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(1);

      // Either 0 or 1 could be returned in case of a tie
      const winner = await voting.winner();
      expect(winner).to.be.oneOf([0n, 1n]);
    });

    it("Should return 0 for no votes", async function () {
      expect(await voting.winner()).to.equal(0n);
    });
  });

  describe("State", function () {
    it("Should maintain correct state after voting", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(1);

      expect(await voting.hasVoted(voter1.address)).to.be.true;
      expect(await voting.hasVoted(voter2.address)).to.be.true;
      expect(await voting.hasVoted(voter3.address)).to.be.false;

      expect(await voting.votes(0)).to.equal(1n);
      expect(await voting.votes(1)).to.equal(1n);
    });
  });
});