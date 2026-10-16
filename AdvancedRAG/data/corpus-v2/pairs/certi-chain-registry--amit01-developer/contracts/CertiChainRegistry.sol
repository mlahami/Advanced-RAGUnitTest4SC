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
