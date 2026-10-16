const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AcademicCredential", function () {
  let academicCredential;
  let owner;
  let issuer;
  let student;
  let nonIssuer;

  beforeEach(async function () {
    [owner, issuer, student, nonIssuer] = await ethers.getSigners();

    const AcademicCredential = await ethers.getContractFactory("AcademicCredential");
    academicCredential = await AcademicCredential.deploy(owner.address);
    await academicCredential.waitForDeployment();

    // Grant issuer role
    const ISSUER_ROLE = await academicCredential.ISSUER_ROLE();
    await academicCredential.grantRole(ISSUER_ROLE, issuer.address);
  });

  describe("Deployment", function () {
    it("Should set the correct admin", async function () {
      const DEFAULT_ADMIN_ROLE = await academicCredential.DEFAULT_ADMIN_ROLE();
      expect(await academicCredential.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should grant issuer role to owner", async function () {
      const ISSUER_ROLE = await academicCredential.ISSUER_ROLE();
      expect(await academicCredential.hasRole(ISSUER_ROLE, owner.address)).to.be.true;
    });
  });

  describe("Credential Issuance", function () {
    it("Should issue a credential successfully", async function () {
      const metadataURI = "ipfs://QmTest123";
      
      const tx = await academicCredential.connect(issuer).issueCredential(
        student.address,
        metadataURI
      );

      await expect(tx)
        .to.emit(academicCredential, "CredentialIssued")
        .withArgs(0, student.address, metadataURI, await ethers.provider.getBlock('latest').then(b => b.timestamp));

      const credential = await academicCredential.verifyCredential(0);
      expect(credential.student).to.equal(student.address);
      expect(credential.metadataURI).to.equal(metadataURI);
      expect(credential.revoked).to.be.false;
    });

    it("Should fail if non-issuer tries to issue", async function () {
      await expect(
        academicCredential.connect(nonIssuer).issueCredential(
          student.address,
          "ipfs://QmTest123"
        )
      ).to.be.reverted;
    });

    it("Should fail if issuing to zero address", async function () {
      await expect(
        academicCredential.connect(issuer).issueCredential(
          ethers.ZeroAddress,
          "ipfs://QmTest123"
        )
      ).to.be.revertedWith("Cannot issue to zero address");
    });

    it("Should prevent duplicate credentials", async function () {
      const metadataURI = "ipfs://QmTest123";
      
      await academicCredential.connect(issuer).issueCredential(
        student.address,
        metadataURI
      );

      await expect(
        academicCredential.connect(issuer).issueCredential(
          student.address,
          metadataURI
        )
      ).to.be.revertedWith("Credential already exists for this metadata");
    });
  });

  describe("Credential Revocation", function () {
    beforeEach(async function () {
      await academicCredential.connect(issuer).issueCredential(
        student.address,
        "ipfs://QmTest123"
      );
    });

    it("Should revoke a credential", async function () {
      await expect(
        academicCredential.connect(issuer).revokeCredential(0)
      ).to.emit(academicCredential, "CredentialRevoked");

      const credential = await academicCredential.verifyCredential(0);
      expect(credential.revoked).to.be.true;
    });

    it("Should fail if non-issuer tries to revoke", async function () {
      await expect(
        academicCredential.connect(nonIssuer).revokeCredential(0)
      ).to.be.reverted;
    });

    it("Should fail when revoking already revoked credential", async function () {
      await academicCredential.connect(issuer).revokeCredential(0);
      
      await expect(
        academicCredential.connect(issuer).revokeCredential(0)
      ).to.be.revertedWith("Credential already revoked");
    });
  });

  describe("Credential Verification", function () {
    it("Should verify valid credential", async function () {
      const metadataURI = "ipfs://QmTest123";
      await academicCredential.connect(issuer).issueCredential(
        student.address,
        metadataURI
      );

      const credential = await academicCredential.verifyCredential(0);
      expect(credential.student).to.equal(student.address);
      expect(credential.metadataURI).to.equal(metadataURI);
      expect(credential.revoked).to.be.false;
    });

    it("Should return true for valid credential", async function () {
      await academicCredential.connect(issuer).issueCredential(
        student.address,
        "ipfs://QmTest123"
      );

      expect(await academicCredential.isCredentialValid(0)).to.be.true;
    });

    it("Should return false for revoked credential", async function () {
      await academicCredential.connect(issuer).issueCredential(
        student.address,
        "ipfs://QmTest123"
      );

      await academicCredential.connect(issuer).revokeCredential(0);
      expect(await academicCredential.isCredentialValid(0)).to.be.false;
    });

    it("Should fail when verifying non-existent credential", async function () {
      await expect(
        academicCredential.verifyCredential(999)
      ).to.be.revertedWith("Credential does not exist");
    });
  });

  describe("Student Credentials", function () {
    it("Should return all student credentials", async function () {
      await academicCredential.connect(issuer).issueCredential(
        student.address,
        "ipfs://QmTest1"
      );
      await academicCredential.connect(issuer).issueCredential(
        student.address,
        "ipfs://QmTest2"
      );

      const credentials = await academicCredential.getStudentCredentials(student.address);
      expect(credentials.length).to.equal(2);
      expect(credentials[0]).to.equal(0n);
      expect(credentials[1]).to.equal(1n);
    });

    it("Should return empty array for student with no credentials", async function () {
      const credentials = await academicCredential.getStudentCredentials(student.address);
      expect(credentials.length).to.equal(0);
    });
  });

  describe("Soulbound Functionality", function () {
    beforeEach(async function () {
      await academicCredential.connect(issuer).issueCredential(
        student.address,
        "ipfs://QmTest123"
      );
    });

    it("Should prevent transfers", async function () {
      await expect(
        academicCredential.connect(student).transferFrom(
          student.address,
          nonIssuer.address,
          0
        )
      ).to.be.revertedWith("Credentials are non-transferable (Soulbound)");
    });

    it("Should prevent safe transfers", async function () {
      await expect(
        academicCredential.connect(student)["safeTransferFrom(address,address,uint256)"](
          student.address,
          nonIssuer.address,
          0
        )
      ).to.be.revertedWith("Credentials are non-transferable (Soulbound)");
    });
  });

  describe("Total Credentials", function () {
    it("Should track total credentials issued", async function () {
      expect(await academicCredential.getTotalCredentials()).to.equal(0);

      await academicCredential.connect(issuer).issueCredential(
        student.address,
        "ipfs://QmTest1"
      );
      expect(await academicCredential.getTotalCredentials()).to.equal(1);

      await academicCredential.connect(issuer).issueCredential(
        student.address,
        "ipfs://QmTest2"
      );
      expect(await academicCredential.getTotalCredentials()).to.equal(2);
    });
  });
});
