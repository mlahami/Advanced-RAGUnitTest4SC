# voting--0-warn

- domain: voting-governance (voting-commit-reveal)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/0-warn/BCE-VOTE @ ef4cb2021102d3f9d1691cffcd9116a4eee9c0ba
- license: MIT
- targets: Voting.sol
- validation: 38 passing tests, 0 failing; statement coverage Voting.sol 100.0 %

## Contract: Voting.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// ==========================================================================
// Voting.sol — Bhārat Secure Vote
//
// A simple decentralized voting contract for a college mock-election demo.
// One wallet address = one vote, the admin (Election Officer) registers
// voters ahead of time, and results are only visible after the election
// is officially ended by the admin.
//
// PRIVACY NOTE: I am NOT using zk-proofs or ring signatures here. Votes
// are pseudonymous — they are tied to a wallet address, not to a real
// person's identity. A real election would need real identity checks
// (Aadhaar / e-KYC style) on top of this. That is out of scope for this
// project, and I have written this limitation in the README too.
// ==========================================================================

contract Voting {
    // ------------------------------------------------------------------
    // State variables
    // ------------------------------------------------------------------

    // The Election Officer — the only address allowed to register voters,
    // add candidates, and start/end the election. Set in the constructor.
    address public admin;

    // Candidate struct. I store candidates in an array so the frontend
    // can simply loop over them in order. The `id` is just the array
    // index, but I keep it in the struct anyway so the frontend never
    // has to guess it. Each candidate also has a representative wallet
    // address, so the Election Officer can look up their details later.
    struct Candidate {
        uint256 id;
        string name;
        string partySymbol;
        address candidateAddress;
        uint256 voteCount;
    }

    Candidate[] public candidates;

    // Quick duplicate check when adding candidates — two different
    // people cannot share one wallet address on the ballot. Kept
    // private because nobody outside needs to read it directly.
    mapping(address => bool) private usedCandidateAddresses;

    // Mappings give O(1) lookups — that is why I use them here instead
    // of searching through arrays.
    mapping(address => bool) public isRegistered;
    mapping(address => bool) public hasVoted;

    // ------------------------------------------------------------------
    // Commit-reveal privacy state
    // ------------------------------------------------------------------
    // Instead of storing the candidateId directly, the voter sends a
    // salted hash of it (a "commitment"). The actual choice stays hidden
    // on-chain until counting starts, when the voter reveals their
    // (candidateId, salt) pair and the contract verifies the hash.
    //
    // This is the commit-and-reveal pattern, which is taught in intro
    // blockchain courses. The salt is a random 32-byte value generated
    // by the voter's frontend, so no one can brute-force the hash and
    // read the choice before counting.
    mapping(address => bytes32) public commitments;
    mapping(address => bool) public hasRevealed;

    // Election window set by the admin. Voting only works while
    // block.timestamp is inside [start, end].
    uint256 public electionStartTime;
    uint256 public electionEndTime;

    // Admin can end the election early with endElection(). Results stay
    // locked until then.
    bool public electionEnded;

    // Total votes cast so far — handy for the results page.
    uint256 public totalVotes;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    // Privacy choice: I only log WHICH address voted, not who they voted
    // for. So there is no on-chain event trail per candidate — even the
    // admin cannot see the full history from events alone.
    event VoteCast(address indexed voter);

    // Emitted when a voter reveals their choice during counting. This
    // one DOES include the candidate — revealing is public by design,
    // since results are meant to be public after the election.
    event VoteRevealed(address indexed voter, uint256 candidateId);

    event CandidateAdded(
        uint256 indexed id,
        string name,
        string partySymbol,
        address candidateAddress
    );
    event VoterRegistered(address indexed voter);
    event ElectionStarted(uint256 startTime, uint256 endTime);
    event ElectionEnded(uint256 totalVotes);

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only the Election Officer can do this");
        _;
    }

    // Checks the election window using block.timestamp.
    modifier votingOpen() {
        require(
            block.timestamp >= electionStartTime,
            "Election has not started yet"
        );
        require(
            block.timestamp <= electionEndTime,
            "Election has ended"
        );
        _;
    }

    // Counting only starts once the admin ends the election (or when the
    // window passes naturally). Until then, reveal() refuses to work.
    modifier countingOpen() {
        require(
            electionEnded || block.timestamp > electionEndTime,
            "Votes are not being counted yet"
        );
        _;
    }

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    // The deployer becomes the admin. I pass the election window here so
    // the whole election can be planned before deployment.
    constructor(uint256 startTime, uint256 endTime) {
        require(endTime > startTime, "End time must be after start time");
        admin = msg.sender;
        electionStartTime = startTime;
        electionEndTime = endTime;
        emit ElectionStarted(startTime, endTime);
    }

    // ------------------------------------------------------------------
    // Admin functions
    // ------------------------------------------------------------------

    // Add a candidate to the ballot. `partySymbol` holds a symbol or
    // emoji (the frontend shows it as the party logo), and
    // `candidateAddress` is the candidate's representative wallet —
    // stored so the admin can look them up by address later.
    function addCandidate(
        string memory name,
        string memory partySymbol,
        address candidateAddress
    ) public onlyAdmin {
        require(candidateAddress != address(0), "Invalid candidate address");
        require(!usedCandidateAddresses[candidateAddress], "This address is already a candidate");
        usedCandidateAddresses[candidateAddress] = true;

        candidates.push(Candidate(candidates.length, name, partySymbol, candidateAddress, 0));
        emit CandidateAdded(candidates.length - 1, name, partySymbol, candidateAddress);
    }

    // Look up a candidate's details by their wallet address. Admin-only,
    // because before the results are declared there is no reason for
    // anyone else to dig into candidate records this way.
    function getCandidateByAddress(address candidateAddress)
        public
        view
        onlyAdmin
        returns (Candidate memory)
    {
        // Small list, so a simple loop is fine and easy to understand.
        for (uint256 i = 0; i < candidates.length; i++) {
            if (candidates[i].candidateAddress == candidateAddress) {
                return candidates[i];
            }
        }
        revert("No candidate found with this address");
    }

    // Register a voter wallet ahead of time. In a real system this step
    // would involve actual identity verification (Aadhaar, etc.), but
    // that is out of scope for this project — we just trust the admin
    // adds the right addresses.
    function registerVoter(address voter) public onlyAdmin {
        require(voter != address(0), "Invalid address");
        require(!isRegistered[voter], "Already registered");
        isRegistered[voter] = true;
        emit VoterRegistered(voter);
    }

    // Lets the admin move the election window (for example, to extend
    // polling hours on demo day).
    function setElectionWindow(uint256 startTime, uint256 endTime) public onlyAdmin {
        require(endTime > startTime, "End time must be after start time");
        electionStartTime = startTime;
        electionEndTime = endTime;
        emit ElectionStarted(startTime, endTime);
    }

    // End the election early. Results stay locked until this is called.
    function endElection() public onlyAdmin {
        require(!electionEnded, "Election already ended");
        electionEnded = true;
        emit ElectionEnded(totalVotes);
    }

    // ------------------------------------------------------------------
    // Public functions
    // ------------------------------------------------------------------

    // Commit phase: cast a vote for a candidate WITHOUT storing which
    // one. The voter includes a random salt, and we only store
    // keccak256(candidateId, salt). Every check happens HERE in the
    // contract — never trust the frontend to enforce rules.
    function vote(uint256 candidateId, bytes32 salt) public votingOpen {
        // Only voters who were registered by the admin can vote.
        require(isRegistered[msg.sender], "You are not a registered voter");
        // One wallet address = one vote.
        require(!hasVoted[msg.sender], "You have already voted");
        // Once the admin calls endElection, no more votes.
        require(!electionEnded, "Election has been ended by the admin");
        // candidateId comes from the user, so always check the bounds.
        require(candidateId < candidates.length, "Invalid candidate id");
        // An empty salt would make the hash trivially guessable — the
        // whole point is that the salt is random and kept secret.
        require(salt != bytes32(0), "Salt cannot be empty");

        // Store the commitment only. The candidate id is neither stored
        // nor emitted, so the choice is hidden on-chain until counting.
        commitments[msg.sender] = keccak256(abi.encodePacked(candidateId, salt));
        hasVoted[msg.sender] = true;

        // Reentrancy note: vote() makes no external calls and all state
        // changes happen before the event (checks-effects-interactions
        // pattern), so there is no reentrancy surface here. I am aware
        // of the attack, just no guard library needed for this contract.
        emit VoteCast(msg.sender);
    }

    // Reveal phase: after counting opens, the voter proves which
    // candidate they chose by sending (candidateId, salt). The contract
    // re-hashes the pair and only counts the vote if it matches the
    // stored commitment — so votes can't be tampered with during the
    // hidden period.
    function reveal(uint256 candidateId, bytes32 salt) public countingOpen {
        require(hasVoted[msg.sender], "You have not voted yet");
        require(!hasRevealed[msg.sender], "You have already revealed your vote");
        require(
            keccak256(abi.encodePacked(candidateId, salt)) == commitments[msg.sender],
            "Hash does not match your committed vote"
        );

        hasRevealed[msg.sender] = true;
        candidates[candidateId].voteCount += 1;
        totalVotes += 1;

        // The choice is public now — that is the whole point of counting.
        emit VoteRevealed(msg.sender, candidateId);
    }

    // ------------------------------------------------------------------
    // View functions
    // ------------------------------------------------------------------

    function candidateCount() public view returns (uint256) {
        return candidates.length;
    }

    // Results are locked until the admin declares the election over.
    function getResults() public view returns (Candidate[] memory) {
        require(electionEnded, "Results are not out yet - election still in progress");
        return candidates;
    }
}
```

## Tests: Voting.test.js

```javascript
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
```
