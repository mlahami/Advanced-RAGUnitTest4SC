# evidence-registry--shreyas0047

- domain: registries-identity (registry)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Shreyas0047/NyxTrace @ 9e2f1c23b9590f620fcc1988d65b4641c4cb6dbb
- license: MIT
- targets: EvidenceRegistry.sol
- validation: 29 passing tests, 0 failing; statement coverage EvidenceRegistry.sol 97.67 %

## Contract: EvidenceRegistry.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract EvidenceRegistry {

    // ──────────────────────────────────────────────
    // Evidence State Machine
    // ──────────────────────────────────────────────
    uint8 public constant STATE_PENDING = 0;
    uint8 public constant STATE_REGISTERED = 1;
    uint8 public constant STATE_TRANSFERRED = 2;
    uint8 public constant STATE_LOCKED = 3;

    // ──────────────────────────────────────────────
    // Structs — Evidence
    // ──────────────────────────────────────────────
    struct EvidenceData {
        string evidenceId;
        bytes32 evidenceHash;
        uint256 timestamp;
        address investigator;
        string investigationId;
        uint8 verificationStatus;
        bytes metadata;
    }

    struct VerificationRecord {
        string evidenceId;
        address verifier;
        uint256 timestamp;
        bool result;
        bytes32 expectedHash;
        bytes32 actualHash;
        uint8 status;
    }

    // ──────────────────────────────────────────────
    // Structs — Audit
    // ──────────────────────────────────────────────
    struct AuditEntry {
        uint8 category;
        uint8 severity;
        string description;
        address investigator;
        string investigationId;
        string evidenceId;
        uint256 timestamp;
        bytes metadata;
        bytes32 eventHash;
    }

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────
    address public owner;
    string public version = "1.0.0";
    uint256 public evidenceCount;
    uint256 public auditEntryCount;

    mapping(string => EvidenceData) private _evidence;
    mapping(string => VerificationRecord[]) private _verificationHistory;
    mapping(string => bool) private _evidenceExists;
    string[] private _allEvidenceIds;
    mapping(string => string[]) private _investigationEvidenceIds;

    AuditEntry[] private _auditEntries;
    mapping(string => uint256[]) private _investigationAuditIndices;
    mapping(string => uint256[]) private _evidenceAuditIndices;

    // ──────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier evidenceNotRegistered(string memory _evidenceId) {
        require(!_evidenceExists[_evidenceId], "Evidence already registered");
        _;
    }

    modifier evidenceExists(string memory _evidenceId) {
        require(_evidenceExists[_evidenceId], "Evidence not found");
        _;
    }

    // ──────────────────────────────────────────────
    // Events — Evidence
    // ──────────────────────────────────────────────
    event EvidenceRegistered(
        string indexed evidenceId,
        bytes32 indexed evidenceHash,
        address indexed investigator,
        uint256 timestamp,
        string investigationId
    );

    event EvidenceVerified(
        string indexed evidenceId,
        address indexed verifier,
        bool indexed result,
        uint8 status,
        uint256 timestamp
    );

    event VerificationFailed(
        string indexed evidenceId,
        address indexed verifier,
        bytes32 expectedHash,
        bytes32 actualHash,
        uint256 timestamp
    );

    event EvidenceStatusUpdated(
        string indexed evidenceId,
        uint8 indexed oldStatus,
        uint8 indexed newStatus,
        address updater,
        uint256 timestamp
    );

    // ──────────────────────────────────────────────
    // Events — Audit
    // ──────────────────────────────────────────────
    event AuditEntryCreated(
        uint256 indexed entryIndex,
        uint8 indexed category,
        uint8 indexed severity,
        address investigator,
        uint256 timestamp
    );

    event CriticalAuditEvent(
        uint256 indexed entryIndex,
        string description,
        address indexed investigator,
        uint256 timestamp
    );

    event VerificationAuditEvent(
        uint256 indexed entryIndex,
        string indexed evidenceId,
        bool indexed success,
        address investigator,
        uint256 timestamp
    );

    event EvidenceAuditEvent(
        uint256 indexed entryIndex,
        string indexed evidenceId,
        string action,
        address indexed investigator,
        uint256 timestamp
    );

    // ──────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
    }

    // ──────────────────────────────────────────────
    // Evidence — Write Functions
    // ──────────────────────────────────────────────

    function registerEvidence(
        string memory _evidenceId,
        bytes32 _evidenceHash,
        string memory _investigationId,
        bytes memory _metadata
    ) external evidenceNotRegistered(_evidenceId) returns (bool) {
        _evidence[_evidenceId] = EvidenceData({
            evidenceId: _evidenceId,
            evidenceHash: _evidenceHash,
            timestamp: block.timestamp,
            investigator: msg.sender,
            investigationId: _investigationId,
            verificationStatus: STATE_REGISTERED,
            metadata: _metadata
        });

        _evidenceExists[_evidenceId] = true;
        _allEvidenceIds.push(_evidenceId);
        _investigationEvidenceIds[_investigationId].push(_evidenceId);
        evidenceCount++;

        emit EvidenceRegistered(
            _evidenceId,
            _evidenceHash,
            msg.sender,
            block.timestamp,
            _investigationId
        );

        return true;
    }

    function batchRegisterEvidence(
        string[] memory _evidenceIds,
        bytes32[] memory _evidenceHashes,
        string memory _investigationId
    ) external onlyOwner returns (bool) {
        require(_evidenceIds.length == _evidenceHashes.length, "Array length mismatch");

        for (uint256 i = 0; i < _evidenceIds.length; i++) {
            if (!_evidenceExists[_evidenceIds[i]]) {
                _evidence[_evidenceIds[i]] = EvidenceData({
                    evidenceId: _evidenceIds[i],
                    evidenceHash: _evidenceHashes[i],
                    timestamp: block.timestamp,
                    investigator: msg.sender,
                    investigationId: _investigationId,
                    verificationStatus: STATE_REGISTERED,
                    metadata: ""
                });

                _evidenceExists[_evidenceIds[i]] = true;
                _allEvidenceIds.push(_evidenceIds[i]);
                _investigationEvidenceIds[_investigationId].push(_evidenceIds[i]);
                evidenceCount++;

                emit EvidenceRegistered(
                    _evidenceIds[i],
                    _evidenceHashes[i],
                    msg.sender,
                    block.timestamp,
                    _investigationId
                );
            }
        }

        return true;
    }

    function verifyEvidence(
        string memory _evidenceId,
        bytes32 _hashToVerify
    ) external evidenceExists(_evidenceId) returns (bool, uint8) {
        EvidenceData storage ev = _evidence[_evidenceId];
        bool matchResult = (ev.evidenceHash == _hashToVerify);

        uint8 newStatus = matchResult ? STATE_REGISTERED : STATE_PENDING;

        _verificationHistory[_evidenceId].push(VerificationRecord({
            evidenceId: _evidenceId,
            verifier: msg.sender,
            timestamp: block.timestamp,
            result: matchResult,
            expectedHash: ev.evidenceHash,
            actualHash: _hashToVerify,
            status: newStatus
        }));

        emit EvidenceVerified(
            _evidenceId,
            msg.sender,
            matchResult,
            newStatus,
            block.timestamp
        );

        if (!matchResult) {
            emit VerificationFailed(
                _evidenceId,
                msg.sender,
                ev.evidenceHash,
                _hashToVerify,
                block.timestamp
            );
        }

        return (matchResult, newStatus);
    }

    function updateEvidenceStatus(
        string memory _evidenceId,
        uint8 _newStatus
    ) external onlyOwner evidenceExists(_evidenceId) returns (bool) {
        EvidenceData storage ev = _evidence[_evidenceId];
        uint8 oldStatus = ev.verificationStatus;

        require(_newStatus <= STATE_LOCKED, "Invalid status");
        require(
            _isValidTransition(oldStatus, _newStatus),
            "Invalid state transition"
        );

        ev.verificationStatus = _newStatus;

        emit EvidenceStatusUpdated(
            _evidenceId,
            oldStatus,
            _newStatus,
            msg.sender,
            block.timestamp
        );

        return true;
    }

    function markEvidenceInvalid(
        string memory _evidenceId,
        string memory /* _reason */
    ) external onlyOwner evidenceExists(_evidenceId) returns (bool) {
        EvidenceData storage ev = _evidence[_evidenceId];
        uint8 oldStatus = ev.verificationStatus;
        ev.verificationStatus = STATE_PENDING;

        emit EvidenceStatusUpdated(
            _evidenceId,
            oldStatus,
            STATE_PENDING,
            msg.sender,
            block.timestamp
        );

        return true;
    }

    // ──────────────────────────────────────────────
    // Evidence — Read Functions
    // ──────────────────────────────────────────────

    function getEvidence(
        string memory _evidenceId
    ) external view evidenceExists(_evidenceId) returns (EvidenceData memory) {
        return _evidence[_evidenceId];
    }

    function getEvidenceHash(
        string memory _evidenceId
    ) external view evidenceExists(_evidenceId) returns (bytes32) {
        return _evidence[_evidenceId].evidenceHash;
    }

    function getEvidenceStatus(
        string memory _evidenceId
    ) external view evidenceExists(_evidenceId) returns (uint8) {
        return _evidence[_evidenceId].verificationStatus;
    }

    function checkEvidenceExists(
        string memory _evidenceId
    ) external view returns (bool) {
        return _evidenceExists[_evidenceId];
    }

    function getVerificationHistory(
        string memory _evidenceId
    ) external view evidenceExists(_evidenceId) returns (VerificationRecord[] memory) {
        return _verificationHistory[_evidenceId];
    }

    function getAllEvidenceIds() external view returns (string[] memory) {
        return _allEvidenceIds;
    }

    function getInvestigationEvidenceCount(
        string memory _investigationId
    ) external view returns (uint256) {
        return _investigationEvidenceIds[_investigationId].length;
    }

    function getContractInfo()
        external
        view
        returns (string memory, address, uint256)
    {
        return (version, owner, evidenceCount);
    }

    // ──────────────────────────────────────────────
    // Audit — Write Functions
    // ──────────────────────────────────────────────

    function createAuditEntry(
        uint8 _category,
        uint8 _severity,
        string memory _description,
        string memory _investigationId,
        string memory _evidenceId,
        bytes memory _metadata
    ) public onlyOwner returns (uint256) {
        bytes32 eventHash = keccak256(
            abi.encodePacked(
                _category,
                _severity,
                _description,
                _investigationId,
                _evidenceId,
                block.timestamp,
                msg.sender
            )
        );

        uint256 index = auditEntryCount;

        _auditEntries.push(AuditEntry({
            category: _category,
            severity: _severity,
            description: _description,
            investigator: msg.sender,
            investigationId: _investigationId,
            evidenceId: _evidenceId,
            timestamp: block.timestamp,
            metadata: _metadata,
            eventHash: eventHash
        }));

        if (bytes(_investigationId).length > 0) {
            _investigationAuditIndices[_investigationId].push(index);
        }

        if (bytes(_evidenceId).length > 0) {
            _evidenceAuditIndices[_evidenceId].push(index);
        }

        auditEntryCount++;

        emit AuditEntryCreated(index, _category, _severity, msg.sender, block.timestamp);

        if (_severity >= 2) {
            emit CriticalAuditEvent(index, _description, msg.sender, block.timestamp);
        }

        return index;
    }

    function recordEvidenceRegistration(
        string memory _evidenceId,
        string memory _investigationId,
        bytes32 _hash
    ) public returns (uint256) {
        return createAuditEntry(0, 0, "Evidence registered", _investigationId, _evidenceId, abi.encode(_hash));
    }

    function recordVerificationResult(
        string memory _evidenceId,
        string memory _investigationId,
        bool _success,
        bytes32 _expectedHash,
        bytes32 _actualHash
    ) public returns (uint256) {
        uint8 severity = _success ? 0 : 2;
        string memory desc = _success ? "Verification passed" : "Verification failed - hash mismatch";

        uint256 index = createAuditEntry(1, severity, desc, _investigationId, _evidenceId, abi.encode(_expectedHash, _actualHash));

        emit VerificationAuditEvent(index, _evidenceId, _success, msg.sender, block.timestamp);

        return index;
    }

    function recordTamperDetection(
        string memory _evidenceId,
        string memory _investigationId,
        bytes32 _expectedHash,
        bytes32 _actualHash
    ) public onlyOwner returns (uint256) {
        uint256 index = createAuditEntry(2, 3, "TAMPER DETECTED", _investigationId, _evidenceId, abi.encode(_expectedHash, _actualHash));

        emit CriticalAuditEvent(index, "TAMPER DETECTED", msg.sender, block.timestamp);
        emit EvidenceAuditEvent(index, _evidenceId, "tamper_detected", msg.sender, block.timestamp);

        return index;
    }

    function recordSystemEvent(
        string memory _description,
        bytes memory _metadata
    ) public onlyOwner returns (uint256) {
        return createAuditEntry(3, 0, _description, "", "", _metadata);
    }

    // ──────────────────────────────────────────────
    // Audit — Read Functions
    // ──────────────────────────────────────────────

    function getAuditEntry(
        uint256 _index
    ) external view returns (AuditEntry memory) {
        require(_index < auditEntryCount, "Index out of bounds");
        return _auditEntries[_index];
    }

    function getInvestigationAudit(
        string memory _investigationId
    ) external view returns (AuditEntry[] memory) {
        uint256[] storage indices = _investigationAuditIndices[_investigationId];
        AuditEntry[] memory result = new AuditEntry[](indices.length);
        for (uint256 i = 0; i < indices.length; i++) {
            result[i] = _auditEntries[indices[i]];
        }
        return result;
    }

    function getEvidenceAudit(
        string memory _evidenceId
    ) external view returns (AuditEntry[] memory) {
        uint256[] storage indices = _evidenceAuditIndices[_evidenceId];
        AuditEntry[] memory result = new AuditEntry[](indices.length);
        for (uint256 i = 0; i < indices.length; i++) {
            result[i] = _auditEntries[indices[i]];
        }
        return result;
    }

    function getRecentAuditEntries(
        uint256 _count
    ) external view returns (AuditEntry[] memory) {
        if (_count == 0) return new AuditEntry[](0);

        uint256 start = _count >= auditEntryCount ? 0 : auditEntryCount - _count;
        uint256 size = auditEntryCount - start;

        AuditEntry[] memory result = new AuditEntry[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = _auditEntries[start + i];
        }
        return result;
    }

    // ──────────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────────

    function _isValidTransition(
        uint8 _current,
        uint8 _next
    ) internal pure returns (bool) {
        if (_current == STATE_PENDING && _next == STATE_REGISTERED) return true;
        if (_current == STATE_REGISTERED && (_next == STATE_TRANSFERRED || _next == STATE_LOCKED)) return true;
        if (_current == STATE_TRANSFERRED && _next == STATE_LOCKED) return true;
        return false;
    }
}
```

## Tests: EvidenceRegistry.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe('EvidenceRegistry', function () {
  let registry;
  let owner;
  let investigator;
  let verifier;

  const evidenceId = 'ev-001';
  const evidenceHash = ethers.hexlify(ethers.randomBytes(32));
  const investigationId = 'inv-001';
  const metadata = ethers.toUtf8Bytes('test-metadata');

  beforeEach(async function () {
    [owner, investigator, verifier] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('EvidenceRegistry');
    registry = await factory.deploy();
    await registry.waitForDeployment();
  });

  describe('Contract Info', function () {
    it('should return correct contract info', async function () {
      const info = await registry.getContractInfo();
      expect(info[0]).to.equal('1.0.0');
      expect(info[1]).to.equal(owner.address);
      expect(info[2]).to.equal(0n);
    });

    it('should have owner set to deployer', async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it('should have evidenceCount starting at 0', async function () {
      expect(await registry.evidenceCount()).to.equal(0n);
    });
  });

  describe('Evidence Registration', function () {
    it('should register evidence and emit event', async function () {
      const tx = await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await expect(tx)
        .to.emit(registry, 'EvidenceRegistered')
        .withArgs(evidenceId, evidenceHash, investigator.address, anyValue, investigationId);

      expect(await registry.evidenceCount()).to.equal(1n);
      expect(await registry.checkEvidenceExists(evidenceId)).to.be.true;
    });

    it('should reject duplicate registration', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await expect(
        registry.connect(investigator).registerEvidence(
          evidenceId, evidenceHash, investigationId, metadata
        )
      ).to.be.revertedWith('Evidence already registered');
    });

    it('should store evidence data correctly', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );

      const ev = await registry.getEvidence(evidenceId);
      expect(ev.evidenceId).to.equal(evidenceId);
      expect(ev.evidenceHash).to.equal(evidenceHash);
      expect(ev.investigator).to.equal(investigator.address);
      expect(ev.investigationId).to.equal(investigationId);
      expect(ev.verificationStatus).to.equal(1n);
    });

    it('should return correct hash and status', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      expect(await registry.getEvidenceHash(evidenceId)).to.equal(evidenceHash);
      expect(await registry.getEvidenceStatus(evidenceId)).to.equal(1n);
    });

    it('should batch register evidence and emit for each', async function () {
      const ids = ['ev-001', 'ev-002', 'ev-003'];
      const hashes = [
        ethers.hexlify(ethers.randomBytes(32)),
        ethers.hexlify(ethers.randomBytes(32)),
        ethers.hexlify(ethers.randomBytes(32)),
      ];

      const tx = await registry.connect(owner).batchRegisterEvidence(
        ids, hashes, investigationId
      );
      await expect(tx).to.emit(registry, 'EvidenceRegistered').withArgs(
        ids[2], hashes[2], owner.address, anyValue, investigationId
      );

      expect(await registry.evidenceCount()).to.equal(3n);
      expect(await registry.getInvestigationEvidenceCount(investigationId)).to.equal(3n);
    });
  });

  describe('Evidence Verification', function () {
    beforeEach(async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
    });

    it('should verify evidence with matching hash', async function () {
      await registry.verifyEvidence(evidenceId, evidenceHash);
      const history = await registry.getVerificationHistory(evidenceId);
      expect(history.length).to.equal(1n);
      expect(history[0].result).to.be.true;
    });

    it('should fail verification with non-matching hash', async function () {
      const badHash = ethers.hexlify(ethers.randomBytes(32));
      await registry.verifyEvidence(evidenceId, badHash);
      const history = await registry.getVerificationHistory(evidenceId);
      expect(history.length).to.equal(1n);
      expect(history[0].result).to.be.false;
    });

    it('should emit VerificationFailed on mismatch', async function () {
      const badHash = ethers.hexlify(ethers.randomBytes(32));
      const tx = await registry.connect(verifier).verifyEvidence(evidenceId, badHash);
      await expect(tx)
        .to.emit(registry, 'VerificationFailed')
        .withArgs(evidenceId, verifier.address, evidenceHash, badHash, anyValue);
    });

    it('should store verification history', async function () {
      await registry.verifyEvidence(evidenceId, evidenceHash);

      const history = await registry.getVerificationHistory(evidenceId);
      expect(history.length).to.equal(1n);
      expect(history[0].result).to.be.true;
      expect(history[0].expectedHash).to.equal(evidenceHash);
    });

    it('should reject verification for non-existent evidence', async function () {
      await expect(
        registry.verifyEvidence('nonexistent', evidenceHash)
      ).to.be.revertedWith('Evidence not found');
    });
  });

  describe('State Transitions', function () {
    it('should transition REGISTERED -> TRANSFERRED', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await registry.updateEvidenceStatus(evidenceId, 2);
      expect(await registry.getEvidenceStatus(evidenceId)).to.equal(2n);
    });

    it('should transition REGISTERED -> LOCKED', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await registry.updateEvidenceStatus(evidenceId, 3);
      expect(await registry.getEvidenceStatus(evidenceId)).to.equal(3n);
    });

    it('should reject invalid transition REGISTERED -> PENDING', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await expect(
        registry.updateEvidenceStatus(evidenceId, 0)
      ).to.be.revertedWith('Invalid state transition');
    });

    it('should emit EvidenceStatusUpdated on valid transition', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      const tx = await registry.updateEvidenceStatus(evidenceId, 2);
      await expect(tx)
        .to.emit(registry, 'EvidenceStatusUpdated')
        .withArgs(evidenceId, 1n, 2n, owner.address, anyValue);
    });

    it('should transition TRANSFERRED -> LOCKED', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await registry.updateEvidenceStatus(evidenceId, 2);
      await registry.updateEvidenceStatus(evidenceId, 3);
      expect(await registry.getEvidenceStatus(evidenceId)).to.equal(3n);
    });

    it('should reject LOCKED -> any', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await registry.updateEvidenceStatus(evidenceId, 3);
      await expect(
        registry.updateEvidenceStatus(evidenceId, 2)
      ).to.be.revertedWith('Invalid state transition');
    });

    it('should mark evidence as invalid', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await registry.markEvidenceInvalid(evidenceId, 'Compromised');
      expect(await registry.getEvidenceStatus(evidenceId)).to.equal(0n);
    });
  });

  describe('Audit', function () {
    it('should create and retrieve audit entry', async function () {
      const tx = await registry.createAuditEntry(
        0, 1, 'Test audit entry', investigationId, evidenceId, metadata
      );
      await expect(tx).to.emit(registry, 'AuditEntryCreated');

      const entry = await registry.getAuditEntry(0);
      expect(entry.category).to.equal(0n);
      expect(entry.severity).to.equal(1n);
      expect(entry.description).to.equal('Test audit entry');
      expect(entry.investigator).to.equal(owner.address);
    });

    it('should record evidence registration audit', async function () {
      const tx = await registry.recordEvidenceRegistration(
        evidenceId, investigationId, evidenceHash
      );
      await expect(tx).to.emit(registry, 'AuditEntryCreated');

      const audit = await registry.getEvidenceAudit(evidenceId);
      expect(audit.length).to.equal(1n);
    });

    it('should record verification result audit with event', async function () {
      const tx = await registry.recordVerificationResult(
        evidenceId, investigationId, true, evidenceHash, evidenceHash
      );
      await expect(tx)
        .to.emit(registry, 'VerificationAuditEvent')
        .withArgs(0n, evidenceId, true, owner.address, anyValue);
    });

    it('should record tamper detection audit', async function () {
      const badHash = ethers.hexlify(ethers.randomBytes(32));
      const tx = await registry.recordTamperDetection(
        evidenceId, investigationId, evidenceHash, badHash
      );
      await expect(tx).to.emit(registry, 'CriticalAuditEvent');
      await expect(tx).to.emit(registry, 'EvidenceAuditEvent');
    });

    it('should record system event', async function () {
      await registry.recordSystemEvent('System health check', ethers.toUtf8Bytes('ok'));
      expect(await registry.auditEntryCount()).to.equal(1n);
    });

    it('should get recent audit entries', async function () {
      for (let i = 0; i < 5; i++) {
        await registry.createAuditEntry(0, 0, `Entry ${i}`, '', '', ethers.toUtf8Bytes(''));
      }

      const recent = await registry.getRecentAuditEntries(3);
      expect(recent.length).to.equal(3n);
      expect(recent[0].description).to.equal('Entry 2');
      expect(recent[2].description).to.equal('Entry 4');
    });

    it('should get investigation audit entries', async function () {
      await registry.createAuditEntry(0, 0, 'Entry 1', 'inv-001', '', ethers.toUtf8Bytes(''));
      await registry.createAuditEntry(0, 0, 'Entry 2', 'inv-002', '', ethers.toUtf8Bytes(''));
      await registry.createAuditEntry(0, 0, 'Entry 3', 'inv-001', '', ethers.toUtf8Bytes(''));

      const audit = await registry.getInvestigationAudit('inv-001');
      expect(audit.length).to.equal(2n);
    });
  });

  describe('Evidence Listing', function () {
    it('should return all evidence IDs', async function () {
      const ids = ['ev-001', 'ev-002', 'ev-003'];
      for (const id of ids) {
        await registry.registerEvidence(
          id, ethers.hexlify(ethers.randomBytes(32)), investigationId, ethers.toUtf8Bytes('')
        );
      }

      const allIds = await registry.getAllEvidenceIds();
      expect(allIds.length).to.equal(3n);
    });

    it('should return investigation evidence count', async function () {
      await registry.registerEvidence('ev-001', ethers.hexlify(ethers.randomBytes(32)), 'inv-001', ethers.toUtf8Bytes(''));
      await registry.registerEvidence('ev-002', ethers.hexlify(ethers.randomBytes(32)), 'inv-002', ethers.toUtf8Bytes(''));
      await registry.registerEvidence('ev-003', ethers.hexlify(ethers.randomBytes(32)), 'inv-001', ethers.toUtf8Bytes(''));

      expect(await registry.getInvestigationEvidenceCount('inv-001')).to.equal(2n);
      expect(await registry.getInvestigationEvidenceCount('inv-002')).to.equal(1n);
    });
  });
});
```
