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
