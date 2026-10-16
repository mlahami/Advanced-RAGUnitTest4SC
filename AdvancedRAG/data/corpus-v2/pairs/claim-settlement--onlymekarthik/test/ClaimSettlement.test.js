const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClaimSettlement", function () {
    let ClaimSettlement;
    let claimSettlement;
    let owner;
    let validator;
    let hospital;
    let otherAccount;

    beforeEach(async function () {
        [owner, validator, hospital, otherAccount] = await ethers.getSigners();

        ClaimSettlement = await ethers.getContractFactory("ClaimSettlement");
        claimSettlement = await ClaimSettlement.deploy();
        await claimSettlement.waitForDeployment(); // Ethers v6 syntax

        // Grant VALIDATOR_ROLE to validator account
        const VALIDATOR_ROLE = await claimSettlement.VALIDATOR_ROLE();
        await claimSettlement.grantRole(VALIDATOR_ROLE, validator.address);
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            const DEFAULT_ADMIN_ROLE = await claimSettlement.DEFAULT_ADMIN_ROLE();
            expect(await claimSettlement.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.equal(true);
        });

        it("Should set the deployer as a validator", async function () {
            const VALIDATOR_ROLE = await claimSettlement.VALIDATOR_ROLE();
            expect(await claimSettlement.hasRole(VALIDATOR_ROLE, owner.address)).to.equal(true);
        });
    });

    describe("Access Control", function () {
        it("Should allow admin to add a validator", async function () {
            const VALIDATOR_ROLE = await claimSettlement.VALIDATOR_ROLE();
            await claimSettlement.addValidator(otherAccount.address);
            expect(await claimSettlement.hasRole(VALIDATOR_ROLE, otherAccount.address)).to.equal(true);
        });

        it("Should not allow non-admin to add a validator", async function () {
            await expect(
                claimSettlement.connect(otherAccount).addValidator(otherAccount.address)
            ).to.be.reverted; // AccessControl revert message varies
        });
    });

    describe("Claim Submission", function () {
        it("Should submit a valid claim", async function () {
            await expect(claimSettlement.submitClaim(1, "HOSP-001", 1000, "INR", "QmHash"))
                .to.emit(claimSettlement, "ClaimSubmitted")
                .withArgs(1, "HOSP-001", 1000);

            const claim = await claimSettlement.getClaim(1);
            expect(claim.status).to.equal(0); // Submitted
            expect(claim.amount).to.equal(1000);
        });

        it("Should fail if claim ID already exists", async function () {
            await claimSettlement.submitClaim(1, "HOSP-001", 1000, "INR", "QmHash");
            await expect(
                claimSettlement.submitClaim(1, "HOSP-001", 1000, "INR", "QmHash")
            ).to.be.revertedWith("Claim already exists");
        });

        it("Should fail if amount is 0", async function () {
            await expect(
                claimSettlement.submitClaim(2, "HOSP-001", 0, "INR", "QmHash")
            ).to.be.revertedWith("Amount must be greater than 0");
        });
    });

    describe("Claim Validation", function () {
        beforeEach(async function () {
            await claimSettlement.submitClaim(1, "HOSP-001", 1000, "INR", "QmHash");
        });

        it("Should allow validator to validate claim", async function () {
            await expect(claimSettlement.connect(validator).validateClaim(1, true, 10))
                .to.emit(claimSettlement, "ClaimValidated")
                .withArgs(1, true, 10);

            const claim = await claimSettlement.getClaim(1);
            expect(claim.status).to.equal(2); // Approved (Submitted=0, Validated=1, Approved=2)
        });

        it("Should reject claim if fraud score is high", async function () {
            await claimSettlement.connect(validator).validateClaim(1, true, 50);
            const claim = await claimSettlement.getClaim(1);
            expect(claim.status).to.equal(3); // Rejected
        });

        it("Should not allow non-validator to validate", async function () {
            await expect(
                claimSettlement.connect(otherAccount).validateClaim(1, true, 10)
            ).to.be.reverted;
        });
    });

    describe("Claim Settlement", function () {
        beforeEach(async function () {
            await claimSettlement.submitClaim(1, "HOSP-001", 1000, "INR", "QmHash");
            await claimSettlement.connect(validator).validateClaim(1, true, 10);
        });

        it("Should settle an approved claim", async function () {
            await expect(claimSettlement.connect(validator).settleClaim(1))
                .to.emit(claimSettlement, "ClaimSettled")
                .withArgs(1, 1000);

            const claim = await claimSettlement.getClaim(1);
            expect(claim.status).to.equal(4); // Settled
        });

        it("Should fail to settle if not approved", async function () {
            await claimSettlement.submitClaim(2, "HOSP-001", 1000, "INR", "QmHash");
            await expect(
                claimSettlement.connect(validator).settleClaim(2)
            ).to.be.revertedWith("Claim not approved");
        });
    });
});
