const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { ethers } = require("hardhat");

const OPTIONS = [
  { name: "Party A", acronym: "PA", logourl: "", power: 0 },
  { name: "Party B", acronym: "PB", logourl: "", power: 1 },
];

const zeroResults = () => OPTIONS.map((o) => ({ option: o, count: 0 }));

describe("Election", () => {
  async function deployFixture() {
    const [manager, alice, bob, chris] = await ethers.getSigners();
    const deployer = await ethers.deployContract("Deployer");
    const endtime = (await time.latest()) + 3600;
    const electionAddress = await deployer.deployElection.staticCall(
      OPTIONS,
      endtime,
      "Test Election",
      "0",
      "0"
    );
    await deployer.deployElection(OPTIONS, endtime, "Test Election", "0", "0");
    const election = await ethers.getContractAt(
      "Election",
      electionAddress
    );
    return { deployer, election, endtime, manager, alice, bob, chris };
  }

  describe("Deployment", () => {
    it("deploys with the right parameters and emits ElectionCreated", async () => {
      const { deployer, election, endtime, manager } = await loadFixture(
        deployFixture
      );
      expect(await election.title()).to.equal("Test Election");
      expect(await election.creator()).to.equal(manager.address);
      expect(await election.endtime()).to.equal(endtime);
      const options = await election.getOptions();
      expect(options.length).to.equal(2);
      expect(options[0].name).to.equal("Party A");
      expect(options[1].name).to.equal("Party B");
      await expect(
        deployer.deployElection(OPTIONS, endtime, "Second", "0", "0")
      ).to.emit(deployer, "ElectionCreated");
    });

    it("rejects more than MAX_OPTIONS options", async () => {
      const { deployer, endtime } = await loadFixture(deployFixture);
      const tooMany = Array.from({ length: 11 }, (_, i) => ({
        name: `P${i}`,
        acronym: `P${i}`,
        logourl: "",
        power: i,
      }));
      await expect(
        deployer.deployElection(tooMany, endtime, "Too many", "0", "0")
      ).to.be.reverted;
    });
  });

  describe("Voting", () => {
    it("cannot vote after the election has closed", async () => {
      const { election, endtime, alice } = await loadFixture(deployFixture);
      await time.increaseTo(endtime + 1);
      await expect(
        election.connect(alice).recordVote("test")
      ).to.be.revertedWithCustomError(election, "ElectionClosed");
    });

    it("can cast a vote", async () => {
      const { election, alice } = await loadFixture(deployFixture);
      await expect(election.connect(alice).recordVote("testVote"))
        .to.emit(election, "VoteCast")
        .withArgs(alice.address, "testVote", anyValue);
      expect(await election.voteCount()).to.equal(1);
    });

    it("re-casting replaces the previous vote", async () => {
      const { election, alice } = await loadFixture(deployFixture);
      await election.connect(alice).recordVote("firstVote");
      await election.connect(alice).recordVote("secondVote");
      const votes = await election.getVotes();
      expect(votes.length).to.equal(2); // placeholder + 1 real vote
      expect(votes[1]).to.equal("secondVote");
      expect(await election.voteCount()).to.equal(1);
    });

    it("stores votes from multiple voters", async () => {
      const { election, alice, bob, chris } = await loadFixture(deployFixture);
      await election.connect(alice).recordVote("voteA");
      await election.connect(bob).recordVote("voteB");
      await election.connect(chris).recordVote("voteC");
      const votes = await election.getVotes();
      expect(votes[1]).to.equal("voteA");
      expect(votes[2]).to.equal("voteB");
      expect(votes[3]).to.equal("voteC");
      expect(await election.voteCount()).to.equal(3);
    });
  });

  describe("Publishing results", () => {
    it("unauthorised user cannot publish results", async () => {
      const { election, endtime, alice } = await loadFixture(deployFixture);
      await time.increaseTo(endtime + 1);
      await expect(
        election.connect(alice).publishResults(zeroResults())
      ).to.be.revertedWithCustomError(election, "NotAuthorized");
    });

    it("cannot publish while the election is in progress", async () => {
      const { election } = await loadFixture(deployFixture);
      await expect(
        election.publishResults(zeroResults())
      ).to.be.revertedWithCustomError(election, "ElectionInProgress");
    });

    it("cannot publish twice", async () => {
      const { election, endtime } = await loadFixture(deployFixture);
      await time.increaseTo(endtime + 1);
      await election.publishResults(zeroResults());
      await expect(
        election.publishResults(zeroResults())
      ).to.be.revertedWithCustomError(election, "ResultsAlreadyPublished");
    });

    it("cannot publish results that disagree with the number of cast votes", async () => {
      const { election, endtime } = await loadFixture(deployFixture);
      await time.increaseTo(endtime + 1);
      const bad = [
        { option: OPTIONS[0], count: 100 },
        { option: OPTIONS[1], count: 0 },
      ];
      await expect(
        election.publishResults(bad)
      ).to.be.revertedWithCustomError(election, "VoteCountMismatch");
    });

    it("creator can publish matching results", async () => {
      const { election, endtime, alice, bob } = await loadFixture(deployFixture);
      await election.connect(alice).recordVote("voteA");
      await election.connect(bob).recordVote("voteB");
      await time.increaseTo(endtime + 1);
      const submitted = [
        { option: OPTIONS[0], count: 1 },
        { option: OPTIONS[1], count: 1 },
      ];
      await expect(election.publishResults(submitted)).to.emit(
        election,
        "ResultsPublished"
      );
      const results = await election.getResults();
      expect(results[0].count).to.equal(1);
      expect(results[1].count).to.equal(1);
    });
  });

  describe("Publishing verification", () => {
    it("unauthorised user cannot publish verification", async () => {
      const { election, endtime, alice } = await loadFixture(deployFixture);
      await time.increaseTo(endtime + 1);
      await election.publishResults(zeroResults());
      await expect(
        election.connect(alice).publishVerification("1", "2", "3")
      ).to.be.revertedWithCustomError(election, "NotAuthorized");
    });

    it("cannot publish verification before results", async () => {
      const { election, endtime } = await loadFixture(deployFixture);
      await time.increaseTo(endtime + 1);
      await expect(
        election.publishVerification("1", "2", "3")
      ).to.be.revertedWithCustomError(election, "ResultsNotPublished");
    });

    it("cannot publish verification twice", async () => {
      const { election, endtime } = await loadFixture(deployFixture);
      await time.increaseTo(endtime + 1);
      await election.publishResults(zeroResults());
      await election.publishVerification("1", "2", "3");
      await expect(
        election.publishVerification("1", "2", "3")
      ).to.be.revertedWithCustomError(election, "VerificationAlreadyPublished");
    });

    it("creator can publish and read back verification data", async () => {
      const { election, endtime } = await loadFixture(deployFixture);
      await time.increaseTo(endtime + 1);
      await election.publishResults(zeroResults());
      await expect(election.publishVerification("111", "222", "333")).to.emit(
        election,
        "VerificationPublished"
      );
      const [c, m, w] = await election.getVerification();
      expect(c).to.equal("111");
      expect(m).to.equal("222");
      expect(w).to.equal("333");
    });
  });
});
