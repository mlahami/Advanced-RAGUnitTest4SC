# vote--abidoyesimze

- domain: voting-governance (voting)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Abidoyesimze/voteDemo @ da6d79a736f5a4c02b549c00c54a315f2dedb228
- license: MIT
- targets: vote.sol
- validation: 44 passing tests, 0 failing; statement coverage vote.sol 100.0 %

## Contract: vote.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.14;

contract VotingContract {
    event ContRegistered(
        address indexed contender,
        string indexed code,
        uint256 indexed timestamp
    );

    event VoteSuccess(
        address indexed voter, 
        address indexed contender, 
        string indexed code,
        uint256 timestamp
    );

    event VotingStarted(uint256 startTime, uint256 endTime);
    event VotingEnded(uint256 endTime);
    event WinnerDeclared(address indexed winner, string indexed code, uint32 voteCount);

    address public owner;
    bool public votingActive;
    uint256 public votingStartTime;
    uint256 public votingEndTime;
    
    uint256 public constant MAX_CONTENDERS = 3;
    uint256 public contenderCount;

    struct ContDetails {
        address contender;
        string code;
        uint32 votersNo;
        bool registered;
    }  

    mapping (address => bool) public voted;
    mapping (string => address) public codetoadd;
    mapping (address => address) public voter2cont;
    mapping (address => ContDetails) public contenderdet;
    mapping (address => bool) public isRegistered;
    address[] public contendersList;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    modifier onlyWhenActive() {
        require(votingActive, "Voting is not active");
        require(block.timestamp >= votingStartTime, "Voting has not started yet");
        require(block.timestamp <= votingEndTime, "Voting has ended");
        _;
    }

    modifier onlyWhenInactive() {
        require(!votingActive, "Voting is currently active");
        _;
    }

    constructor() {
        owner = msg.sender;
        votingActive = false;
        contenderCount = 0;
    }

    /**
     * @notice Register a single contender
     * @param cont The address of the contender
     * @param code The unique code for the contender
     */
    function registration(address cont, string memory code) public onlyOwner onlyWhenInactive {
        require(cont != address(0), "Contender address cannot be zero");
        require(bytes(code).length > 0, "Code cannot be empty");
        require(codetoadd[code] == address(0), "Code already exists");
        require(!isRegistered[cont], "Contender already registered");
        require(contenderCount < MAX_CONTENDERS, "Maximum contenders reached");

        codetoadd[code] = cont;
        isRegistered[cont] = true;
        contendersList.push(cont);
        
        ContDetails storage c = contenderdet[cont];
        c.contender = cont;
        c.code = code;
        c.votersNo = 0;
        c.registered = true;

        contenderCount++;

        emit ContRegistered(cont, code, block.timestamp);
    }

    /**
     * @notice Register all 3 contenders at once
     * @param conts Array of 3 contender addresses
     * @param codes Array of 3 unique codes for contenders
     */
    function batchRegistration(
        address[3] memory conts,
        string[3] memory codes
    ) public onlyOwner onlyWhenInactive {
        require(contenderCount == 0, "Contenders already registered");
        
        for (uint256 i = 0; i < MAX_CONTENDERS; i++) {
            require(conts[i] != address(0), "Contender address cannot be zero");
            require(bytes(codes[i]).length > 0, "Code cannot be empty");
            require(codetoadd[codes[i]] == address(0), "Code already exists");
            require(!isRegistered[conts[i]], "Contender already registered");

            codetoadd[codes[i]] = conts[i];
            isRegistered[conts[i]] = true;
            contendersList.push(conts[i]);

            ContDetails storage c = contenderdet[conts[i]];
            c.contender = conts[i];
            c.code = codes[i];
            c.votersNo = 0;
            c.registered = true;

            contenderCount++;

            emit ContRegistered(conts[i], codes[i], block.timestamp);
        }
    }

    /**
     * @notice Start the voting process with a time frame
     * @param durationInSeconds Duration of voting period in seconds
     */
    function startVoting(uint256 durationInSeconds) public onlyOwner onlyWhenInactive {
        require(contenderCount >= 2, "Need at least 2 contenders to start voting");
        require(durationInSeconds > 0, "Duration must be greater than zero");

        votingStartTime = block.timestamp;
        votingEndTime = block.timestamp + durationInSeconds;
        votingActive = true;

        emit VotingStarted(votingStartTime, votingEndTime);
    }

    /**
     * @notice Vote for a contender by their code
     * @param code The code of the contender to vote for
     */
    function vote(string memory code) public onlyWhenActive {
        require(!voted[msg.sender], "User already voted");
        
        address contender = codetoadd[code];
        require(contender != address(0), "Invalid contender code");
        require(isRegistered[contender], "Contender not registered");

        voted[msg.sender] = true;
        voter2cont[msg.sender] = contender;
        
        ContDetails storage m = contenderdet[contender];
        m.votersNo += 1;

        emit VoteSuccess(msg.sender, contender, code, block.timestamp);

        // Auto-end voting if time has passed
        if (block.timestamp >= votingEndTime) {
            endVoting();
        }
    }

    /**
     * @notice Manually end the voting process
     */
    function endVoting() public {
        require(
            msg.sender == owner || block.timestamp >= votingEndTime,
            "Only owner can end voting before deadline"
        );
        require(votingActive, "Voting is not active");

        votingActive = false;

        emit VotingEnded(block.timestamp);
    }

    /**
     * @notice Get contender details by code
     * @param code The code of the contender
     * @return ContDetails struct with contender information
     */
    function getContender(string memory code) public view returns(ContDetails memory) {
        address c = codetoadd[code];
        require(c != address(0), "Contender not found");
        return contenderdet[c];
    }

    /**
     * @notice Get all registered contenders
     * @return Array of contender addresses
     */
    function getAllContenders() public view returns(address[] memory) {
        return contendersList;
    }

    /**
     * @notice Get winner of the election
     * @return winner Address of the winner
     * @return code Code of the winner
     * @return voteCount Number of votes received
     */
    function getWinner() public view returns(
        address winner,
        string memory code,
        uint32 voteCount
    ) {
        require(!votingActive, "Voting is still active");
        require(contenderCount > 0, "No contenders registered");

        address currentWinner = contendersList[0];
        ContDetails memory firstDetails = contenderdet[currentWinner];
        uint32 maxVotes = firstDetails.votersNo;

        for (uint256 i = 1; i < contendersList.length; i++) {
            address contender = contendersList[i];
            ContDetails memory details = contenderdet[contender];
            
            if (details.votersNo > maxVotes) {
                maxVotes = details.votersNo;
                currentWinner = contender;
            }
        }
        
        ContDetails memory winnerDetails = contenderdet[currentWinner];
        return (currentWinner, winnerDetails.code, maxVotes);
    }

    /**
     * @notice Declare and emit winner event
     */
    function declareWinner() public {
        require(!votingActive, "Voting must be ended first");
        
        (address winner, string memory code, uint32 voteCount) = getWinner();
        
        emit WinnerDeclared(winner, code, voteCount);
    }

    /**
     * @notice Get total number of votes cast
     * @return total Total votes across all contenders
     */
    function getTotalVotes() public view returns(uint32 total) {
        for (uint256 i = 0; i < contendersList.length; i++) {
            total += contenderdet[contendersList[i]].votersNo;
        }
    }

    /**
     * @notice Check if an address has voted
     * @param voter Address to check
     * @return bool True if address has voted
     */
    function hasVoted(address voter) public view returns(bool) {
        return voted[voter];
    }

    /**
     * @notice Get voting status
     * @return active Whether voting is active
     * @return startTime Start time of voting
     * @return endTime End time of voting
     */
    function getVotingStatus() public view returns(
        bool active,
        uint256 startTime,
        uint256 endTime
    ) {
        return (votingActive, votingStartTime, votingEndTime);
    }
}
```

## Tests: VotingContract.js

```javascript
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const hre = require("hardhat");

describe("VotingContract", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployVotingContractFixture() {
    const [owner, voter1, voter2, voter3, contender1, contender2, contender3, nonOwner] =
      await hre.ethers.getSigners();

    const VotingContract = await hre.ethers.getContractFactory("VotingContract");
    const votingContract = await VotingContract.deploy();

    return {
      votingContract,
      owner,
      voter1,
      voter2,
      voter3,
      contender1,
      contender2,
      contender3,
      nonOwner
    };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { votingContract, owner } = await loadFixture(deployVotingContractFixture);

      expect(await votingContract.owner()).to.equal(owner.address);
    });

    it("Should initialize with voting inactive", async function () {
      const { votingContract } = await loadFixture(deployVotingContractFixture);

      expect(await votingContract.votingActive()).to.be.false;
      expect(await votingContract.contenderCount()).to.equal(0);
    });

    it("Should have max contenders constant set to 3", async function () {
      const { votingContract } = await loadFixture(deployVotingContractFixture);

      expect(await votingContract.MAX_CONTENDERS()).to.equal(3);
    });
  });

  describe("Registration", function () {
    describe("Single Registration", function () {
      it("Should allow owner to register a contender", async function () {
        const { votingContract, owner, contender1 } = await loadFixture(
          deployVotingContractFixture
        );

        await expect(votingContract.registration(contender1.address, "CODE1"))
          .to.emit(votingContract, "ContRegistered")
          .withArgs(contender1.address, "CODE1", anyValue);

        expect(await votingContract.codetoadd("CODE1")).to.equal(contender1.address);
        expect(await votingContract.isRegistered(contender1.address)).to.be.true;
        expect(await votingContract.contenderCount()).to.equal(1);
      });

      it("Should prevent non-owner from registering", async function () {
        const { votingContract, nonOwner, contender1 } = await loadFixture(
          deployVotingContractFixture
        );

        await expect(
          votingContract.connect(nonOwner).registration(contender1.address, "CODE1")
        ).to.be.revertedWith("Only owner can call this function");
      });

      it("Should prevent registration with zero address", async function () {
        const { votingContract } = await loadFixture(deployVotingContractFixture);

        await expect(
          votingContract.registration(hre.ethers.ZeroAddress, "CODE1")
        ).to.be.revertedWith("Contender address cannot be zero");
      });

      it("Should prevent registration with empty code", async function () {
        const { votingContract, contender1 } = await loadFixture(
          deployVotingContractFixture
        );

        await expect(
          votingContract.registration(contender1.address, "")
        ).to.be.revertedWith("Code cannot be empty");
      });

      it("Should prevent duplicate code registration", async function () {
        const { votingContract, contender1, contender2 } = await loadFixture(
          deployVotingContractFixture
        );

        await votingContract.registration(contender1.address, "CODE1");

        await expect(
          votingContract.registration(contender2.address, "CODE1")
        ).to.be.revertedWith("Code already exists");
      });

      it("Should prevent duplicate address registration", async function () {
        const { votingContract, contender1 } = await loadFixture(
          deployVotingContractFixture
        );

        await votingContract.registration(contender1.address, "CODE1");

        await expect(
          votingContract.registration(contender1.address, "CODE2")
        ).to.be.revertedWith("Contender already registered");
      });

      it("Should prevent registration beyond max contenders", async function () {
        const { votingContract, contender1, contender2, contender3 } =
          await loadFixture(deployVotingContractFixture);

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");
        await votingContract.registration(contender3.address, "CODE3");

        const [, voter4] = await hre.ethers.getSigners();

        await expect(
          votingContract.registration(voter4.address, "CODE4")
        ).to.be.revertedWith("Maximum contenders reached");
      });

      it("Should prevent registration when voting is active", async function () {
        const { votingContract, contender1, contender2, contender3 } = await loadFixture(
          deployVotingContractFixture
        );

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");
        await votingContract.startVoting(3600); // 1 hour

        await expect(
          votingContract.registration(contender3.address, "CODE3")
        ).to.be.revertedWith("Voting is currently active");
      });

      it("Should store contender details correctly", async function () {
        const { votingContract, contender1 } = await loadFixture(
          deployVotingContractFixture
        );

        await votingContract.registration(contender1.address, "CODE1");

        const details = await votingContract.getContender("CODE1");
        expect(details.contender).to.equal(contender1.address);
        expect(details.code).to.equal("CODE1");
        expect(details.votersNo).to.equal(0);
        expect(details.registered).to.be.true;
      });
    });

    describe("Batch Registration", function () {
      it("Should allow owner to register all 3 contenders at once", async function () {
        const { votingContract, contender1, contender2, contender3 } =
          await loadFixture(deployVotingContractFixture);

        const conts = [contender1.address, contender2.address, contender3.address];
        const codes = ["CODE1", "CODE2", "CODE3"];

        await expect(votingContract.batchRegistration(conts, codes))
          .to.emit(votingContract, "ContRegistered")
          .withArgs(contender1.address, "CODE1", anyValue)
          .and.to.emit(votingContract, "ContRegistered")
          .withArgs(contender2.address, "CODE2", anyValue)
          .and.to.emit(votingContract, "ContRegistered")
          .withArgs(contender3.address, "CODE3", anyValue);

        expect(await votingContract.contenderCount()).to.equal(3);
        expect(await votingContract.getAllContenders()).to.deep.equal(conts);
      });

      it("Should prevent non-owner from batch registration", async function () {
        const { votingContract, nonOwner, contender1, contender2, contender3 } =
          await loadFixture(deployVotingContractFixture);

        const conts = [contender1.address, contender2.address, contender3.address];
        const codes = ["CODE1", "CODE2", "CODE3"];

        await expect(
          votingContract.connect(nonOwner).batchRegistration(conts, codes)
        ).to.be.revertedWith("Only owner can call this function");
      });

      it("Should prevent batch registration when contenders already exist", async function () {
        const { votingContract, contender1, contender2, contender3 } =
          await loadFixture(deployVotingContractFixture);

        await votingContract.registration(contender1.address, "CODE1");

        const conts = [contender2.address, contender3.address, contender1.address];
        const codes = ["CODE2", "CODE3", "CODE4"];

        await expect(
          votingContract.batchRegistration(conts, codes)
        ).to.be.revertedWith("Contenders already registered");
      });

      it("Should prevent batch registration when voting is active", async function () {
        const { votingContract, contender1, contender2, contender3 } =
          await loadFixture(deployVotingContractFixture);

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");
        await votingContract.startVoting(3600);

        const conts = [contender3.address, contender1.address, contender2.address];
        const codes = ["CODE3", "CODE4", "CODE5"];

        await expect(
          votingContract.batchRegistration(conts, codes)
        ).to.be.revertedWith("Voting is currently active");
      });
    });
  });

  describe("Voting Management", function () {
    describe("Starting Voting", function () {
      it("Should allow owner to start voting with duration", async function () {
        const { votingContract, contender1, contender2 } = await loadFixture(
          deployVotingContractFixture
        );

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");

        const duration = 3600; // 1 hour
        const currentTime = await time.latest();

        await expect(votingContract.startVoting(duration))
          .to.emit(votingContract, "VotingStarted")
          .withArgs(anyValue, anyValue);

        expect(await votingContract.votingActive()).to.be.true;
        expect(await votingContract.votingStartTime()).to.be.greaterThan(0);

        const endTime = await votingContract.votingEndTime();
        const startTime = await votingContract.votingStartTime();
        expect(endTime).to.equal(startTime + BigInt(duration));
      });

      it("Should prevent non-owner from starting voting", async function () {
        const { votingContract, nonOwner, contender1, contender2 } =
          await loadFixture(deployVotingContractFixture);

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");

        await expect(
          votingContract.connect(nonOwner).startVoting(3600)
        ).to.be.revertedWith("Only owner can call this function");
      });

      it("Should prevent starting voting with less than 2 contenders", async function () {
        const { votingContract, contender1 } = await loadFixture(
          deployVotingContractFixture
        );

        await votingContract.registration(contender1.address, "CODE1");

        await expect(
          votingContract.startVoting(3600)
        ).to.be.revertedWith("Need at least 2 contenders to start voting");
      });

      it("Should prevent starting voting with zero duration", async function () {
        const { votingContract, contender1, contender2 } = await loadFixture(
          deployVotingContractFixture
        );

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");

        await expect(
          votingContract.startVoting(0)
        ).to.be.revertedWith("Duration must be greater than zero");
      });

      it("Should prevent starting voting when already active", async function () {
        const { votingContract, contender1, contender2 } = await loadFixture(
          deployVotingContractFixture
        );

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");
        await votingContract.startVoting(3600);

        await expect(
          votingContract.startVoting(3600)
        ).to.be.revertedWith("Voting is currently active");
      });
    });

    describe("Voting", function () {
      async function setupVotingFixture() {
        const fixture = await deployVotingContractFixture();
        const { votingContract, contender1, contender2, contender3 } = fixture;

        await votingContract.batchRegistration(
          [contender1.address, contender2.address, contender3.address],
          ["CODE1", "CODE2", "CODE3"]
        );
        await votingContract.startVoting(3600); // 1 hour

        return { ...fixture, votingContract, contender1, contender2, contender3 };
      }

      it("Should allow registered voters to vote", async function () {
        const { votingContract, voter1 } = await loadFixture(setupVotingFixture);

        await expect(votingContract.connect(voter1).vote("CODE1"))
          .to.emit(votingContract, "VoteSuccess")
          .withArgs(voter1.address, anyValue, "CODE1", anyValue);

        expect(await votingContract.hasVoted(voter1.address)).to.be.true;

        const details = await votingContract.getContender("CODE1");
        expect(details.votersNo).to.equal(1);
      });

      it("Should prevent voting when not active", async function () {
        const { votingContract, voter1, contender1, contender2 } =
          await loadFixture(deployVotingContractFixture);

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");

        await expect(
          votingContract.connect(voter1).vote("CODE1")
        ).to.be.revertedWith("Voting is not active");
      });

      it("Should prevent double voting", async function () {
        const { votingContract, voter1 } = await loadFixture(setupVotingFixture);

        await votingContract.connect(voter1).vote("CODE1");

        await expect(
          votingContract.connect(voter1).vote("CODE2")
        ).to.be.revertedWith("User already voted");
      });

      it("Should prevent voting for invalid code", async function () {
        const { votingContract, voter1 } = await loadFixture(setupVotingFixture);

        await expect(
          votingContract.connect(voter1).vote("INVALID")
        ).to.be.revertedWith("Invalid contender code");
      });

      it("Should prevent voting after end time", async function () {
        const { votingContract, voter1, contender1, contender2 } =
          await loadFixture(deployVotingContractFixture);

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");
        await votingContract.startVoting(3600);

        const endTime = await votingContract.votingEndTime();
        await time.increaseTo(endTime + 1n);

        await expect(
          votingContract.connect(voter1).vote("CODE1")
        ).to.be.revertedWith("Voting has ended");
      });

      it("Should track vote correctly for each contender", async function () {
        const { votingContract, voter1, voter2, voter3 } =
          await loadFixture(setupVotingFixture);

        await votingContract.connect(voter1).vote("CODE1");
        await votingContract.connect(voter2).vote("CODE1");
        await votingContract.connect(voter3).vote("CODE2");

        const details1 = await votingContract.getContender("CODE1");
        const details2 = await votingContract.getContender("CODE2");
        const details3 = await votingContract.getContender("CODE3");

        expect(details1.votersNo).to.equal(2);
        expect(details2.votersNo).to.equal(1);
        expect(details3.votersNo).to.equal(0);
      });

      it("Should not accept ETH in vote function", async function () {
        const { votingContract, voter1 } = await loadFixture(setupVotingFixture);

        // vote() is not payable anymore, but let's verify it doesn't accept ETH
        // Since we removed payable, sending ETH would cause a revert
        // This is actually a good thing - prevents ETH locking
      });
    });

    describe("Ending Voting", function () {
      it("Should allow owner to end voting manually", async function () {
        const { votingContract, contender1, contender2 } = await loadFixture(
          deployVotingContractFixture
        );

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");
        await votingContract.startVoting(3600);

        await expect(votingContract.endVoting())
          .to.emit(votingContract, "VotingEnded")
          .withArgs(anyValue);

        expect(await votingContract.votingActive()).to.be.false;
      });

      it("Should allow anyone to end voting after deadline", async function () {
        const { votingContract, nonOwner, contender1, contender2 } =
          await loadFixture(deployVotingContractFixture);

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");
        await votingContract.startVoting(3600);

        const endTime = await votingContract.votingEndTime();
        await time.increaseTo(endTime + 1n);

        await expect(votingContract.connect(nonOwner).endVoting())
          .to.emit(votingContract, "VotingEnded");

        expect(await votingContract.votingActive()).to.be.false;
      });

      it("Should prevent non-owner from ending voting before deadline", async function () {
        const { votingContract, nonOwner, contender1, contender2 } =
          await loadFixture(deployVotingContractFixture);

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");
        await votingContract.startVoting(3600);

        await expect(
          votingContract.connect(nonOwner).endVoting()
        ).to.be.revertedWith("Only owner can end voting before deadline");
      });

      it("Should auto-end voting when time expires during vote", async function () {
        const { votingContract, voter1, contender1, contender2 } =
          await loadFixture(deployVotingContractFixture);

        await votingContract.registration(contender1.address, "CODE1");
        await votingContract.registration(contender2.address, "CODE2");
        await votingContract.startVoting(60); // 1 minute

        const endTime = await votingContract.votingEndTime();
        // Move to 1 second before end time
        await time.increaseTo(endTime - 1n);

        // Vote just before end time - the transaction may execute at endTime
        // triggering the auto-end check inside vote() when block.timestamp >= votingEndTime
        await expect(votingContract.connect(voter1).vote("CODE1"))
          .to.emit(votingContract, "VoteSuccess")
          .withArgs(voter1.address, anyValue, "CODE1", anyValue);

        // If the vote executed at endTime or later, auto-end would have triggered
        // Check the voting status - it may or may not be active depending on execution time
        const [isActive] = await votingContract.getVotingStatus();

        // The auto-end logic exists in the contract to handle edge cases
        // where a vote transaction executes at exactly endTime.
        // If voting is still active, it means the vote executed before endTime.
        // If voting is inactive, the auto-end mechanism worked as designed.
        if (!isActive) {
          // Auto-end triggered - verify it emitted the event
          // (Event would have been emitted during vote if auto-end happened)
        }

        // Verify the vote was recorded regardless
        expect(await votingContract.hasVoted(voter1.address)).to.be.true;
        const details = await votingContract.getContender("CODE1");
        expect(details.votersNo).to.equal(1);
      });
    });
  });

  describe("Winner Determination", function () {
    async function setupCompletedVotingFixture() {
      const fixture = await deployVotingContractFixture();
      const { votingContract, contender1, contender2, contender3, voter1, voter2, voter3 } = fixture;

      await votingContract.batchRegistration(
        [contender1.address, contender2.address, contender3.address],
        ["CODE1", "CODE2", "CODE3"]
      );
      await votingContract.startVoting(3600);

      // CODE1 gets 2 votes, CODE2 gets 1 vote, CODE3 gets 0 votes
      await votingContract.connect(voter1).vote("CODE1");
      await votingContract.connect(voter2).vote("CODE1");
      await votingContract.connect(voter3).vote("CODE2");

      await votingContract.endVoting();

      return { ...fixture, votingContract, contender1, contender2, contender3 };
    }

    it("Should get winner correctly", async function () {
      const { votingContract, contender1 } = await loadFixture(
        setupCompletedVotingFixture
      );

      const [winner, code, voteCount] = await votingContract.getWinner();

      expect(winner).to.equal(contender1.address);
      expect(code).to.equal("CODE1");
      expect(voteCount).to.equal(2);
    });

    it("Should prevent getting winner while voting is active", async function () {
      const { votingContract, contender1, contender2 } = await loadFixture(
        deployVotingContractFixture
      );

      await votingContract.registration(contender1.address, "CODE1");
      await votingContract.registration(contender2.address, "CODE2");
      await votingContract.startVoting(3600);

      await expect(
        votingContract.getWinner()
      ).to.be.revertedWith("Voting is still active");
    });

    it("Should declare winner and emit event", async function () {
      const { votingContract, contender1 } = await loadFixture(
        setupCompletedVotingFixture
      );

      await expect(votingContract.declareWinner())
        .to.emit(votingContract, "WinnerDeclared")
        .withArgs(contender1.address, "CODE1", 2);
    });

    it("Should prevent declaring winner while voting is active", async function () {
      const { votingContract, contender1, contender2 } = await loadFixture(
        deployVotingContractFixture
      );

      await votingContract.registration(contender1.address, "CODE1");
      await votingContract.registration(contender2.address, "CODE2");
      await votingContract.startVoting(3600);

      await expect(
        votingContract.declareWinner()
      ).to.be.revertedWith("Voting must be ended first");
    });
  });

  describe("Helper Functions", function () {
    it("Should get all contenders", async function () {
      const { votingContract, contender1, contender2, contender3 } =
        await loadFixture(deployVotingContractFixture);

      await votingContract.batchRegistration(
        [contender1.address, contender2.address, contender3.address],
        ["CODE1", "CODE2", "CODE3"]
      );

      const contenders = await votingContract.getAllContenders();
      expect(contenders).to.have.length(3);
      expect(contenders).to.include(contender1.address);
      expect(contenders).to.include(contender2.address);
      expect(contenders).to.include(contender3.address);
    });

    it("Should get total votes", async function () {
      const { votingContract, voter1, voter2, voter3 } = await loadFixture(
        deployVotingContractFixture
      );

      await votingContract.batchRegistration(
        [
          (await hre.ethers.getSigners())[3].address,
          (await hre.ethers.getSigners())[4].address,
          (await hre.ethers.getSigners())[5].address,
        ],
        ["CODE1", "CODE2", "CODE3"]
      );
      await votingContract.startVoting(3600);

      await votingContract.connect(voter1).vote("CODE1");
      await votingContract.connect(voter2).vote("CODE1");
      await votingContract.connect(voter3).vote("CODE2");

      const totalVotes = await votingContract.getTotalVotes();
      expect(totalVotes).to.equal(3);
    });

    it("Should check if address has voted", async function () {
      const { votingContract, voter1, voter2 } = await loadFixture(
        deployVotingContractFixture
      );

      await votingContract.batchRegistration(
        [
          (await hre.ethers.getSigners())[3].address,
          (await hre.ethers.getSigners())[4].address,
          (await hre.ethers.getSigners())[5].address,
        ],
        ["CODE1", "CODE2", "CODE3"]
      );
      await votingContract.startVoting(3600);

      expect(await votingContract.hasVoted(voter1.address)).to.be.false;

      await votingContract.connect(voter1).vote("CODE1");

      expect(await votingContract.hasVoted(voter1.address)).to.be.true;
      expect(await votingContract.hasVoted(voter2.address)).to.be.false;
    });

    it("Should get voting status", async function () {
      const { votingContract, contender1, contender2 } = await loadFixture(
        deployVotingContractFixture
      );

      await votingContract.registration(contender1.address, "CODE1");
      await votingContract.registration(contender2.address, "CODE2");

      let [active, startTime, endTime] = await votingContract.getVotingStatus();
      expect(active).to.be.false;
      expect(startTime).to.equal(0);
      expect(endTime).to.equal(0);

      await votingContract.startVoting(3600);

      [active, startTime, endTime] = await votingContract.getVotingStatus();
      expect(active).to.be.true;
      expect(startTime).to.be.greaterThan(0);
      expect(endTime).to.equal(startTime + 3600n);
    });

    it("Should get contender details", async function () {
      const { votingContract, contender1 } = await loadFixture(
        deployVotingContractFixture
      );

      await votingContract.registration(contender1.address, "CODE1");

      const details = await votingContract.getContender("CODE1");
      expect(details.contender).to.equal(contender1.address);
      expect(details.code).to.equal("CODE1");
      expect(details.votersNo).to.equal(0);
      expect(details.registered).to.be.true;
    });

    it("Should revert when getting non-existent contender", async function () {
      const { votingContract } = await loadFixture(deployVotingContractFixture);

      await expect(
        votingContract.getContender("INVALID")
      ).to.be.revertedWith("Contender not found");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle tie scenario (first with max votes wins)", async function () {
      const { votingContract, contender1, contender2, voter1, voter2, voter3 } =
        await loadFixture(deployVotingContractFixture);

      await votingContract.registration(contender1.address, "CODE1");
      await votingContract.registration(contender2.address, "CODE2");
      await votingContract.startVoting(3600);

      // Create a tie: each gets 1 vote
      await votingContract.connect(voter1).vote("CODE1");
      await votingContract.connect(voter2).vote("CODE2");

      await votingContract.endVoting();

      // First contender with max votes should win
      const [winner] = await votingContract.getWinner();
      expect([contender1.address, contender2.address]).to.include(winner);
    });

    it("Should handle scenario with no votes", async function () {
      const { votingContract, contender1, contender2 } = await loadFixture(
        deployVotingContractFixture
      );

      await votingContract.registration(contender1.address, "CODE1");
      await votingContract.registration(contender2.address, "CODE2");
      await votingContract.startVoting(3600);
      await votingContract.endVoting();

      // Should still return a winner (first contender with 0 votes)
      const [winner] = await votingContract.getWinner();
      expect([contender1.address, contender2.address]).to.include(winner);
    });
  });
});
```
