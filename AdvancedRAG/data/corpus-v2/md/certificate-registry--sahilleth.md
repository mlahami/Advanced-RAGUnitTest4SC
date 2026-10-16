# certificate-registry--sahilleth

- domain: registries-identity (identity-registry)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/sahilleth/BlockCert @ b1c86e29e08a999de7213a00d868da11e0c83231
- license: MIT
- targets: CertificateRegistry.sol
- validation: 17 passing tests, 0 failing; statement coverage CertificateRegistry.sol 100.0 %

## Contract: CertificateRegistry.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CertificateRegistry
 * @author BlockCert
 * @notice On-chain registry that stores ONLY SHA-256 hashes of certificate PDFs.
 * @dev PDF files and student metadata live off-chain (MySQL / IPFS).
 *      The backend converts a UUID string to `bytes32` via keccak256(uuid).
 *      The SHA-256 hex digest is converted to `bytes32` (left-padded with zeros).
 *
 * ─── Stored On-Chain ───────────────────────────────────────────────────────
 *   • certificateId  (bytes32 key)
 *   • hash             (bytes32 SHA-256 of PDF)
 *   • issuedAt         (block timestamp)
 *   • issuer           (owner address at time of issuance)
 *
 * ─── NOT Stored On-Chain ───────────────────────────────────────────────────
 *   • PDF file, student name, email, course, department
 */
contract CertificateRegistry is Ownable {
    // ─── Types ──────────────────────────────────────────────────────────────

    /**
     * @dev Minimal on-chain record — hash only, no PDF or PII.
     */
    struct Certificate {
        bytes32 hash;
        uint256 issuedAt;
        address issuer;
        bool exists;
    }

    // ─── State ──────────────────────────────────────────────────────────────

    /// @notice Total number of certificates ever issued.
    uint256 public totalIssued;

    /// @dev certificateId → Certificate record.
    mapping(bytes32 => Certificate) private _certificates;

    /// @dev Prevents the same SHA-256 hash from being registered twice.
    mapping(bytes32 => bool) private _hashRegistered;

    // ─── Events ─────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when the contract owner registers a new certificate hash.
     * @param certificateId Unique identifier (bytes32 UUID derivative).
     * @param hash          SHA-256 digest of the PDF as bytes32.
     * @param issuer        Address that called issueCertificate (owner).
     * @param issuedAt      Block timestamp of issuance.
     */
    event CertificateIssued(
        bytes32 indexed certificateId,
        bytes32 indexed hash,
        address indexed issuer,
        uint256 issuedAt
    );

    /**
     * @notice Emitted when anyone calls verifyCertificate on-chain.
     * @param certificateId Certificate being verified.
     * @param hash          Stored hash at verification time.
     * @param verifier      Address that initiated verification (msg.sender).
     * @param verifiedAt    Block timestamp of verification.
     */
    event CertificateVerified(
        bytes32 indexed certificateId,
        bytes32 indexed hash,
        address indexed verifier,
        uint256 verifiedAt
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @notice Deploys the registry and sets the deployer as the initial owner.
     * @dev Only the owner may call issueCertificate.
     */
    constructor() Ownable(msg.sender) {}

    // ─── Write Functions ──────────────────────────────────────────────────────

    /**
     * @notice Register a certificate SHA-256 hash on-chain.
     * @dev Restricted to contract owner (college backend wallet).
     *
     * Requirements:
     *  - `certificateId` must not have been issued before.
     *  - `hash` must not be zero and must not already be registered.
     *  - Caller must be the contract owner.
     *
     * @param certificateId Unique bytes32 identifier for this certificate.
     * @param hash          SHA-256 hash of the PDF file as bytes32.
     *
     * Emits {CertificateIssued}.
     */
    function issueCertificate(bytes32 certificateId, bytes32 hash) external onlyOwner {
        require(!_certificates[certificateId].exists, "CertificateRegistry: duplicate certificateId");
        require(hash != bytes32(0), "CertificateRegistry: zero hash");
        require(!_hashRegistered[hash], "CertificateRegistry: duplicate hash");

        _certificates[certificateId] = Certificate({
            hash: hash,
            issuedAt: block.timestamp,
            issuer: msg.sender,
            exists: true
        });

        _hashRegistered[hash] = true;
        totalIssued++;

        emit CertificateIssued(certificateId, hash, msg.sender, block.timestamp);
    }

    /**
     * @notice Verify a certificate exists on-chain and emit an audit event.
     * @dev Callable by anyone (employers, auditors). Costs gas because it writes an event.
     *
     * Requirements:
     *  - Certificate with `certificateId` must exist.
     *
     * @param certificateId The certificate identifier to verify.
     * @return exists Always `true` when the call succeeds (reverts otherwise).
     * @return hash        The SHA-256 hash stored for this certificate.
     *
     * Emits {CertificateVerified}.
     */
    function verifyCertificate(bytes32 certificateId)
        external
        returns (bool exists, bytes32 hash)
    {
        Certificate memory cert = _certificates[certificateId];
        require(cert.exists, "CertificateRegistry: certificate not found");

        emit CertificateVerified(certificateId, cert.hash, msg.sender, block.timestamp);

        return (true, cert.hash);
    }

    // ─── Read Functions ───────────────────────────────────────────────────────

    /**
     * @notice Read certificate data without emitting an event (free, view-only).
     * @dev Used by the backend during verification to fetch the on-chain hash
     *      and compare it against a freshly computed SHA-256 of the PDF.
     *
     * @param certificateId The certificate identifier to look up.
     * @return hash     SHA-256 hash stored on-chain (bytes32(0) if not found).
     * @return issuedAt Unix timestamp when the certificate was issued.
     * @return issuer   Address that issued the certificate.
     * @return exists   Whether the certificate is registered.
     */
    function getCertificate(bytes32 certificateId)
        external
        view
        returns (bytes32 hash, uint256 issuedAt, address issuer, bool exists)
    {
        Certificate memory cert = _certificates[certificateId];
        return (cert.hash, cert.issuedAt, cert.issuer, cert.exists);
    }

    /**
     * @notice Check whether a SHA-256 hash has already been registered.
     * @param hash The hash to check.
     * @return registered True if the hash is already on-chain.
     */
    function isHashRegistered(bytes32 hash) external view returns (bool registered) {
        return _hashRegistered[hash];
    }

    /**
     * @notice Check whether a certificateId has been issued.
     * @param certificateId The identifier to check.
     * @return issued True if the certificateId exists.
     */
    function isCertificateIssued(bytes32 certificateId) external view returns (bool issued) {
        return _certificates[certificateId].exists;
    }
}
```

## Tests: CertificateRegistry.test.js

```javascript
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
```
