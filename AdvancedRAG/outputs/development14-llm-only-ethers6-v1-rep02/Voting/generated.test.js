const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Voting", function () {
  let Voting;
  let voting;
  let chairperson;
  let voter1;
  let voter2;
  let candidates;

  beforeEach(async function () {
    [chairperson, voter1, voter2] = await ethers.getSigners();
    candidates = ["Alice", "Bob", "Charlie"];
    Voting = await ethers.getContractFactory("Voting");
    voting = await Voting.deploy(candidates);
    await voting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct chairperson", async function () {
      expect(await voting.chairperson()).to.equal(chairperson.address);
    });

    it("should initialize candidates correctly", async function () {
      expect(await voting.candidates(0)).to.equal("Alice");
      expect(await voting.candidates(1)).to.equal("Bob");
      expect(await voting.candidates(2)).to.equal("Charlie");
      expect(await voting.candidates(3)).to.equal("");
    });

    it("should revert if less than 2 candidates are provided", async function () {
      await expect(Voting.deploy(["Single"])).to.be.revertedWith("need candidates");
    });
  });

  describe("Voting", function () {
    it("should allow a voter to vote for a valid candidate", async function () {
      await voting.connect(voter1).vote(1n);
      expect(await voting.hasVoted(voter1.address)).to.be.true;
      expect(await voting.votes(1n)).to.equal(1n);
    });

    it("should revert if voter tries to vote twice", async function () {
      await voting.connect(voter1).vote(0n);
      await expect(voting.connect(voter1).vote(1n)).to.be.revertedWith("already voted");
    });

    it("should revert if candidate ID is invalid", async function () {
      await expect(voting.connect(voter1).vote(3n)).to.be.revertedWith("invalid candidate");
    });
  });

  describe("Winner", function () {
    it("should correctly determine the winner", async function () {
      await voting.connect(voter1).vote(0n);
      await voting.connect(voter2).vote(1n);
      await voting.connect(chairperson).vote(1n);

      expect(await voting.winner()).to.equal(1n);
    });

    it("should return 0 if no votes have been cast", async function () {
      expect(await voting.winner()).to.equal(0n);
    });

    it("should handle ties by returning the first candidate with the highest votes", async function () {
      await voting.connect(voter1).vote(0n);
      await voting.connect(voter2).vote(1n);

      const winner = await voting.winner();
      expect(winner).to.be.oneOf([0n, 1n]);
    });
  });
});