# habitat-vote--habitathash

- domain: voting-governance (voting)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/HabitatHash/HabitatHash @ fffe7e5f18a46f4c11ae9f5a823560bfde34e0ea
- license: MIT
- targets: HabitatVote.sol
- validation: 9 passing tests, 0 failing; statement coverage HabitatVote.sol 100.0 %

## Contract: HabitatVote.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

contract HabitatVote {
    struct Voter {
        address voter; // The person who voted
        bool voted; // if true, that person already voted
        bool vote; // index of the voted proposal
    }

    struct InsuranceCase {
        address relatedTo; // Case is related to rental contract
        string description; // A description of why the person wants to claim insurance
        uint value; // How much the person wants to claim
    }

    //Owner of the contract
    address public owner;
    //How many votes needed to close the case. Increase as application scales.
    uint numberOfVotes = 11;
    //Case details
    InsuranceCase insuranceCase;

    // Keep track of the voters
    address[] public voters;
    mapping(address => Voter) public votes;

    constructor(
        address contractOwner,
        address relatedTo,
        string memory description,
        uint256 value
    ) {
        owner = contractOwner;
        insuranceCase = InsuranceCase(relatedTo, description, value);
    }

    event voted(address indexed _user, bool vote);
    event votingFinished(bool result);

    //Get the details of the case
    function getCase() public view returns (InsuranceCase memory) {
        return insuranceCase;
    }

    //Vote on the case
    function vote(bool value) public {
        require(votes[msg.sender].voted == false, "You have already voted");
        require(msg.sender != owner, "You can not vote for your own claim");
        require(voters.length < numberOfVotes, "The voting is over");

        votes[msg.sender].voted = true;
        voters.push(msg.sender);
        votes[msg.sender].vote = value;

        emit voted(msg.sender, value);
        if (voters.length == numberOfVotes) {
            emit votingFinished(getResult());
        }
    }

    //See what a specific address voted
    function getVoteByAddress(address addr) public view returns (bool) {
        require(votes[addr].voted, "This address has not voted");
        return votes[addr].vote;
    }

    //Get the final result of the voting
    function getResult() public view returns (bool) {
        require(voters.length == numberOfVotes, "Voting is not over");

        uint yesVote = 0;

        for (uint i = 0; i < voters.length; i++) {
            if (getVoteByAddress(voters[i])) {
                yesVote += 1;
            }
        }
        return yesVote > (numberOfVotes / 2);
    }
}
```

## Tests: HabitatVote.test.js

```javascript
const { expect } = require('chai');
const {
  loadFixture,
} = require('@nomicfoundation/hardhat-network-helpers');

const zeroAddress = '0x0000000000000000000000000000000000000000';

describe('HabitatVote', async function () {
  async function deployContractFixture() {
    const [
      addr1,
      addr2,
      addr3,
      addr4,
      addr5,
      addr6,
      addr7,
      addr8,
      addr9,
      addr10,
      addr11,
      addr12,
      addr13,
    ] = await ethers.getSigners();

    const contract = await ethers.deployContract('HabitatVote', [
      addr1,
      zeroAddress,
      'description',
      100,
    ]);

    return {
      contract,
      addr1,
      addr2,
      addr3,
      addr4,
      addr5,
      addr6,
      addr7,
      addr8,
      addr9,
      addr10,
      addr11,
      addr12,
      addr13,
    };
  }
  it('Deployment should set correct information', async function () {
    const { contract, addr1 } = await loadFixture(deployContractFixture);

    const owner = await contract.owner();
    const caseInfo = await contract.getCase();

    expect(owner).to.equal(addr1.address);
    expect(caseInfo.description).to.equal('description');
    expect(caseInfo.value).to.equal(100);
    expect(caseInfo.relatedTo).to.equal(zeroAddress);
  });
  it('You shouldnt be able to vote in your own claim', async function () {
    const { contract, addr1 } = await loadFixture(deployContractFixture);

    await expect(contract.connect(addr1).vote(true)).to.be.revertedWith(
      'You can not vote for your own claim'
    );
  });
  it('You should be able to vote on other claims', async function () {
    const { contract, addr2 } = await loadFixture(deployContractFixture);

    await contract.connect(addr2).vote(true);

    const vote = await contract.getVoteByAddress(addr2.address);

    expect(vote).to.equal(true);
  });
  it('You shouldnt be able to vote more than once', async function () {
    const { contract, addr2 } = await loadFixture(deployContractFixture);

    await contract.connect(addr2).vote(true);

    await expect(contract.connect(addr2).vote(true)).to.be.revertedWith(
      'You have already voted'
    );
  });
  it('Cant get vote by address that havnt voted', async function () {
    const { contract, addr2 } = await loadFixture(deployContractFixture);

    await expect(contract.getVoteByAddress(addr2.address)).to.be.revertedWith(
      'This address has not voted'
    );
  });
  it('Cant get result when voting is not done', async function () {
    const { contract, addr2 } = await loadFixture(deployContractFixture);

    await expect(contract.getResult()).to.be.revertedWith('Voting is not over');
  });
  it('Should not be able to vote when voting is done', async function () {
    const {
      contract,
      addr2,
      addr3,
      addr4,
      addr5,
      addr6,
      addr7,
      addr8,
      addr9,
      addr10,
      addr11,
      addr12,
      addr13,
    } = await loadFixture(deployContractFixture);

    await contract.connect(addr2).vote(true);
    await contract.connect(addr3).vote(true);
    await contract.connect(addr4).vote(true);
    await contract.connect(addr5).vote(true);
    await contract.connect(addr6).vote(true);
    await contract.connect(addr7).vote(false);
    await contract.connect(addr8).vote(false);
    await contract.connect(addr9).vote(false);
    await contract.connect(addr10).vote(true);
    await contract.connect(addr11).vote(true);
    await contract.connect(addr12).vote(false);

    await expect(contract.connect(addr13).vote(true)).to.be.revertedWith(
      'The voting is over'
    );
  });
  it('You should be able to get result (true) when voting is done', async function () {
    const {
      contract,
      addr2,
      addr3,
      addr4,
      addr5,
      addr6,
      addr7,
      addr8,
      addr9,
      addr10,
      addr11,
      addr12,
    } = await loadFixture(deployContractFixture);

    await contract.connect(addr2).vote(true);
    await contract.connect(addr3).vote(true);
    await contract.connect(addr4).vote(true);
    await contract.connect(addr5).vote(true);
    await contract.connect(addr6).vote(true);
    await contract.connect(addr7).vote(false);
    await contract.connect(addr8).vote(false);
    await contract.connect(addr9).vote(false);
    await contract.connect(addr10).vote(true);
    await contract.connect(addr11).vote(true);
    await contract.connect(addr12).vote(false);

    const result = await contract.getResult();
    expect(result).to.equal(true);
  });
  it('You should be able to get result (false) when voting is done', async function () {
    const {
      contract,
      addr2,
      addr3,
      addr4,
      addr5,
      addr6,
      addr7,
      addr8,
      addr9,
      addr10,
      addr11,
      addr12,
    } = await loadFixture(deployContractFixture);

    await contract.connect(addr2).vote(false);
    await contract.connect(addr3).vote(false);
    await contract.connect(addr4).vote(false);
    await contract.connect(addr5).vote(true);
    await contract.connect(addr6).vote(true);
    await contract.connect(addr7).vote(false);
    await contract.connect(addr8).vote(false);
    await contract.connect(addr9).vote(false);
    await contract.connect(addr10).vote(true);
    await contract.connect(addr11).vote(true);
    await contract.connect(addr12).vote(false);

    const result = await contract.getResult();
    expect(result).to.equal(false);
  });
});
```
