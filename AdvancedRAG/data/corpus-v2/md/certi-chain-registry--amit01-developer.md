# certi-chain-registry--amit01-developer

- domain: registries-identity (certificate-registry)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Amit01-developer/CertiChain @ 152a3f1a5e55022e0d9e9a4eae90992e62656359
- license: MIT
- targets: CertiChainRegistry.sol
- validation: 17 passing tests, 0 failing; statement coverage CertiChainRegistry.sol 80.0 %

## Contract: CertiChainRegistry.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CertiChainRegistry
 * @notice On-chain registry for certificate hashes.
 *         Only authorised issuers can register or revoke certificates.
 *         Anyone can verify a certificate publicly.
 *
 * Storage (per certificate):
 *   - certificateId  : human-readable ID  (e.g. "CC-2026-A8F92D71")
 *   - certHash       : SHA-256 hex string of the certificate data
 *   - issuer         : address that registered the certificate
 *   - timestamp      : block.timestamp at registration
 *   - revoked        : bool, set to true by revokeCertificate()
 */
contract CertiChainRegistry {

    // ─── Structs ────────────────────────────────────────────────────────────

    struct Certificate {
        string  certificateId;
        bytes32 certHash;       // keccak256 of the hex-encoded SHA-256 hash
        address issuer;
        uint256 timestamp;
        bool    revoked;
        bool    exists;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    address public owner;
    mapping(address => bool) public authorizedIssuers;

    // Keyed by certHash (bytes32) so we can look up by hash directly
    mapping(bytes32 => Certificate) private certificates;

    // Also index by certificateId string for ID-based lookup
    mapping(string => bytes32) private idToHash;

    // ─── Events ──────────────────────────────────────────────────────────────

    event CertificateRegistered(
        string  indexed certificateId,
        bytes32 indexed certHash,
        address indexed issuer,
        uint256         timestamp
    );

    event CertificateRevoked(
        string  indexed certificateId,
        bytes32 indexed certHash,
        address indexed revokedBy,
        uint256         timestamp
    );

    event IssuerAuthorized(address indexed issuer);
    event IssuerRevoked(address indexed issuer);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "CertiChain: caller is not the owner");
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == owner || authorizedIssuers[msg.sender],
            "CertiChain: caller is not authorized"
        );
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        authorizedIssuers[msg.sender] = true;
        emit IssuerAuthorized(msg.sender);
    }

    // ─── Issuer management ───────────────────────────────────────────────────

    function authorizeIssuer(address issuer) external onlyOwner {
        authorizedIssuers[issuer] = true;
        emit IssuerAuthorized(issuer);
    }

    function revokeIssuer(address issuer) external onlyOwner {
        authorizedIssuers[issuer] = false;
        emit IssuerRevoked(issuer);
    }

    // ─── Core functions ──────────────────────────────────────────────────────

    /**
     * @notice Register a new certificate on-chain.
     * @param certificateId  Human-readable certificate ID (e.g. "CC-2026-A8F92D71")
     * @param certHashHex    SHA-256 hex string of the certificate data (64 hex chars, no 0x prefix)
     */
    function registerCertificate(
        string calldata certificateId,
        string calldata certHashHex
    ) external onlyAuthorized {
        bytes32 hashKey = keccak256(abi.encodePacked(certHashHex));

        require(!certificates[hashKey].exists, "CertiChain: certificate already registered");
        require(idToHash[certificateId] == bytes32(0), "CertiChain: certificateId already registered");

        certificates[hashKey] = Certificate({
            certificateId: certificateId,
            certHash:      hashKey,
            issuer:        msg.sender,
            timestamp:     block.timestamp,
            revoked:       false,
            exists:        true
        });

        idToHash[certificateId] = hashKey;

        emit CertificateRegistered(certificateId, hashKey, msg.sender, block.timestamp);
    }

    /**
     * @notice Verify a certificate by its SHA-256 hash string.
     * @param certHashHex  SHA-256 hex string to verify
     * @return exists      Whether a certificate with this hash is registered
     * @return revoked     Whether it has been revoked
     * @return issuer      Address that registered it
     * @return timestamp   Unix timestamp of registration
     * @return certId      The human-readable certificate ID
     */
    function verifyCertificate(string calldata certHashHex)
        external
        view
        returns (
            bool    exists,
            bool    revoked,
            address issuer,
            uint256 timestamp,
            string  memory certId
        )
    {
        bytes32 hashKey = keccak256(abi.encodePacked(certHashHex));
        Certificate storage cert = certificates[hashKey];
        return (cert.exists, cert.revoked, cert.issuer, cert.timestamp, cert.certificateId);
    }

    /**
     * @notice Get certificate record by its human-readable ID.
     */
    function getCertificate(string calldata certificateId)
        external
        view
        returns (
            bool    exists,
            bool    revoked,
            address issuer,
            uint256 timestamp,
            string  memory certHashHex
        )
    {
        bytes32 hashKey = idToHash[certificateId];
        if (hashKey == bytes32(0)) {
            return (false, false, address(0), 0, "");
        }
        Certificate storage cert = certificates[hashKey];
        // We cannot reverse bytes32 → original hex, so we return certificateId as the "hash" identifier
        // The certHashHex stored is the original string the caller can compare against
        return (cert.exists, cert.revoked, cert.issuer, cert.timestamp, cert.certificateId);
    }

    /**
     * @notice Revoke a registered certificate.
     * @param certHashHex  SHA-256 hex string of the certificate to revoke
     */
    function revokeCertificate(string calldata certHashHex) external onlyAuthorized {
        bytes32 hashKey = keccak256(abi.encodePacked(certHashHex));
        Certificate storage cert = certificates[hashKey];

        require(cert.exists,   "CertiChain: certificate not found");
        require(!cert.revoked, "CertiChain: certificate already revoked");

        cert.revoked = true;

        emit CertificateRevoked(cert.certificateId, hashKey, msg.sender, block.timestamp);
    }

    /**
     * @notice Convenience: check if a specific hash is registered and not revoked.
     */
    function isValid(string calldata certHashHex) external view returns (bool) {
        bytes32 hashKey = keccak256(abi.encodePacked(certHashHex));
        Certificate storage cert = certificates[hashKey];
        return cert.exists && !cert.revoked;
    }
}
```

## Tests: CertiChainRegistry.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

function fakeHash(seed) {
  return ethers.keccak256(ethers.toUtf8Bytes(seed)).replace("0x", "").padEnd(64, "0");
}

describe("CertiChainRegistry", () => {
  let registry;
  let owner;
  let authorized;
  let unauthorized;

  const certId1 = "CC-2026-AABBCCDD";
  const certHash1 = fakeHash("certificate-1");

  const certId2 = "CC-2026-EEFF0011";
  const certHash2 = fakeHash("certificate-2");

  beforeEach(async () => {
    [owner, authorized, unauthorized] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("CertiChainRegistry");
    registry = (await Factory.deploy());
    await registry.waitForDeployment();
  });

  describe("registerCertificate()", () => {
    it("owner can register a certificate", async () => {
      await expect(registry.registerCertificate(certId1, certHash1))
        .to.emit(registry, "CertificateRegistered")
        .withArgs(
          certId1,
          ethers.keccak256(ethers.toUtf8Bytes(certHash1)),
          owner.address,
          await ethers.provider.getBlock("latest").then(b => b .timestamp + 1)
        );
    });

    it("authorized issuer can register a certificate", async () => {
      await registry.connect(owner).authorizeIssuer(authorized.address);
      await expect(
        registry.connect(authorized).registerCertificate(certId2, certHash2)
      ).to.emit(registry, "CertificateRegistered");
    });

    it("rejects duplicate hash registration", async () => {
      await registry.registerCertificate(certId1, certHash1);
      await expect(
        registry.registerCertificate("CC-2026-DUPLICATE", certHash1)
      ).to.be.revertedWith("CertiChain: certificate already registered");
    });

    it("rejects duplicate certificateId registration", async () => {
      await registry.registerCertificate(certId1, certHash1);
      await expect(
        registry.registerCertificate(certId1, certHash2)
      ).to.be.revertedWith("CertiChain: certificateId already registered");
    });

    it("rejects registration from unauthorized address", async () => {
      await expect(
        registry.connect(unauthorized).registerCertificate(certId1, certHash1)
      ).to.be.revertedWith("CertiChain: caller is not authorized");
    });
  });

  describe("verifyCertificate()", () => {
    beforeEach(async () => {
      await registry.registerCertificate(certId1, certHash1);
    });

    it("returns exists=true and revoked=false for a registered hash", async () => {
      const [exists, revoked, issuer, timestamp, certId] =
        await registry.verifyCertificate(certHash1);

      expect(exists).to.equal(true);
      expect(revoked).to.equal(false);
      expect(issuer).to.equal(owner.address);
      expect(timestamp).to.be.gt(0);
      expect(certId).to.equal(certId1);
    });

    it("returns exists=false for an unregistered hash", async () => {
      const wrongHash = fakeHash("wrong-certificate-data");
      const [exists] = await registry.verifyCertificate(wrongHash);
      expect(exists).to.equal(false);
    });

    it("isValid() returns true for registered, non-revoked certificate", async () => {
      expect(await registry.isValid(certHash1)).to.equal(true);
    });

    it("isValid() returns false for unregistered hash", async () => {
      expect(await registry.isValid(fakeHash("nonexistent"))).to.equal(false);
    });
  });

  describe("revokeCertificate()", () => {
    beforeEach(async () => {
      await registry.registerCertificate(certId1, certHash1);
    });

    it("owner can revoke a certificate", async () => {
      await expect(registry.revokeCertificate(certHash1))
        .to.emit(registry, "CertificateRevoked");

      const [exists, revoked] = await registry.verifyCertificate(certHash1);
      expect(exists).to.equal(true);
      expect(revoked).to.equal(true);
    });

    it("isValid() returns false after revocation", async () => {
      await registry.revokeCertificate(certHash1);
      expect(await registry.isValid(certHash1)).to.equal(false);
    });

    it("cannot revoke an already-revoked certificate", async () => {
      await registry.revokeCertificate(certHash1);
      await expect(
        registry.revokeCertificate(certHash1)
      ).to.be.revertedWith("CertiChain: certificate already revoked");
    });

    it("cannot revoke a non-existent certificate", async () => {
      await expect(
        registry.revokeCertificate(fakeHash("nonexistent"))
      ).to.be.revertedWith("CertiChain: certificate not found");
    });

    it("rejects revocation from unauthorized address", async () => {
      await expect(
        registry.connect(unauthorized).revokeCertificate(certHash1)
      ).to.be.revertedWith("CertiChain: caller is not authorized");
    });
  });

  describe("Issuer authorization", () => {
    it("owner can authorize and de-authorize issuers", async () => {
      await registry.authorizeIssuer(authorized.address);
      expect(await registry.authorizedIssuers(authorized.address)).to.equal(true);

      await registry.revokeIssuer(authorized.address);
      expect(await registry.authorizedIssuers(authorized.address)).to.equal(false);
    });

    it("non-owner cannot authorize issuers", async () => {
      await expect(
        registry.connect(unauthorized).authorizeIssuer(unauthorized.address)
      ).to.be.revertedWith("CertiChain: caller is not the owner");
    });

    it("de-authorized issuer cannot register new certificates", async () => {
      await registry.authorizeIssuer(authorized.address);
      await registry.revokeIssuer(authorized.address);

      await expect(
        registry.connect(authorized).registerCertificate(certId1, certHash1)
      ).to.be.revertedWith("CertiChain: caller is not authorized");
    });
  });
});
```
