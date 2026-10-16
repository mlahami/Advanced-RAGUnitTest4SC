# agri-bridge-traceability--mrnobody23-cloude

- domain: supply-chain (supply-chain)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/MrNobody23-cloude/AgriBridge @ 6103633fc475aac636c9505926f087e1ccb5e766
- license: MIT
- targets: AgriBridgeTraceability.sol
- validation: 13 passing tests, 0 failing; statement coverage AgriBridgeTraceability.sol 100.0 %

## Contract: AgriBridgeTraceability.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgriBridgeTraceability
 * @notice Immutable agricultural supply chain traceability registry on Polygon.
 *
 * Role hierarchy:
 *  - ADMIN  : can grant/revoke any role
 *  - FARMER : registers batches
 *  - EXPORTER / TRANSPORTER / IMPORTER / RETAILER / REGULATOR : add events
 *
 * All role management is on-chain and emits events for off-chain indexing.
 */
contract AgriBridgeTraceability {
    // ── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant ADMIN_ROLE      = keccak256("ADMIN_ROLE");
    bytes32 public constant FARMER_ROLE     = keccak256("FARMER_ROLE");
    bytes32 public constant EXPORTER_ROLE   = keccak256("EXPORTER_ROLE");
    bytes32 public constant TRANSPORTER_ROLE = keccak256("TRANSPORTER_ROLE");
    bytes32 public constant IMPORTER_ROLE   = keccak256("IMPORTER_ROLE");
    bytes32 public constant RETAILER_ROLE   = keccak256("RETAILER_ROLE");
    bytes32 public constant REGULATOR_ROLE  = keccak256("REGULATOR_ROLE");

    mapping(bytes32 => mapping(address => bool)) private _roles;

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed grantor);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed revoker);

    // ── Data Structures ──────────────────────────────────────────────────────
    struct BatchRecord {
        string  batchId;
        string  cryptographicHash;
        uint256 timestamp;
        address registeredBy;
        bool    exists;
    }

    struct SupplyChainEvent {
        string  eventType;
        string  actorRole;
        string  location;
        string  metadata;
        uint256 timestamp;
        address recordedBy;
    }

    mapping(string => BatchRecord)         private batches;
    mapping(string => SupplyChainEvent[])  private batchEvents;

    // ── On-chain Events ──────────────────────────────────────────────────────
    event BatchRegistered(
        string  indexed batchId,
        string          cryptographicHash,
        address indexed registeredBy,
        uint256         timestamp
    );

    event SupplyChainEventAdded(
        string  indexed batchId,
        string          eventType,
        string          actorRole,
        string          location,
        address indexed recordedBy,
        uint256         timestamp
    );

    // ── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyRole(bytes32 role) {
        require(_roles[role][msg.sender], "AgriBridge: caller does not have required role");
        _;
    }

    modifier onlyAdmin() {
        require(_roles[ADMIN_ROLE][msg.sender], "AgriBridge: caller is not an admin");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────
    constructor() {
        // Deployer receives ADMIN role so they can seed initial roles
        _roles[ADMIN_ROLE][msg.sender] = true;
        emit RoleGranted(ADMIN_ROLE, msg.sender, msg.sender);
    }

    // ── Role Management ──────────────────────────────────────────────────────

    /**
     * @dev Grant a role to an account. Only ADMIN can call this.
     */
    function grantRole(bytes32 role, address account) external onlyAdmin {
        require(account != address(0), "AgriBridge: zero address");
        require(!_roles[role][account], "AgriBridge: role already granted");
        _roles[role][account] = true;
        emit RoleGranted(role, account, msg.sender);
    }

    /**
     * @dev Revoke a role from an account. Only ADMIN can call this.
     *      An admin cannot revoke their own ADMIN role (prevents lockout).
     */
    function revokeRole(bytes32 role, address account) external onlyAdmin {
        require(_roles[role][account], "AgriBridge: account does not have role");
        if (role == ADMIN_ROLE) {
            require(account != msg.sender, "AgriBridge: cannot self-revoke ADMIN_ROLE");
        }
        _roles[role][account] = false;
        emit RoleRevoked(role, account, msg.sender);
    }

    /**
     * @dev Check whether an account has a specific role.
     */
    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    // ── Batch Operations ─────────────────────────────────────────────────────

    /**
     * @dev Register a new crop batch. Caller must have FARMER_ROLE.
     *      The SHA-256 cryptographic hash is computed off-chain and stored here
     *      for tamper-evident integrity checking.
     */
    function registerBatch(
        string memory _batchId,
        string memory _cryptographicHash
    ) external onlyRole(FARMER_ROLE) {
        require(!batches[_batchId].exists,      "AgriBridge: Batch ID already registered");
        require(bytes(_batchId).length > 0,      "AgriBridge: Invalid Batch ID");
        require(bytes(_cryptographicHash).length > 0, "AgriBridge: Invalid Cryptographic Hash");

        batches[_batchId] = BatchRecord({
            batchId:           _batchId,
            cryptographicHash: _cryptographicHash,
            timestamp:         block.timestamp,
            registeredBy:      msg.sender,
            exists:            true
        });

        batchEvents[_batchId].push(SupplyChainEvent({
            eventType:   "FARM_REGISTERED",
            actorRole:   "FARMER",
            location:    "Farm Origin",
            metadata:    _cryptographicHash,
            timestamp:   block.timestamp,
            recordedBy:  msg.sender
        }));

        emit BatchRegistered(_batchId, _cryptographicHash, msg.sender, block.timestamp);
    }

    /**
     * @dev Add a supply chain event. Callable by any authorised supply chain participant.
     *      Valid roles: FARMER, EXPORTER, TRANSPORTER, IMPORTER, RETAILER, REGULATOR.
     */
    function addSupplyChainEvent(
        string memory _batchId,
        string memory _eventType,
        string memory _actorRole,
        string memory _location,
        string memory _metadata
    ) external {
        require(batches[_batchId].exists, "AgriBridge: Batch ID does not exist");
        require(
            _roles[FARMER_ROLE][msg.sender]      ||
            _roles[EXPORTER_ROLE][msg.sender]    ||
            _roles[TRANSPORTER_ROLE][msg.sender] ||
            _roles[IMPORTER_ROLE][msg.sender]    ||
            _roles[RETAILER_ROLE][msg.sender]    ||
            _roles[REGULATOR_ROLE][msg.sender]   ||
            _roles[ADMIN_ROLE][msg.sender],
            "AgriBridge: caller does not have a supply chain role"
        );

        batchEvents[_batchId].push(SupplyChainEvent({
            eventType:  _eventType,
            actorRole:  _actorRole,
            location:   _location,
            metadata:   _metadata,
            timestamp:  block.timestamp,
            recordedBy: msg.sender
        }));

        emit SupplyChainEventAdded(
            _batchId, _eventType, _actorRole, _location, msg.sender, block.timestamp
        );
    }

    // ── Read-only Queries ────────────────────────────────────────────────────

    /**
     * @dev Verify batch existence and return core record fields.
     */
    function verifyBatch(string memory _batchId) external view returns (
        string  memory cryptographicHash,
        uint256        timestamp,
        address        registeredBy,
        bool           exists
    ) {
        BatchRecord memory r = batches[_batchId];
        return (r.cryptographicHash, r.timestamp, r.registeredBy, r.exists);
    }

    /**
     * @dev Return the stored SHA-256 hash for a batch.
     */
    function getBatchHash(string memory _batchId) external view returns (string memory) {
        require(batches[_batchId].exists, "AgriBridge: Batch ID does not exist");
        return batches[_batchId].cryptographicHash;
    }

    /**
     * @dev Return the total number of recorded supply chain events for a batch.
     */
    function getBatchEventsCount(string memory _batchId) external view returns (uint256) {
        return batchEvents[_batchId].length;
    }

    /**
     * @dev Return a specific supply chain event by index.
     */
    function getBatchEvent(
        string memory _batchId,
        uint256       _index
    ) external view returns (
        string  memory eventType,
        string  memory actorRole,
        string  memory location,
        string  memory metadata,
        uint256        timestamp,
        address        recordedBy
    ) {
        require(batches[_batchId].exists, "AgriBridge: Batch ID does not exist");
        require(_index < batchEvents[_batchId].length, "AgriBridge: Index out of bounds");
        SupplyChainEvent memory ev = batchEvents[_batchId][_index];
        return (ev.eventType, ev.actorRole, ev.location, ev.metadata, ev.timestamp, ev.recordedBy);
    }
}
```

## Tests: AgriBridgeTraceability.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgriBridgeTraceability Contract", function () {
    let contract;
    let owner, farmer, exporter, transporter, regulator, stranger;

    const FARMER_ROLE     = ethers.keccak256(ethers.toUtf8Bytes("FARMER_ROLE"));
    const EXPORTER_ROLE   = ethers.keccak256(ethers.toUtf8Bytes("EXPORTER_ROLE"));
    const TRANSPORTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TRANSPORTER_ROLE"));
    const REGULATOR_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("REGULATOR_ROLE"));
    const ADMIN_ROLE      = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));

    beforeEach(async function () {
        [owner, farmer, exporter, transporter, regulator, stranger] = await ethers.getSigners();
        const ContractFactory = await ethers.getContractFactory("AgriBridgeTraceability");
        contract = await ContractFactory.deploy();
        await contract.waitForDeployment();

        // Grant supply chain roles
        await contract.grantRole(FARMER_ROLE,     farmer.address);
        await contract.grantRole(EXPORTER_ROLE,   exporter.address);
        await contract.grantRole(TRANSPORTER_ROLE, transporter.address);
        await contract.grantRole(REGULATOR_ROLE,  regulator.address);
    });

    // ── Role Management ─────────────────────────────────────────────────────

    it("Deployer has ADMIN_ROLE", async function () {
        expect(await contract.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Admin can grant and revoke roles", async function () {
        await contract.grantRole(FARMER_ROLE, stranger.address);
        expect(await contract.hasRole(FARMER_ROLE, stranger.address)).to.be.true;

        await contract.revokeRole(FARMER_ROLE, stranger.address);
        expect(await contract.hasRole(FARMER_ROLE, stranger.address)).to.be.false;
    });

    it("Non-admin cannot grant roles", async function () {
        await expect(
            contract.connect(stranger).grantRole(FARMER_ROLE, stranger.address)
        ).to.be.revertedWith("AgriBridge: caller is not an admin");
    });

    it("Admin cannot self-revoke ADMIN_ROLE (lockout prevention)", async function () {
        await expect(
            contract.revokeRole(ADMIN_ROLE, owner.address)
        ).to.be.revertedWith("AgriBridge: cannot self-revoke ADMIN_ROLE");
    });

    // ── Batch Registration ───────────────────────────────────────────────────

    it("Farmer can register a batch with SHA-256 hash", async function () {
        const batchId   = "AGR-2026-UK-001";
        const sha256Hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

        await contract.connect(farmer).registerBatch(batchId, sha256Hash);

        const retrievedHash = await contract.getBatchHash(batchId);
        expect(retrievedHash).to.equal(sha256Hash);

        const [hash, , registeredBy, exists] = await contract.verifyBatch(batchId);
        expect(exists).to.be.true;
        expect(hash).to.equal(sha256Hash);
        expect(registeredBy).to.equal(farmer.address);
    });

    it("Non-farmer cannot register a batch", async function () {
        await expect(
            contract.connect(stranger).registerBatch("AGR-HACK-999", "0xdeadbeef")
        ).to.be.revertedWith("AgriBridge: caller does not have required role");
    });

    it("Duplicate batch registration is rejected", async function () {
        const batchId = "AGR-2026-EU-002";
        const hash    = "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3";

        await contract.connect(farmer).registerBatch(batchId, hash);

        await expect(
            contract.connect(farmer).registerBatch(batchId, hash)
        ).to.be.revertedWith("AgriBridge: Batch ID already registered");
    });

    // ── Supply Chain Events ──────────────────────────────────────────────────

    it("Exporter can add a supply chain event", async function () {
        const batchId = "AGR-2026-UK-003";
        const hash    = "b94a8fe5ccb19ba61c4c0873d391e987982fbbd4";

        await contract.connect(farmer).registerBatch(batchId, hash);
        await contract.connect(exporter).addSupplyChainEvent(
            batchId, "EXPORTED", "EXPORTER", "JNPT Port Mumbai", "Container MAEU9912"
        );

        const count = await contract.getBatchEventsCount(batchId);
        expect(count).to.equal(2n); // FARM_REGISTERED + EXPORTED

        const [eventType, actorRole, location] = await contract.getBatchEvent(batchId, 1);
        expect(eventType).to.equal("EXPORTED");
        expect(actorRole).to.equal("EXPORTER");
        expect(location).to.equal("JNPT Port Mumbai");
    });

    it("Transporter can add a transit event", async function () {
        const batchId = "AGR-2026-EU-004";
        const hash    = "c04a8fe5ccb19ba61c4c0873d391e987982fbbd5";

        await contract.connect(farmer).registerBatch(batchId, hash);
        await contract.connect(transporter).addSupplyChainEvent(
            batchId, "IN_TRANSIT", "TRANSPORTER", "Arabian Sea", "Temp: 12.5°C"
        );

        const count = await contract.getBatchEventsCount(batchId);
        expect(count).to.equal(2n);
    });

    it("Regulator can add an inspection event", async function () {
        const batchId = "AGR-2026-US-005";
        const hash    = "d14a8fe5ccb19ba61c4c0873d391e987982fbbd6";

        await contract.connect(farmer).registerBatch(batchId, hash);
        await contract.connect(regulator).addSupplyChainEvent(
            batchId, "INSPECTED", "REGULATOR", "UK Border Control", "Grade A — Passed"
        );

        const count = await contract.getBatchEventsCount(batchId);
        expect(count).to.equal(2n);
    });

    it("Stranger without any role cannot add events", async function () {
        const batchId = "AGR-2026-UK-006";
        const hash    = "e24a8fe5ccb19ba61c4c0873d391e987982fbbd7";

        await contract.connect(farmer).registerBatch(batchId, hash);

        await expect(
            contract.connect(stranger).addSupplyChainEvent(
                batchId, "MALICIOUS", "HACKER", "Unknown", "inject"
            )
        ).to.be.revertedWith("AgriBridge: caller does not have a supply chain role");
    });

    it("Adding event to non-existent batch is rejected", async function () {
        await expect(
            contract.connect(exporter).addSupplyChainEvent(
                "FAKE-BATCH", "EXPORTED", "EXPORTER", "Nowhere", ""
            )
        ).to.be.revertedWith("AgriBridge: Batch ID does not exist");
    });

    it("getBatchEvent bounds check works", async function () {
        const batchId = "AGR-2026-UK-007";
        const hash    = "f34a8fe5ccb19ba61c4c0873d391e987982fbbd8";

        await contract.connect(farmer).registerBatch(batchId, hash);

        await expect(
            contract.getBatchEvent(batchId, 99)
        ).to.be.revertedWith("AgriBridge: Index out of bounds");
    });
});
```
