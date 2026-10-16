# election--tbayan

- domain: voting-governance (voting)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/tbayan/eVoting_paper_code @ e0a9cbf65c6bc97fb687e78c35e7aded2fbe4cc8
- license: MIT
- targets: Election.sol, Deployer.sol, ElectionStructs.sol
- validation: 15 passing tests, 0 failing; statement coverage Election.sol 100.0 %, Deployer.sol 100.0 %, ElectionStructs.sol 100.0 %

## Contract: Deployer.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VoteOption} from "./ElectionStructs.sol";
import {Election} from "./Election.sol";

/// @title Deployer - factory contract for Election instances.
contract Deployer {
    event ElectionCreated(
        address indexed electionAddress,
        address indexed creator,
        string electionTitle,
        uint256 electionEndtime
    );

    function deployElection(
        VoteOption[] memory options,
        uint256 endtime,
        string memory title,
        string memory pubkeyN,
        string memory pubkeyG
    ) public returns (address) {
        Election newElection = new Election(
            options,
            endtime,
            title,
            pubkeyN,
            pubkeyG,
            msg.sender
        );
        emit ElectionCreated(address(newElection), msg.sender, title, endtime);
        return address(newElection);
    }
}
```

## Contract: Election.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VoteOption, VoteResult} from "./ElectionStructs.sol";

/// @title Election - a single election instance.
/// Ballots are Paillier ciphertexts (decimal strings) encrypted client-side
/// under the election public key (pubkeyN, pubkeyG). After the election ends,
/// the creator publishes the per-option results, and then the
/// negligible-knowledge verification data: the homomorphic ciphertext total C,
/// the decrypted encoded total M, and the combined random factor
/// w = prod(r_v) mod N. Anyone can then check off-chain that
/// C == Enc(M, w) and that C equals the product of all stored ballots mod N^2.
contract Election {
    error ElectionClosed();
    error ElectionInProgress();
    error NotAuthorized();
    error ResultsAlreadyPublished();
    error ResultsNotPublished();
    error VerificationAlreadyPublished();
    error VoteCountMismatch();
    error TooManyOptions();

    event VoteCast(address indexed voter, string vote, uint256 timestamp);
    event ResultsPublished(uint256 timestamp);
    event VerificationPublished(uint256 timestamp);

    uint256 public constant MAX_OPTIONS = 10;

    string public title;
    address public immutable creator;
    uint256 public immutable endtime;
    bool public resultsPublished;
    bool public verificationPublished;

    // Election Paillier public key.
    string public pubkeyN;
    string public pubkeyG;

    // Negligible-knowledge verification data (published after tallying).
    string public encryptedTotal; // C = prod(ballots) mod N^2
    string public encodedTotal; // M = Dec(C), the encoded tally
    string public randomFactorW; // w with C == Enc(M, w)

    // votes[0] is a placeholder so that voteMap value 0 means "not voted yet".
    string[] public votes;
    mapping(address => uint256) private voteMap;
    VoteOption[] public options;
    VoteResult[] public results;

    constructor(
        VoteOption[] memory _options,
        uint256 _endtime,
        string memory _title,
        string memory _pubkeyN,
        string memory _pubkeyG,
        address _creator
    ) {
        if (_options.length > MAX_OPTIONS) revert TooManyOptions();
        for (uint256 i = 0; i < _options.length; i++) {
            options.push(_options[i]);
            results.push(VoteResult(_options[i], 0));
        }
        votes.push("");
        endtime = _endtime;
        title = _title;
        pubkeyN = _pubkeyN;
        pubkeyG = _pubkeyG;
        creator = _creator;
    }

    /// Cast (or replace) an encrypted ballot. Only the latest ballot per
    /// address is kept, which provides coercion resistance via re-voting.
    function recordVote(string memory _vote) public {
        if (block.timestamp >= endtime || resultsPublished || verificationPublished) {
            revert ElectionClosed();
        }
        uint256 index = voteMap[msg.sender];
        if (index == 0) {
            votes.push(_vote);
            voteMap[msg.sender] = votes.length - 1;
        } else {
            votes[index] = _vote;
        }
        emit VoteCast(msg.sender, _vote, block.timestamp);
    }

    function publishResults(VoteResult[] memory submittedResults) public {
        if (msg.sender != creator) revert NotAuthorized();
        if (block.timestamp <= endtime) revert ElectionInProgress();
        if (resultsPublished) revert ResultsAlreadyPublished();
        uint256 totalVoteCount = 0;
        for (uint256 i = 0; i < submittedResults.length; i++) {
            totalVoteCount += submittedResults[i].count;
        }
        if (totalVoteCount != votes.length - 1) revert VoteCountMismatch();
        for (uint256 i = 0; i < submittedResults.length; i++) {
            results[i].count = submittedResults[i].count;
        }
        resultsPublished = true;
        emit ResultsPublished(block.timestamp);
    }

    /// Publish the negligible-knowledge verification data. Must happen after
    /// the results so the published tally cannot be adjusted afterwards.
    function publishVerification(
        string memory _encryptedTotal,
        string memory _encodedTotal,
        string memory _randomFactorW
    ) public {
        if (msg.sender != creator) revert NotAuthorized();
        if (block.timestamp <= endtime) revert ElectionInProgress();
        if (!resultsPublished) revert ResultsNotPublished();
        if (verificationPublished) revert VerificationAlreadyPublished();
        encryptedTotal = _encryptedTotal;
        encodedTotal = _encodedTotal;
        randomFactorW = _randomFactorW;
        verificationPublished = true;
        emit VerificationPublished(block.timestamp);
    }

    function getVerification()
        public
        view
        returns (string memory, string memory, string memory)
    {
        return (encryptedTotal, encodedTotal, randomFactorW);
    }

    function getOptions() public view returns (VoteOption[] memory) {
        return options;
    }

    function getResults() public view returns (VoteResult[] memory) {
        return results;
    }

    function getVotes() public view returns (string[] memory) {
        return votes;
    }

    function voteCount() public view returns (uint256) {
        return votes.length - 1;
    }
}
```

## Contract: ElectionStructs.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct VoteOption {
    string name;
    string acronym;
    string logourl;
    uint16 power;
}

struct VoteResult {
    VoteOption option;
    uint32 count;
}
```

## Tests: election.test.js

```javascript
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
```
