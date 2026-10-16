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