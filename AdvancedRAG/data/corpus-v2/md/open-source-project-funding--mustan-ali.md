# open-source-project-funding--mustan-ali

- domain: crowdfunding (crowdfunding)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/mustan-ali/OpenSourceProjectFunding @ bdd2e9e090be782f5c9e17c346581bcec3d234cb
- license: MIT
- targets: OpenSourceProjectFunding.sol
- validation: 10 passing tests, 0 failing; statement coverage OpenSourceProjectFunding.sol 94.23 %

## Contract: OpenSourceProjectFunding.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract OpenSourceProjectFunding is ReentrancyGuard {
    // Structure to represent a project
    struct Project {
        uint256 projectNumber;          // Unique identifier for the project
        address payable owner;          // Address of the project creator
        string name;                    // Name of the project
        string description;             // Description of the project
        string url;                     // URL pointing to the project or its details
        uint256 fundingGoal;            // Target amount to be raised
        uint256 totalFunds;             // Total funds raised so far
        bool isCompleted;               // Status indicating if the project reached its goal
        uint256 deadline;               // Timestamp after which project expires
        bool isExpired;                 // Status indicating if the deadline has passed
        bool isWithdrawn;               // Indicates if funds were withdrawn early
    }

    uint256 projectCount;                     // Total number of projects created
    address payable public contractOwner;     // Owner of the contract
    uint256 public creationFee;               // Fee to create a project
    uint256 public contributionFee;           // Fee deducted from each contribution
    uint256 public earlyWithdrawalFee;        // Fee required for early withdrawal

    mapping(uint256 => Project) public projects; // Mapping of project ID to Project struct
    mapping(uint256 => mapping(address => uint256)) public contributions; // Contributions per project per address

    // Constructor to initialize fees and set contract owner
    constructor(uint256 _creationFee, uint256 _contributionFee, uint256 _earlyWithdrawalFee) {
        require(_creationFee > 0, "Creation fee must be greater than zero");
        require(_contributionFee > 0, "Contribution fee must be greater than zero");
        require(_earlyWithdrawalFee > 0, "Early withdrawal fee must be greater than zero");

        contractOwner = payable(msg.sender);
        creationFee = _creationFee;
        contributionFee = _contributionFee;
        earlyWithdrawalFee = _earlyWithdrawalFee;
    }

    // Modifier to restrict function to only the contract owner
    modifier onlyOwner() {
        require(msg.sender == contractOwner, "Only the contract owner can call this");
        _;
    }

    // Admin function to set creation fee
    function setCreationFee(uint256 _creationFee) public onlyOwner {
        creationFee = _creationFee;
    }

    // Admin function to set contribution fee
    function setContributionFee(uint256 _contributionFee) public onlyOwner {
        contributionFee = _contributionFee;
    }

    // Admin function to set early withdrawal fee
    function setEarlyWithdrawalFee(uint256 _earlyWithdrawalFee) public onlyOwner {
        earlyWithdrawalFee = _earlyWithdrawalFee;
    }

    // Event declarations
    event ProjectCreated(uint256 indexed projectId, address indexed owner, string name, uint256 fundingGoal, string url);
    event ProjectContributed(uint256 indexed projectId, address indexed contributor, uint256 amount);
    event ProjectWithdrawn(uint256 indexed projectId);
    event ProjectExpired(uint256 indexed projectId);
    event ProjectCompleted(uint256 indexed projectId);

    // Function to create a new project
    function createProject(string memory _name, string memory _description, string memory _url, uint256 _fundingGoal, uint256 _deadline) public payable {
        require(_fundingGoal > 0, "Funding goal must be greater than zero");
        require(_deadline > 0, "Deadline must be greater than zero");
        require(msg.value == creationFee, "Insufficient fee to create project");
        require(bytes(_name).length > 0, "Project name cannot be empty");
        require(bytes(_description).length > 0, "Project description cannot be empty");
        require(bytes(_url).length > 0, "Project URL cannot be empty");

        // Transfer creation fee to the contract owner
        contractOwner.transfer(msg.value);

        // Create and store the new project
        projects[projectCount] = Project({
            projectNumber: projectCount,
            owner: payable(msg.sender),
            name: _name,
            description: _description,
            url: _url,
            fundingGoal: _fundingGoal,
            totalFunds: 0,
            isCompleted: false,
            deadline: block.timestamp + _deadline,
            isExpired: false,
            isWithdrawn: false
        });

        emit ProjectCreated(projectCount, msg.sender, _name, _fundingGoal, _url);
        projectCount++;

        // Update the status of any expired projects
        updateProjectStatus();
    }

    // Function to return the number of created projects
    function getProjectCount() public view returns (uint256) {
        return projectCount;
    }

    // Function to update the status of projects that have passed their deadlines
    function updateProjectStatus() public {
        for (uint256 i = 0; i < projectCount; i++) {
            if (!projects[i].isExpired && block.timestamp >= projects[i].deadline && !projects[i].isCompleted && !projects[i].isWithdrawn) {
                projects[i].isExpired = true;
                emit ProjectExpired(i);
            }
        }
    }

    // Function to contribute funds to a project
    function contribute(uint256 _projectId) public payable nonReentrant {
        require(_projectId < projectCount, "Invalid project ID");

        updateProjectStatus(); // Ensure status is up to date
        Project storage project = projects[_projectId];

        require(msg.sender != project.owner, "You can't contribute to your own projects");
        require(!project.isExpired, "Project has expired");
        require(!project.isCompleted, "Project has already been completed");
        require(!project.isWithdrawn, "Project has already been withdrawn");
        require(msg.value > 0, "Contribution must be greater than zero");

        // Calculate fee and ensure amount is valid
        uint256 feeAmount = (msg.value * contributionFee) / 100;
        require(msg.value > feeAmount, "Contribution amount must be greater than fee");

        // Transfer fees and funds
        contractOwner.transfer(feeAmount);
        project.owner.transfer(msg.value - feeAmount);

        // Update project and contribution records
        project.totalFunds += msg.value - feeAmount;
        contributions[_projectId][msg.sender] += msg.value - feeAmount;

        // Check if funding goal is reached
        if (project.totalFunds >= project.fundingGoal) {
            project.isCompleted = true;
            emit ProjectCompleted(_projectId);
        }

        emit ProjectContributed(_projectId, msg.sender, msg.value - feeAmount);
    }

    // Function to view the early withdrawal fee for a project
    function getEarlyWithdrawalFee(uint256 _projectId) public view returns (uint256) {
        require(_projectId < projectCount, "Invalid project ID");
        Project storage project = projects[_projectId];

        require(msg.sender == project.owner, "Only the project owner can check early withdrawal fee");
        require(!project.isExpired, "Project has expired");
        require(!project.isCompleted, "Project has already been completed");
        require(!project.isWithdrawn, "Project has already been withdrawn");

        // If no funds have been contributed, the fee is just the creation fee
        if (project.totalFunds == 0) {
            return creationFee;
        }

        // Otherwise, calculate a percentage-based fee
        return (project.totalFunds * earlyWithdrawalFee) / 100;
    }

    // Function to withdraw early from the project
    function withdrawEarly(uint256 _projectId) public payable nonReentrant {
        require(_projectId < projectCount, "Invalid project ID");

        updateProjectStatus(); // Ensure up-to-date status

        Project storage project = projects[_projectId];

        require(msg.sender == project.owner, "Only the project owner can withdraw early");
        require(!project.isExpired, "Project has expired");
        require(!project.isCompleted, "Project has already been completed");
        require(!project.isWithdrawn, "Project has already been withdrawn");

        uint256 feeAmount = getEarlyWithdrawalFee(_projectId);
        require(msg.value == feeAmount, "Insufficient fee to withdraw early");

        contractOwner.transfer(feeAmount);
        project.isWithdrawn = true;

        emit ProjectWithdrawn(_projectId);
    }
}
```

## Tests: OpenSourceProjectFunding.test.js

```javascript
// Import required libraries
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = require("ethers");

// Main test suite for OpenSourceProjectFunding contract
describe("OpenSourceProjectFunding", function () {
    let Funding; // Contract factory
    let funding; // Deployed contract instance
    let owner, addr1, addr2; // Signers for different accounts

    // Predefined fee values
    const creationFee = parseEther("0.01"); // Fee to create a project
    const contributionFee = 5; // 5% fee on contributions
    const earlyWithdrawalFee = 10; // 10% fee for early withdrawal

    // Deploy contract before each test
    beforeEach(async function () {
        [owner, addr1, addr2] = await ethers.getSigners(); // Retrieve test accounts
        Funding = await ethers.getContractFactory("OpenSourceProjectFunding");
        funding = await Funding.deploy(creationFee, contributionFee, earlyWithdrawalFee);
        await funding.waitForDeployment(); // Wait for deployment to finish
    });

    // Deployment Tests
    describe("Deployment", function () {
        it("Should set correct fees and owner", async function () {
            expect(await funding.creationFee()).to.equal(creationFee);
            expect(await funding.contributionFee()).to.equal(contributionFee);
            expect(await funding.earlyWithdrawalFee()).to.equal(earlyWithdrawalFee);
        });
    });

    // Project Creation Tests
    describe("Project Creation", function () {
        it("Should create a project successfully", async function () {
            await expect(funding.connect(addr1).createProject(
                "Project A",
                "Description",
                "https://project-a.com",
                parseEther("1"),
                86400, // 1 day in seconds
                { value: creationFee }
            )).to.emit(funding, "ProjectCreated"); // Ensure event is emitted

            const project = await funding.projects(0);
            expect(project.name).to.equal("Project A"); // Verify name stored correctly
        });

        it("Should fail for invalid inputs", async function () {
            // Project name empty
            await expect(funding.connect(addr1).createProject(
                "", "Desc", "url", parseEther("1"), 1000,
                { value: creationFee }
            )).to.be.revertedWith("Project name cannot be empty");

            // Description empty
            await expect(funding.connect(addr1).createProject(
                "Name", "", "url", parseEther("1"), 1000,
                { value: creationFee }
            )).to.be.revertedWith("Project description cannot be empty");

            // URL empty
            await expect(funding.connect(addr1).createProject(
                "Name", "Desc", "", parseEther("1"), 1000,
                { value: creationFee }
            )).to.be.revertedWith("Project URL cannot be empty");

            // Funding goal zero
            await expect(funding.connect(addr1).createProject(
                "Name", "Desc", "url", 0, 1000,
                { value: creationFee }
            )).to.be.revertedWith("Funding goal must be greater than zero");

            // Deadline zero
            await expect(funding.connect(addr1).createProject(
                "Name", "Desc", "url", 1000, 0,
                { value: creationFee }
            )).to.be.revertedWith("Deadline must be greater than zero");

            // Missing fee
            await expect(funding.connect(addr1).createProject(
                "Name", "Desc", "url", 1000, 1000,
                { value: 0 }
            )).to.be.revertedWith("Insufficient fee to create project");
        });
    });

    // Contribution Tests
    describe("Contributions", function () {
        beforeEach(async function () {
            // Create a project for contribution tests
            await funding.connect(addr1).createProject(
                "Project A", "Desc", "https://example.com",
                parseEther("1"), 86400,
                { value: creationFee }
            );
        });

        it("Should allow valid contribution", async function () {
            const contribution = parseEther("0.2");
            const fee = contribution * BigInt(contributionFee) / BigInt(100);
            const expected = contribution - fee;

            // Contribute and check event
            await expect(funding.connect(addr2).contribute(0, { value: contribution }))
                .to.emit(funding, "ProjectContributed")
                .withArgs(0, addr2.address, expected);

            // Verify project fund balance
            const project = await funding.projects(0);
            expect(project.totalFunds).to.equal(expected);
        });

        it("Should reject self-contribution", async function () {
            await expect(funding.connect(addr1).contribute(0, { value: parseEther("0.1") }))
                .to.be.revertedWith("You can't contribute to your own projects");
        });

        it("Should reject if completed", async function () {
            const bigContribution = parseEther("2");
            await funding.connect(addr2).contribute(0, { value: bigContribution });

            // Attempt second contribution after goal met
            await expect(funding.connect(addr2).contribute(0, { value: bigContribution }))
                .to.be.revertedWith("Project has already been completed");
        });
    });

    // Early Withdrawal Tests
    describe("Early Withdrawal", function () {
        beforeEach(async function () {
            // Create project and contribute funds
            await funding.connect(addr1).createProject(
                "Project A", "Desc", "https://example.com",
                parseEther("1"), 86400,
                { value: creationFee }
            );
            await funding.connect(addr2).contribute(0, { value: parseEther("0.5") });
        });

        it("Should return correct early withdrawal fee", async function () {
            const project = await funding.projects(0);
            const expectedFee = project.totalFunds * BigInt(earlyWithdrawalFee) / BigInt(100);

            // Get and compare fee
            const fee = await funding.connect(addr1).getEarlyWithdrawalFee(0);
            expect(fee).to.equal(expectedFee);
        });

        it("Should allow early withdrawal with correct fee", async function () {
            const fee = await funding.connect(addr1).getEarlyWithdrawalFee(0);
            await expect(funding.connect(addr1).withdrawEarly(0, { value: fee }))
                .to.emit(funding, "ProjectWithdrawn");

            const project = await funding.projects(0);
            expect(project.isWithdrawn).to.be.true;
        });

        it("Should fail if non-owner or incorrect fee", async function () {
            const fee = await funding.connect(addr1).getEarlyWithdrawalFee(0);

            // Only owner can withdraw
            await expect(funding.connect(addr2).withdrawEarly(0, { value: fee }))
                .to.be.revertedWith("Only the project owner can withdraw early");

            // Must pay full fee
            await expect(funding.connect(addr1).withdrawEarly(0, { value: fee - BigInt(1) }))
                .to.be.revertedWith("Insufficient fee to withdraw early");
        });
    });

    // Status Update Tests
    describe("Status Updates", function () {
        it("Should expire projects past deadline", async function () {
            await funding.connect(addr1).createProject(
                "Project A", "Desc", "https://example.com",
                parseEther("1"), 1, // 1 second deadline
                { value: creationFee }
            );

            // Advance blockchain time
            await ethers.provider.send("evm_increaseTime", [2]);
            await ethers.provider.send("evm_mine");

            // Trigger status update
            await funding.updateProjectStatus();
            const project = await funding.projects(0);
            expect(project.isExpired).to.equal(true);
        });
    });
});
```
