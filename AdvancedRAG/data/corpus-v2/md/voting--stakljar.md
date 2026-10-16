# voting--stakljar

- domain: voting-governance (voting)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Stakljar/voting-system-dapp @ 022557e4b4d07654d92ca0d661d32a5eaab88dd7
- license: MIT
- targets: Voting.sol
- validation: 14 passing tests, 0 failing; statement coverage Voting.sol 96.15 %

## Contract: Voting.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Voting {
    struct Candidate {
        bytes32 fullName;
        uint32 voteCount;
    }

    enum VotingStatus { UNALLOWED, PENDING, VOTED }

    Candidate[] private candidates;
    mapping(address => VotingStatus) private voters;
    address[] private allowedVotersAddresses;
    address private owner;
    uint256 private startTime;
    uint256 private endTime;

    constructor(bytes32[] memory _candidates, address[] memory _allowedVoters, uint256 votingTime) {
        for(uint16 i = 0; i < _candidates.length; i++) {
            candidates.push(Candidate(_candidates[i], 0));
        }
        for(uint32 i = 0; i < _allowedVoters.length; i++) {
            voters[_allowedVoters[i]] = VotingStatus.PENDING;
            allowedVotersAddresses.push(_allowedVoters[i]);
        }
        startTime = block.timestamp;
        endTime = votingTime + block.timestamp;
        owner = msg.sender;
    }

    event Vote(address voter, bytes32 candidate);
    event Restart();

    modifier OnlyOwner() {
        require(msg.sender == owner, "Caller must be owner");
        _;
    }

    modifier VotingEnded() {
        require(endTime <= block.timestamp, "Voting needs to end");
        _;
    }

    modifier VotingInProgress() {
        require(endTime > block.timestamp, "Voting needs to be in progress");
        _;
    }

    function getStartTime() public view returns(uint256) {
        return startTime;
    }

    function getEndTime() public view returns(uint256) {
        return endTime;
    }

    function getCandidates() public view returns(Candidate[] memory) {
        return candidates;
    }

    function getVotingStatus() public view returns(VotingStatus) {
        return voters[msg.sender];
    }

    function getOwner() public view returns(address) {
        return owner;
    }

    function getHighestVoteCountOccurencies() private view returns(uint16) {
        uint32 highestVoteCount = 0;
        uint16 highestVoteOccurencies = 0;
        for(uint16 i = 0; i < candidates.length; i++) {
            if(highestVoteCount < candidates[i].voteCount) {
                highestVoteCount = candidates[i].voteCount;
                highestVoteOccurencies = 1;
            }
            else if(highestVoteCount == candidates[i].voteCount) {
                highestVoteOccurencies++;
            }
        }
        return highestVoteOccurencies;
    }

    function vote(uint16 candidateIndex) public VotingInProgress {
        require(voters[msg.sender] != VotingStatus.VOTED, "You have already voted");
        require(voters[msg.sender] != VotingStatus.UNALLOWED, "You do not have permission to vote");
        require(candidates.length > candidateIndex, "Candidate index is out of bounds");
        candidates[candidateIndex].voteCount++;
        voters[msg.sender] = VotingStatus.VOTED;
        emit Vote(msg.sender, candidates[candidateIndex].fullName);
    }

    function restartVoting(uint256 votingTime) public OnlyOwner VotingEnded {
        require(getHighestVoteCountOccurencies() > 1, "There needs to be more than 1 candidate with highest votes");
        endTime = votingTime + block.timestamp;
        for(uint16 i = 0; i < candidates.length; i++) {
            candidates[i].voteCount = 0;
        }
        for(uint32 i = 0; i < allowedVotersAddresses.length; i++) {
            voters[allowedVotersAddresses[i]] = VotingStatus.PENDING;
        }
        emit Restart();
    }
}
```

## Tests: Voting.js

```javascript
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const hre = require("hardhat");

describe("Voting", function () {
  const VOTING_TIME = 864_000;
  const candidates = [
    hre.ethers.encodeBytes32String("William Black"), hre.ethers.encodeBytes32String("Ryan Boyd"), hre.ethers.encodeBytes32String("Derek Smith"),
    hre.ethers.encodeBytes32String("Henry Cooper"), hre.ethers.encodeBytes32String("Robert Powell")
  ];
  const allowedVoters = [
    hre.ethers.getAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"), hre.ethers.getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
    hre.ethers.getAddress("0x90F79bf6EB2c4f870365E785982E1f101E93b906"), hre.ethers.getAddress("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"),
    hre.ethers.getAddress("0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"), hre.ethers.getAddress("0x976EA74026E726554dB657fA54763abd0C3a0aa9"),
    hre.ethers.getAddress("0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"), hre.ethers.getAddress("0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f"),
    hre.ethers.getAddress("0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"), hre.ethers.getAddress("0xBcd4042DE499D14e55001CcbB24a551F3b954096"),
    hre.ethers.getAddress("0x71bE63f3384f5fb98995898A86B02Fb2426c5788"), hre.ethers.getAddress("0xFABB0ac9d68B0B445fB7357272Ff202C5651694a"),
    hre.ethers.getAddress("0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec"), hre.ethers.getAddress("0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097"),
    hre.ethers.getAddress("0xcd3B766CCDd6AE721141F452C550Ca635964ce71"),
  ];

  async function deployContractFixture() {
    const [owner, addr1, addr2] = await hre.ethers.getSigners();
    const Voting = await hre.ethers.getContractFactory("Voting");
    const voting = await Voting.deploy(candidates, allowedVoters, VOTING_TIME);
    return { voting, owner, addr1, addr2 };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { voting, owner } = await loadFixture(deployContractFixture);
      expect(await voting.getOwner()).to.equal(owner.address);
    });

    it("Should set right candidates", async function () {
      const { voting } = await loadFixture(deployContractFixture);
      expect(await voting.getCandidates()).to.deep.equal(candidates.map((candidate) => { return [candidate, 0n]}));
    });

    it("Should set the right start time", async function () {
      const { voting } = await loadFixture(deployContractFixture);
      const startTime = await time.latest();
      expect(await voting.getStartTime()).to.equal(startTime);
    });

    it("Should set the right end time", async function () {
      const { voting } = await loadFixture(deployContractFixture);
      const endTime = (await time.latest()) + VOTING_TIME;
      expect(await voting.getEndTime()).to.equal(endTime);
    });
  });

  describe("Voting", function () {
    it("Should vote", async function () {
      const { voting, addr1 } = await loadFixture(deployContractFixture);
      await expect(voting.connect(addr1).vote(2))
        .to.emit(voting, "Vote")
        .withArgs(addr1.address, hre.ethers.encodeBytes32String("Derek Smith"));
    });

    it("Should fail if time is up", async function () {
      const { voting } = await loadFixture(deployContractFixture);
      await time.increaseTo(await time.latest() + VOTING_TIME + 10);
      await expect(voting.vote(2)).to.be.revertedWith(
        "Voting needs to be in progress"
      );
    });

    it("Should fail if already voted", async function () {
      const { voting } = await loadFixture(deployContractFixture);
      await voting.vote(3);
      await expect(voting.vote(2)).to.be.revertedWith(
        "You have already voted"
      );
    });

    it("Should fail if invalid candidate index", async function () {
      const { voting } = await loadFixture(deployContractFixture);
      await expect(voting.vote(25)).to.be.revertedWith(
        "Candidate index is out of bounds"
      );
    });

    it("Should fail if voter is not allowed to vote", async function () {
      const { voting, addr2 } = await loadFixture(deployContractFixture);
      await expect(voting.connect(addr2).vote(2)).to.be.revertedWith(
        "You do not have permission to vote"
      );
    });
  });

  describe("Voting restart", function () {
    it("Should restart voting", async function () {
      const { voting } = await loadFixture(deployContractFixture);
      await time.increaseTo(await time.latest() + VOTING_TIME + 10);
      await expect(voting.restartVoting(VOTING_TIME)).to.emit(voting, "Restart");
    });

    it("Should fail if caller is not owner", async function () {
      const { voting, addr1 } = await loadFixture(deployContractFixture);
      await time.increaseTo(await time.latest() + VOTING_TIME + 10);
      await expect(voting.connect(addr1).restartVoting(VOTING_TIME)).to.be.revertedWith(
        "Caller must be owner"
      );
    });

    it("Should fail if voting did not end yet", async function () {
      const { voting } = await loadFixture(deployContractFixture);
      await expect(voting.restartVoting(VOTING_TIME)).to.be.revertedWith(
        "Voting needs to end"
      );
    });

    it("Should fail if there is only 1 candidate with highest vote count", async function () {
      const { voting } = await loadFixture(deployContractFixture);
      await voting.vote(2);
      await time.increaseTo(await time.latest() + VOTING_TIME + 10);
      await expect(voting.restartVoting(VOTING_TIME)).to.be.revertedWith(
        "There needs to be more than 1 candidate with highest votes"
      );
    });

    it("Should set the right end time after restarted voting", async function () {
      const { voting } = await loadFixture(deployContractFixture);
      const NEW_VOTING_TIME = VOTING_TIME - 100_000;
      await time.increaseTo(await time.latest() + VOTING_TIME + 10);
      await voting.restartVoting(NEW_VOTING_TIME);
      const endTime = (await time.latest()) + NEW_VOTING_TIME;
      expect(await voting.getEndTime()).to.equal(endTime);
    });
  });
});
```
