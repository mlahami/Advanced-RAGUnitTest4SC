# fauna--myriamchah

- domain: crowdfunding (charity-dao)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/myriamchah/fauna @ 1f7c32478f5f3ebfb58417e06fe43d2eec83b2a5
- license: MIT
- targets: Fauna.sol
- validation: 44 passing tests, 0 failing; statement coverage Fauna.sol 100.0 %

## Contract: Fauna.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title A DAO bringing animal lovers efforts together to enhance wildlife protection
/// @author Myriam Chah

contract Fauna is Ownable, ReentrancyGuard {

// *********************************** STRUCTS ***********************************  
    
  struct Donator {
    uint totalDonated;
    bool hasVoted;
    uint votedProjectId;
  }

  struct Project {
    string name;
    string desc;
    address projAddress;
    uint voteCount;
    uint fundsReceived;
    bool usageCertified; 
  }

  enum  Phase {
    ProjectsCuration,
    VotesStarted,
    VotesEnded,
    FundsSent
  }

// *********************************** VARIABLES ***********************************  

  Phase public phase;
  Project[] projects;
  mapping (address => Donator) donators;
  uint public totalVotes;

// *********************************** EVENTS ***********************************  
   
  /// @notice Emitted when entering a new phase 
  /// @param current The current phase 
  event NewPhase(Phase current);

  /// @notice Emitted when a donation is received
  /// @param donator Adress of the donator
  /// @param amount Amount of the donation
  event DonationReceived(address donator, uint amount); 

  /// @notice Emitted when a project has been added by owner
  /// @param projectId Id of the added project
  event ProjectCurated(uint projectId);

  /// @notice Emitted when a donator has voted
  /// @param donator Adress of the donator who voted
  /// @param votedProjectId Id of the project he/she voted for
  event Voted (address donator, uint votedProjectId);

  /// @notice Emitted when funds are sent to an elected project 
  /// @param amount Adress of the donator who voted
  /// @param projectId Id of the project he/she voted for
  event FundsGranted(uint amount, uint projectId);

  /// @notice Emitted when the owner attested of the  propoer usage of funds by a project
  /// @param projectId Id of the project
  /// @param comment Comment written by owner expliciting how funds have been used
  event ProperFundsUsageCertified(uint projectId, string comment);

// *********************************** CONSTRUCTOR ***********************************  

  /// @notice Starts the Ownable pattern
  constructor() Ownable(msg.sender) {    }

// *********************************** MODIFIER ***********************************  

  /// @notice Checks if the message sender is a Donator
  modifier onlyDonators() {
    require(donators[msg.sender].totalDonated > 0, "Not donator");
    _;
  }

 // *********************************** GETTERS ***********************************  

  /** 
  * @notice Get a donator based on an address.
  * @param _addr The address to look for
  * @return donator  The donator corresponding to the given address
  */
  function getDonator(address _addr) external view returns (Donator memory donator) {
    donator = donators[_addr];
  }

  /** 
  * @notice Get a project based on an id.
  * @param _id The id to look for
  * @return project  The project corresponding to the given id
  */
  function getProject(uint _id) external view returns (Project memory project) {
    project =  projects[_id];
  }

  /** 
  * @notice Get all projects.
  * @return projects An array of all the projects
  */
  function getProjects() external view returns(Project[] memory) {
    return projects;
  }

  /** 
  * @notice Get contract's balance.
  * @return uint The contract's balance
  */
  function getContractBalance() external view returns(uint) {
    return address(this).balance;
  }


//  *********************************** FUNDS ************************************  


  /** 
  * @notice Make a donation in ETH
  * Will trigger an error if msg.value is 0.
  */
  function donate() external payable {
    require(msg.value > 0, "Not enough funds deposited");
    donators[msg.sender].totalDonated += msg.value;
    emit DonationReceived(msg.sender, msg.value); 
  }

  /** 
  * @notice Split and send funds to elected projects, proportionnally to their vote count. 
  * Only the owner can call this method. 
  * Will trigger an error if Voting phase is not ended or if contract's balance is 0.
  * @dev A manual guard prevents from reentrancy attack.
  */
  function sendFunds() external onlyOwner nonReentrant {
    require(phase >= Phase.VotesEnded, "Votes not ended");
    require(address(this).balance > 0, "Empty balance");
    uint balance = address(this).balance;

    for(uint i;i < projects.length;i++){
      if (projects[i].voteCount > 0) {
        uint amount = (balance * projects[i].voteCount) / totalVotes;
        projects[i].fundsReceived = amount;
        (bool received, ) = projects[i].projAddress.call{value: amount}("");
        require(received, "Payment failed");
        emit FundsGranted(amount, i);
      }
    }
    phase = Phase.FundsSent;
    emit NewPhase(phase);  
  }

  /** 
  * @notice Attest how funds have been used.
  * Only the owner can call this method. 
  * Will trigger an error if Project did not receive funds.
  * @param _id Id of the project.
  * @param _comment Description of how the funds have been used.
  */
  function certifyFundsUsage(uint _id, string calldata _comment) external onlyOwner {
    require(projects[_id].fundsReceived > 0, "No funds received");
    projects[_id].usageCertified = true;
    emit ProperFundsUsageCertified(_id, _comment);
  }

// *********************************** PROJECTS ***********************************  


  /** 
  * @notice Add a project.
  * Only the owner can call this method. 
  * Will trigger an error if any arg is missing or if project curation phase is over.
  * @param _name Name of the project.
  * @param _desc Description of how project's need.
  * @param _projAddress Address where to send the funds if project is elected.
  */
  function addCuratedProject(string calldata _name, string calldata _desc, address _projAddress) external onlyOwner {
    require(phase == Phase.ProjectsCuration, "Project curation is over");
    require(bytes(_name).length > 0, "No name");
    require(bytes(_desc).length > 0, "No description");
    require(_projAddress != address(0), "No address");

    projects.push(Project(_name, _desc, _projAddress, 0, 0, false));
    emit ProjectCurated(projects.length -1);
  }


// *********************************** VOTES ***********************************  

  /** 
  * @notice Start voting phase.
  * Only the owner can call this method. 
  * Will trigger an error if no projects have been added yet or if project curation phase is over.
  */
  function startVotes() external onlyOwner {
    require(phase == Phase.ProjectsCuration, "Cannot start votes now");
    require(0 < projects.length, "No projects to vote for");
    phase = Phase.VotesStarted;
    emit NewPhase(phase);
  }

  /** 
  * @notice Vote for a project.
  * Only a donator can call this method. 
  * Will trigger an error if not the right phase, if donator already voted or if given project id is unknown.
  * @param _id Id of the project to vote for.
  */
  function submitVote(uint _id) external onlyDonators {
    require(phase == Phase.VotesStarted, "Cannot vote now");
    require(donators[msg.sender].hasVoted != true, "You already voted");
    require(_id < projects.length, "Unknown project"); 

    donators[msg.sender].votedProjectId = _id;
    donators[msg.sender].hasVoted = true;
    projects[_id].voteCount++;
    totalVotes++;

    emit Voted(msg.sender, _id);
  }

  /** 
  * @notice End voting phase.
  * Only the owner can call this method. 
  * Will trigger an error if votes did not start or if nobody voted yet.
  */
  function endVotes() external onlyOwner {
    require(phase == Phase.VotesStarted, "Cannot end votes now");
    require(totalVotes > 0, "No votes submitted yet");
    phase = Phase.VotesEnded;
    emit NewPhase(phase);
  }
}
```

## Tests: fauna.test.js

```javascript
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { assert, expect } = require("chai");
const { ethers } = require("hardhat");

async function deployFauna() {
  [owner, addr1, addr2] = await ethers.getSigners();
  const contract = await ethers.getContractFactory("Fauna");
  fauna = await contract.deploy();

  return { fauna, owner, addr1, addr2 };
}

describe("Fauna Tests", function () {
  describe("Deployment", function () {
    it("should deploy the smart contract with right owner", async function () {
      let { fauna, owner } = await loadFixture(deployFauna);

      expect(await fauna.owner()).to.equal(owner.address);
    });
  });

  describe("Only Donators", function () {
    it("should prevent a non-donator from interacting", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();

      await expect(fauna.connect(addr1).submitVote(0)).to.be.revertedWith(
        "Not donator"
      );
    });
  });

  // GETTERS

  describe("getDonator", function () {
    it("should allow anyone to see a donator", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });

      await expect(fauna.connect(addr1).getDonator(addr2.address)).to.not.be
        .reverted;
    });
  });

  describe("getProject", function () {
    it("should allow any address to see a project", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      const project = await fauna.getProject(0);

      assert.equal(project.name, "name1");
    });
  });

  describe("getProjects", function () {
    it("should allow any address to see all projects", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.addCuratedProject("name2", "desc2", addr2.address);
      const projects = await fauna.getProjects();

      assert.equal(projects.length, 2);
    });
  });

  describe("getContractBalance", function () {
    it("should allow any address to see balance of the smart contract", async function () {
      let { fauna } = await loadFixture(deployFauna);
      await fauna.donate({ value: ethers.parseEther("1") });

      const balance1 = await fauna.getContractBalance();
      const balance2 = await ethers.provider.getBalance(fauna.target);

      assert.equal(balance1, balance2);
    });
  });

  // FUNDS

  describe("donate", function () {
    it("should revert if no funds deposited", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(
        fauna.connect(addr1).donate({ value: ethers.parseEther("0") })
      ).to.be.revertedWith("Not enough funds deposited");
    });

    it("should create donator if new and update totalDonated for donator", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await fauna.connect(addr1).donate({ value: ethers.parseEther("1") });
      const donator = await fauna.connect(addr1).getDonator(addr1.address);

      assert.equal(donator.totalDonated, ethers.parseEther("1"));
    });

    it("should emit an event", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(
        fauna.connect(addr1).donate({ value: ethers.parseEther("1") })
      )
        .to.emit(fauna, "DonationReceived")
        .withArgs(addr1.address, ethers.parseEther("1"));
    });
  });

  describe("sendFunds", function () {
    it("should revert if sender is not the Owner", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(fauna.connect(addr1).sendFunds())
        .to.be.revertedWithCustomError(fauna, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("should revert if votes have not ended", async function () {
      let { fauna } = await loadFixture(deployFauna);

      await expect(fauna.sendFunds()).to.be.revertedWith("Votes not ended");
    });

    it("should revert if Fauna's balance is empty", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();
      await fauna.sendFunds();

      await expect(fauna.sendFunds()).to.be.revertedWith("Empty balance");
    });

    it("should update fundsReceived value", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();
      await fauna.sendFunds();

      const project = await fauna.getProject(0);

      assert.equal(project.fundsReceived, ethers.parseEther("1"));
    });

    it("should not update fundsReceived value if projects has no votes", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.addCuratedProject("name2", "desc2", addr2.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();
      await fauna.sendFunds();

      const project = await fauna.getProject(1);

      assert.equal(project.fundsReceived, 0);
    });

    it("should emit an event for payment", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();

      await expect(fauna.sendFunds())
        .to.emit(fauna, "FundsGranted")
        .withArgs(ethers.parseEther("1"), 0);
    });

    it("should emit an event for phase change", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();

      await expect(fauna.sendFunds()).to.emit(fauna, "NewPhase").withArgs(3);
    });
  });

  describe("certifyFundsUsage", function () {
    it("should revert if sender is not the Owner", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(fauna.connect(addr1).certifyFundsUsage(1, "comment1"))
        .to.be.revertedWithCustomError(fauna, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("should set usageCertified to true", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();
      await fauna.sendFunds();
      await fauna.certifyFundsUsage(0, "ok");

      const project = await fauna.getProject(0);

      assert.equal(project.usageCertified, true);
    });

    it("should emit an event", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();
      await fauna.sendFunds();

      await expect(fauna.certifyFundsUsage(0, "ok"))
        .to.emit(fauna, "ProperFundsUsageCertified")
        .withArgs(0, "ok");
    });
  });

  // Projects

  describe("addCuratedProject", function () {
    it("should revert if sender is not the owner", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(
        fauna.connect(addr1).addCuratedProject("name1", "desc1", addr1.address)
      )
        .to.be.revertedWithCustomError(fauna, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("should revert if not the right time to add a curated project", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.startVotes();

      await expect(
        fauna.addCuratedProject("name2", "desc2", addr1.address)
      ).to.be.revertedWith("Project curation is over");
    });

    it("should revert if no project name is given", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(
        fauna.addCuratedProject("", "desc1", addr1.address)
      ).to.be.revertedWith("No name");
    });

    it("should revert if no project description is given", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(
        fauna.addCuratedProject("name1", "", addr1.address)
      ).to.be.revertedWith("No description");
    });

    it("should revert if no project address is given", async function () {
      let { fauna } = await loadFixture(deployFauna);

      await expect(
        fauna.addCuratedProject(
          "name1",
          "desc1",
          "0x0000000000000000000000000000000000000000"
        )
      ).to.be.revertedWith("No address");
    });

    it("should be able to add a project", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      const project = await fauna.getProject(0);

      assert.equal(project.name, "name1");
    });

    it("should emit an event", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(fauna.addCuratedProject("name1", "desc1", addr1.address))
        .to.emit(fauna, "ProjectCurated")
        .withArgs(0);
    });
  });

  // VOTES

  describe("startVotes", function () {
    it("should revert if sender is not the owner", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(fauna.connect(addr1).startVotes())
        .to.be.revertedWithCustomError(fauna, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("should revert if not the right time to start votes", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.startVotes();

      await expect(fauna.startVotes()).to.be.revertedWith(
        "Cannot start votes now"
      );
    });

    it("should revert if no projects have been curated", async function () {
      let { fauna } = await loadFixture(deployFauna);

      await expect(fauna.startVotes()).to.be.revertedWith(
        "No projects to vote for"
      );
    });

    it("should go to phase 1", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.startVotes();

      const phase = await fauna.phase();

      assert.equal(phase, 1);
    });

    it("should emit an event", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);

      await expect(fauna.startVotes()).to.emit(fauna, "NewPhase").withArgs(1);
    });
  });

  describe("submitVote", function () {
    it("should prevent a non-donator from voting", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.startVotes();

      await expect(fauna.connect(addr2).submitVote(0)).to.be.revertedWith(
        "Not donator"
      );
    });

    it("should revert if not the right time to vote", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });

      await expect(fauna.connect(addr2).submitVote(0)).to.be.revertedWith(
        "Cannot vote now"
      );
    });

    it("should revert if voter has already voted", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);

      await expect(fauna.connect(addr2).submitVote(0)).to.be.revertedWith(
        "You already voted"
      );
    });

    it("should revert if project doesn't exist", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();

      await expect(fauna.connect(addr2).submitVote(1)).to.be.revertedWith(
        "Unknown project"
      );
    });

    it("should take into account the vote on the voter's side", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.addCuratedProject("name2", "desc2", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(1);

      const donator = await fauna.connect(addr2).getDonator(addr2.address);

      assert.equal(donator.votedProjectId, 1);
      assert.equal(donator.hasVoted, true);
    });

    it("should take into account the vote on the project's side", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      const project = await fauna.getProject(0);
      const initialVoteCount = project.voteCount;

      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);

      const proj = await fauna.getProject(0);
      const newVoteCount = proj.voteCount;

      assert.equal(newVoteCount, initialVoteCount + BigInt(1));
    });

    it("should increment totalVotes", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);

      const totalVotes = await fauna.totalVotes();

      assert.equal(totalVotes, 1);
    });

    it("should emit an event", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();

      await expect(fauna.connect(addr2).submitVote(0))
        .to.emit(fauna, "Voted")
        .withArgs(addr2.address, 0);
    });
  });

  describe("endVotes", function () {
    it("should revert if sender is not the owner", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(fauna.connect(addr1).endVotes())
        .to.be.revertedWithCustomError(fauna, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("should revert if not the right time to end votes", async function () {
      let { fauna } = await loadFixture(deployFauna);

      await expect(fauna.endVotes()).to.be.revertedWith("Cannot end votes now");
    });

    it("should revert if no votes have been submitted", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.startVotes();

      await expect(fauna.endVotes()).to.be.revertedWith(
        "No votes submitted yet"
      );
    });

    it("should go to phase 2", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();

      const phase = await fauna.phase();

      assert.equal(phase, 2);
    });

    it("should emit an event", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);

      await expect(fauna.endVotes()).to.emit(fauna, "NewPhase").withArgs(2);
    });
  });
});
```
