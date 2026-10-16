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
