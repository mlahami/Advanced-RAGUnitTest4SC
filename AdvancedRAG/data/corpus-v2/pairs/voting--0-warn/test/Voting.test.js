// Voting contract tests. I wrote these to check the core rules:
// registering voters, one vote per wallet, the election window, and
// the commit-reveal flow (hidden ballot -> reveal -> counting).

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Helper that deploys a fresh Voting contract for each test.
// The window starts a bit in the future and ends an hour later.
async function deployVoting(startOffset = 60, endOffset = 3600) {
  const latest = await ethers.provider.getBlock("latest");
  const now = latest.timestamp;
  const Voting = await ethers.getContractFactory("Voting");
  const voting = await Voting.deploy(now + startOffset, now + endOffset);
  await voting.waitForDeployment();
  return voting;
}

// The expected commitment for a (candidateId, salt) pair.
function commitment(candidateId, salt) {
  return ethers.keccak256(
    ethers.solidityPacked(["uint256", "bytes32"], [candidateId, salt])
  );
}

// Moves the chain clock forward so the election window changes.
async function timeTravel(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function setNextBlockTimestamp(ts) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
  await ethers.provider.send("evm_mine", []);
}

// Standard setup: two candidates (with wallets), one registered voter,
// window open.
async function setupBallot(voting, voter) {
  await voting.connect(admin).addCandidate("Candidate One", "Party A", candA.address);
  await voting.connect(admin).addCandidate("Candidate Two", "Party B", candB.address);
  await voting.connect(admin).registerVoter(voter.address);
  const latest = await ethers.provider.getBlock("latest");
  await setNextBlockTimestamp(latest.timestamp + 61);
}

let voting;
let admin, voter, voter2, random, candA, candB;

beforeEach(async function () {
  // candA/candB act as the candidates' representative wallets.
  [admin, voter, voter2, random, , , candA, candB] = await ethers.getSigners();
  voting = await deployVoting();
});

describe("Voting", function () {
  describe("deployment", function () {
    it("sets the deployer as the admin", async function () {
      expect(await voting.admin()).to.equal(admin.address);
    });

    it("sets the election window from the constructor", async function () {
      const start = await voting.electionStartTime();
      const end = await voting.electionEndTime();
      expect(end).to.be.greaterThan(start);
    });

    it("rejects an election window where end <= start", async function () {
      const latest = await ethers.provider.getBlock("latest");
      const Voting = await ethers.getContractFactory("Voting");
      await expect(Voting.deploy(latest.timestamp, latest.timestamp)).to.be.revertedWith(
        "End time must be after start time"
      );
    });
  });

  describe("voter registration", function () {
    it("lets the admin register a voter", async function () {
      await voting.connect(admin).registerVoter(voter.address);
      expect(await voting.isRegistered(voter.address)).to.equal(true);
    });

    it("emits a VoterRegistered event", async function () {
      await expect(voting.connect(admin).registerVoter(voter.address))
        .to.emit(voting, "VoterRegistered")
        .withArgs(voter.address);
    });

    it("rejects registration by a non-admin", async function () {
      await expect(voting.connect(voter).registerVoter(voter.address)).to.be.revertedWith(
        "Only the Election Officer can do this"
      );
    });

    it("rejects registering the same voter twice", async function () {
      await voting.connect(admin).registerVoter(voter.address);
      await expect(voting.connect(admin).registerVoter(voter.address)).to.be.revertedWith(
        "Already registered"
      );
    });

    it("rejects the zero address", async function () {
      await expect(voting.connect(admin).registerVoter(ethers.ZeroAddress)).to.be.revertedWith(
        "Invalid address"
      );
    });
  });

  describe("candidates", function () {
    it("lets the admin add a candidate with a wallet address", async function () {
      await voting.connect(admin).addCandidate("Candidate One", "Party A", candA.address);
      expect(await voting.candidateCount()).to.equal(1);
      const candidate = await voting.candidates(0);
      expect(candidate.name).to.equal("Candidate One");
      expect(candidate.partySymbol).to.equal("Party A");
      expect(candidate.candidateAddress).to.equal(candA.address);
      expect(candidate.voteCount).to.equal(0);
    });

    it("rejects adding a candidate by a non-admin", async function () {
      await expect(
        voting.connect(voter).addCandidate("X", "Y", candA.address)
      ).to.be.revertedWith("Only the Election Officer can do this");
    });

    it("rejects the zero address as a candidate wallet", async function () {
      await expect(
        voting.connect(admin).addCandidate("X", "Y", ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid candidate address");
    });

    it("rejects two candidates sharing one wallet address", async function () {
      await voting.connect(admin).addCandidate("First", "Party A", candA.address);
      await expect(
        voting.connect(admin).addCandidate("Second", "Party B", candA.address)
      ).to.be.revertedWith("This address is already a candidate");
    });

    it("lets the admin look up a candidate by their address", async function () {
      await voting.connect(admin).addCandidate("Candidate One", "Party A", candA.address);
      const found = await voting.connect(admin).getCandidateByAddress(candA.address);
      expect(found.name).to.equal("Candidate One");
      expect(found.partySymbol).to.equal("Party A");
      expect(found.voteCount).to.equal(0);
    });

    it("rejects the lookup for a non-admin", async function () {
      await voting.connect(admin).addCandidate("Candidate One", "Party A", candA.address);
      await expect(voting.connect(voter).getCandidateByAddress(candA.address)).to.be.revertedWith(
        "Only the Election Officer can do this"
      );
    });

    it("reverts when no candidate has that address", async function () {
      await voting.connect(admin).addCandidate("Candidate One", "Party A", candA.address);
      await expect(voting.connect(admin).getCandidateByAddress(random.address)).to.be.revertedWith(
        "No candidate found with this address"
      );
    });
  });

  describe("voting (commit phase)", function () {
    beforeEach(async function () {
      await setupBallot(voting, voter);
    });

    it("lets a registered voter commit a vote", async function () {
      const salt = ethers.randomBytes(32);
      await voting.connect(voter).vote(0, salt);
      expect(await voting.hasVoted(voter.address)).to.equal(true);
    });

    it("stores a salted commitment instead of the candidate id", async function () {
      const salt = ethers.randomBytes(32);
      await voting.connect(voter).vote(1, salt);
      // The stored value is the salted hash — not the id itself.
      expect(await voting.commitments(voter.address)).to.equal(commitment(1, salt));
      // And no vote is counted yet — the ballot is hidden.
      const candidate = await voting.candidates(1);
      expect(candidate.voteCount).to.equal(0);
      expect(await voting.totalVotes()).to.equal(0);
    });

    it("emits a VoteCast event without revealing the candidate", async function () {
      const salt = ethers.randomBytes(32);
      await expect(voting.connect(voter).vote(0, salt))
        .to.emit(voting, "VoteCast")
        .withArgs(voter.address);
    });

    it("rejects an empty salt", async function () {
      await expect(voting.connect(voter).vote(0, ethers.ZeroHash)).to.be.revertedWith(
        "Salt cannot be empty"
      );
    });

    it("rejects a double vote from the same wallet", async function () {
      await voting.connect(voter).vote(0, ethers.randomBytes(32));
      await expect(voting.connect(voter).vote(1, ethers.randomBytes(32))).to.be.revertedWith(
        "You have already voted"
      );
    });

    it("rejects a vote from an unregistered address", async function () {
      await expect(voting.connect(random).vote(0, ethers.randomBytes(32))).to.be.revertedWith(
        "You are not a registered voter"
      );
    });

    it("rejects an out-of-range candidate id", async function () {
      await expect(voting.connect(voter).vote(99, ethers.randomBytes(32))).to.be.revertedWith(
        "Invalid candidate id"
      );
    });

    it("rejects voting before the election starts", async function () {
      const lateVoting = await deployVoting(3600, 7200);
      await lateVoting.connect(admin).addCandidate("Candidate One", "Party A", candA.address);
      await lateVoting.connect(admin).registerVoter(voter.address);
      await expect(lateVoting.connect(voter).vote(0, ethers.randomBytes(32))).to.be.revertedWith(
        "Election has not started yet"
      );
    });

    it("rejects voting after the election window ends", async function () {
      await voting.connect(voter).vote(0, ethers.randomBytes(32));
      // Jump past the end time and try to vote from a second wallet.
      await timeTravel(3600);
      await voting.connect(admin).registerVoter(voter2.address);
      await expect(voting.connect(voter2).vote(0, ethers.randomBytes(32))).to.be.revertedWith(
        "Election has ended"
      );
    });
  });

  describe("counting (reveal phase)", function () {
    beforeEach(async function () {
      await setupBallot(voting, voter);
    });

    it("rejects revealing before the election is over", async function () {
      const salt = ethers.randomBytes(32);
      await voting.connect(voter).vote(0, salt);
      await expect(voting.connect(voter).reveal(0, salt)).to.be.revertedWith(
        "Votes are not being counted yet"
      );
    });

    it("counts the vote for the right candidate after revealing", async function () {
      const salt = ethers.randomBytes(32);
      await voting.connect(voter).vote(1, salt);
      await voting.connect(admin).endElection();
      await voting.connect(voter).reveal(1, salt);

      const candidate = await voting.candidates(1);
      expect(candidate.voteCount).to.equal(1);
      expect(await voting.totalVotes()).to.equal(1);
    });

    it("emits a VoteRevealed event with the candidate", async function () {
      const salt = ethers.randomBytes(32);
      await voting.connect(voter).vote(1, salt);
      await voting.connect(admin).endElection();
      await expect(voting.connect(voter).reveal(1, salt))
        .to.emit(voting, "VoteRevealed")
        .withArgs(voter.address, 1);
    });

    it("rejects revealing with the wrong salt", async function () {
      const salt = ethers.randomBytes(32);
      await voting.connect(voter).vote(0, salt);
      await voting.connect(admin).endElection();
      await expect(voting.connect(voter).reveal(0, ethers.randomBytes(32))).to.be.revertedWith(
        "Hash does not match your committed vote"
      );
    });

    it("rejects revealing a different candidate than committed", async function () {
      const salt = ethers.randomBytes(32);
      await voting.connect(voter).vote(0, salt);
      await voting.connect(admin).endElection();
      await expect(voting.connect(voter).reveal(1, salt)).to.be.revertedWith(
        "Hash does not match your committed vote"
      );
    });

    it("rejects revealing twice", async function () {
      const salt = ethers.randomBytes(32);
      await voting.connect(voter).vote(0, salt);
      await voting.connect(admin).endElection();
      await voting.connect(voter).reveal(0, salt);
      await expect(voting.connect(voter).reveal(0, salt)).to.be.revertedWith(
        "You have already revealed your vote"
      );
    });

    it("lets someone who never voted reveal", async function () {
      // Edge case: reveal() without a vote just reverts cleanly.
      await voting.connect(admin).endElection();
      await expect(voting.connect(voter).reveal(0, ethers.randomBytes(32))).to.be.revertedWith(
        "You have not voted yet"
      );
    });
  });

  describe("ending the election", function () {
    beforeEach(async function () {
      await setupBallot(voting, voter);
    });

    it("lets only the admin end the election", async function () {
      await expect(voting.connect(voter).endElection()).to.be.revertedWith(
        "Only the Election Officer can do this"
      );
    });

    it("locks results until the election is ended", async function () {
      await voting.connect(voter).vote(0, ethers.randomBytes(32));
      await expect(voting.getResults()).to.be.revertedWith(
        "Results are not out yet - election still in progress"
      );
    });

    it("returns the vote counts after ending and revealing", async function () {
      const salt = ethers.randomBytes(32);
      await voting.connect(voter).vote(0, salt);
      await voting.connect(admin).endElection();
      await voting.connect(voter).reveal(0, salt);
      const results = await voting.getResults();
      expect(results.length).to.equal(2);
      expect(results[0].voteCount).to.equal(1);
      expect(results[1].voteCount).to.equal(0);
    });

    it("rejects votes after the admin ends the election", async function () {
      await voting.connect(admin).registerVoter(voter2.address);
      await voting.connect(admin).endElection();
      await expect(voting.connect(voter).vote(0, ethers.randomBytes(32))).to.be.revertedWith(
        "Election has been ended by the admin"
      );
    });
  });

  describe("election window", function () {
    it("lets the admin move the window with setElectionWindow", async function () {
      const latest = await ethers.provider.getBlock("latest");
      const newStart = latest.timestamp + 100;
      const newEnd = latest.timestamp + 500;
      await voting.connect(admin).setElectionWindow(newStart, newEnd);
      expect(await voting.electionStartTime()).to.equal(newStart);
      expect(await voting.electionEndTime()).to.equal(newEnd);
    });

    it("rejects a bad window from setElectionWindow", async function () {
      const latest = await ethers.provider.getBlock("latest");
      await expect(
        voting.connect(admin).setElectionWindow(latest.timestamp + 500, latest.timestamp + 100)
      ).to.be.revertedWith("End time must be after start time");
    });

    it("allows revealing after the window passes naturally", async function () {
      // Even if the admin never calls endElection, votes become countable
      // once the end time has passed.
      await setupBallot(voting, voter);
      const salt = ethers.randomBytes(32);
      await voting.connect(voter).vote(0, salt);
      await timeTravel(3600);
      await voting.connect(voter).reveal(0, salt);
      const candidate = await voting.candidates(0);
      expect(candidate.voteCount).to.equal(1);
    });
  });
});