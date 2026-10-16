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
