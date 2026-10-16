# claim-settlement--onlymekarthik

- domain: insurance (insurance)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/OnlymeKarthik/Dr.Benmax @ 90d32de040da5d1421254e7a46e6d9f40076b37d
- license: MIT
- targets: ClaimSettlement.sol
- validation: 12 passing tests, 0 failing; statement coverage ClaimSettlement.sol 80.0 %

## Contract: ClaimSettlement.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract ClaimSettlement is ReentrancyGuard, AccessControl, Pausable {
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant HOSPITAL_ROLE = keccak256("HOSPITAL_ROLE");

    enum ClaimStatus { Submitted, Validated, Approved, Rejected, Settled }

    struct Claim {
        uint256 id;
        string hospitalId;
        uint256 amount; // In smallest unit (e.g., Wei)
        string currency; // e.g., "INR", "EUR"
        string ipfsHash; // Link to documents
        ClaimStatus status;
        uint256 timestamp;
    }

    mapping(uint256 => Claim) public claims;
    mapping(uint256 => bool) public claimExists;
    
    event ClaimSubmitted(uint256 indexed id, string hospitalId, uint256 amount);
    event ClaimValidated(uint256 indexed id, bool isValid, uint256 fraudScore);
    event ClaimSettled(uint256 indexed id, uint256 amount);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function addValidator(address _validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(VALIDATOR_ROLE, _validator);
        emit ValidatorAdded(_validator);
    }

    function removeValidator(address _validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(VALIDATOR_ROLE, _validator);
        emit ValidatorRemoved(_validator);
    }

    function submitClaim(
        uint256 _id, 
        string memory _hospitalId, 
        uint256 _amount, 
        string memory _currency, 
        string memory _ipfsHash
    ) external whenNotPaused {
        require(!claimExists[_id], "Claim already exists");
        require(_amount > 0, "Amount must be greater than 0");
        require(bytes(_hospitalId).length > 0, "Invalid hospital ID");
        require(bytes(_ipfsHash).length > 0, "Invalid IPFS hash");
        
        // In production, we would check if msg.sender has HOSPITAL_ROLE
        // require(hasRole(HOSPITAL_ROLE, msg.sender), "Caller is not a registered hospital");

        claims[_id] = Claim({
            id: _id,
            hospitalId: _hospitalId,
            amount: _amount,
            currency: _currency,
            ipfsHash: _ipfsHash,
            status: ClaimStatus.Submitted,
            timestamp: block.timestamp
        });
        claimExists[_id] = true;

        emit ClaimSubmitted(_id, _hospitalId, _amount);
    }

    function validateClaim(uint256 _id, bool _isValid, uint256 _fraudScore) external onlyRole(VALIDATOR_ROLE) whenNotPaused {
        require(claimExists[_id], "Claim does not exist");
        require(claims[_id].status == ClaimStatus.Submitted, "Invalid status");

        if (_isValid && _fraudScore < 20) { // Threshold for auto-approval
            claims[_id].status = ClaimStatus.Approved;
        } else {
            claims[_id].status = ClaimStatus.Rejected;
        }

        emit ClaimValidated(_id, _isValid, _fraudScore);
    }

    function settleClaim(uint256 _id) external onlyRole(VALIDATOR_ROLE) nonReentrant whenNotPaused {
        require(claims[_id].status == ClaimStatus.Approved, "Claim not approved");
        
        // In a real system, this would trigger an ERC20 transfer
        // require(token.transfer(hospitalAddress, claims[_id].amount), "Transfer failed");
        
        claims[_id].status = ClaimStatus.Settled;
        
        emit ClaimSettled(_id, claims[_id].amount);
    }

    function getClaim(uint256 _id) external view returns (Claim memory) {
        return claims[_id];
    }
}
```

## Tests: ClaimSettlement.test.js

```javascript
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
```
