const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CertificateRegistry", function () {
  let registry;
  let owner;
  let employer;
  let stranger;

  const CERTIFICATE_ID = ethers.id("550e8400-e29b-41d4-a716-446655440000");
  const SHA256_HASH = "0x" + "a".repeat(64);
  const OTHER_HASH = "0x" + "b".repeat(64);
  const OTHER_CERT_ID = ethers.id("660e8400-e29b-41d4-a716-446655440001");

  beforeEach(async function () {
    [owner, employer, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("CertificateRegistry");
    registry = await Factory.deploy();
    await registry.waitForDeployment();
  });

  async function expectRevert(promise, messagePart) {
    try {
      await promise;
      expect.fail(`Expected revert containing "${messagePart}"`);
    } catch (error) {
      expect((error).message).to.include(messagePart);
    }
  }

  function parseEvent(receipt, eventName) {
    const iface = registry.interface;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === eventName) return parsed;
      } catch {
        /* skip unrelated logs */
      }
    }
    return null;
  }

  // ─── Deployment ───────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets deployer as owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("starts with zero issued certificates", async function () {
      expect(await registry.totalIssued()).to.equal(0n);
    });
  });

  // ─── issueCertificate ───────────────────────────────────────────────────────

  describe("issueCertificate", function () {
    it("stores only the hash — no PDF or metadata", async function () {
      await registry.issueCertificate(CERTIFICATE_ID, SHA256_HASH);

      const [hash, issuedAt, issuer, exists] = await registry.getCertificate(CERTIFICATE_ID);
      expect(exists).to.be.true;
      expect(hash).to.equal(SHA256_HASH);
      expect(issuer).to.equal(owner.address);
      expect(Number(issuedAt)).to.be.greaterThan(0);
    });

    it("emits CertificateIssued with correct args", async function () {
      const tx = await registry.issueCertificate(CERTIFICATE_ID, SHA256_HASH);
      const receipt = (await tx.wait());
      const parsed = parseEvent(receipt, "CertificateIssued");

      expect(parsed).to.not.be.null;
      expect(parsed .args.certificateId).to.equal(CERTIFICATE_ID);
      expect(parsed .args.hash).to.equal(SHA256_HASH);
      expect(parsed .args.issuer).to.equal(owner.address);
      expect(Number(parsed .args.issuedAt)).to.be.greaterThan(0);
    });

    it("increments totalIssued", async function () {
      await registry.issueCertificate(CERTIFICATE_ID, SHA256_HASH);
      expect(await registry.totalIssued()).to.equal(1n);

      await registry.issueCertificate(OTHER_CERT_ID, OTHER_HASH);
      expect(await registry.totalIssued()).to.equal(2n);
    });

    it("rejects duplicate certificateId", async function () {
      await registry.issueCertificate(CERTIFICATE_ID, SHA256_HASH);
      await expectRevert(
        registry.issueCertificate(CERTIFICATE_ID, OTHER_HASH),
        "duplicate certificateId"
      );
    });

    it("rejects duplicate hash", async function () {
      await registry.issueCertificate(CERTIFICATE_ID, SHA256_HASH);
      await expectRevert(
        registry.issueCertificate(OTHER_CERT_ID, SHA256_HASH),
        "duplicate hash"
      );
    });

    it("rejects zero hash", async function () {
      await expectRevert(
        registry.issueCertificate(CERTIFICATE_ID, ethers.ZeroHash),
        "zero hash"
      );
    });

    it("rejects non-owner issuance", async function () {
      await expectRevert(
        registry.connect(stranger).issueCertificate(CERTIFICATE_ID, SHA256_HASH),
        "OwnableUnauthorizedAccount"
      );
    });

    it("marks hash as registered via isHashRegistered", async function () {
      expect(await registry.isHashRegistered(SHA256_HASH)).to.be.false;
      await registry.issueCertificate(CERTIFICATE_ID, SHA256_HASH);
      expect(await registry.isHashRegistered(SHA256_HASH)).to.be.true;
    });

    it("marks certificateId as issued via isCertificateIssued", async function () {
      expect(await registry.isCertificateIssued(CERTIFICATE_ID)).to.be.false;
      await registry.issueCertificate(CERTIFICATE_ID, SHA256_HASH);
      expect(await registry.isCertificateIssued(CERTIFICATE_ID)).to.be.true;
    });
  });

  // ─── getCertificate ───────────────────────────────────────────────────────

  describe("getCertificate", function () {
    it("returns empty record for unknown certificateId", async function () {
      const [hash, issuedAt, issuer, exists] = await registry.getCertificate(CERTIFICATE_ID);
      expect(exists).to.be.false;
      expect(hash).to.equal(ethers.ZeroHash);
      expect(issuedAt).to.equal(0n);
      expect(issuer).to.equal(ethers.ZeroAddress);
    });

    it("returns stored hash for issued certificate", async function () {
      await registry.issueCertificate(CERTIFICATE_ID, SHA256_HASH);
      const [hash,,, exists] = await registry.getCertificate(CERTIFICATE_ID);
      expect(exists).to.be.true;
      expect(hash).to.equal(SHA256_HASH);
    });
  });

  // ─── verifyCertificate ────────────────────────────────────────────────────

  describe("verifyCertificate", function () {
    beforeEach(async function () {
      await registry.issueCertificate(CERTIFICATE_ID, SHA256_HASH);
    });

    it("returns hash and emits CertificateVerified", async function () {
      const tx = await registry.connect(employer).verifyCertificate(CERTIFICATE_ID);
      const receipt = (await tx.wait());
      const parsed = parseEvent(receipt, "CertificateVerified");

      expect(parsed).to.not.be.null;
      expect(parsed .args.certificateId).to.equal(CERTIFICATE_ID);
      expect(parsed .args.hash).to.equal(SHA256_HASH);
      expect(parsed .args.verifier).to.equal(employer.address);

      const [exists, hash] = await registry.connect(employer).verifyCertificate.staticCall(
        CERTIFICATE_ID
      );
      expect(exists).to.be.true;
      expect(hash).to.equal(SHA256_HASH);
    });

    it("allows any address to verify (not owner-only)", async function () {
      const tx = await registry.connect(stranger).verifyCertificate(CERTIFICATE_ID);
      await tx.wait();
    });

    it("reverts for non-existent certificateId", async function () {
      await expectRevert(registry.verifyCertificate(OTHER_CERT_ID), "certificate not found");
    });
  });

  // ─── Ownership ────────────────────────────────────────────────────────────

  describe("Ownership", function () {
    it("allows owner transfer and new owner can issue", async function () {
      await registry.transferOwnership(stranger.address);
      expect(await registry.owner()).to.equal(stranger.address);

      await expectRevert(
        registry.connect(owner).issueCertificate(CERTIFICATE_ID, SHA256_HASH),
        "OwnableUnauthorizedAccount"
      );

      await registry.connect(stranger).issueCertificate(CERTIFICATE_ID, SHA256_HASH);
      expect(await registry.totalIssued()).to.equal(1n);
    });
  });
});
