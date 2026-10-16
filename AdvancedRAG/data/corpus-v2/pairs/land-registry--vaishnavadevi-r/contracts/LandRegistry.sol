// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LandRegistry
 * @notice Educational blockchain-based land registry prototype.
 * @dev Uses only dummy/synthetic property data and test wallets.
 *
 * IMPORTANT:
 * This prototype does NOT create legally valid property ownership.
 * It demonstrates blockchain-based property registration,
 * verification, ownership transfer and audit history.
 */
contract LandRegistry {

    // ============================================================
    // ROLES
    // ============================================================

    address public admin;

    mapping(address => bool) public authorities;
    mapping(address => bool) public verifiers;

    // ============================================================
    // ENUMS
    // ============================================================

    enum PropertyStatus {
        REGISTERED,
        VERIFIED,
        TRANSFER_PENDING,
        TRANSFERRED,
        DISPUTED
    }

    // ============================================================
    // STRUCTS
    // ============================================================

    struct Property {
        uint256 propertyId;
        string propertyNumber;
        string location;
        uint256 area;
        string propertyType;
        address currentOwner;
        address previousOwner;
        bytes32 documentHash;
        bool verified;
        PropertyStatus status;
        uint256 registeredAt;
        uint256 lastTransferredAt;
    }

    // ============================================================
    // STORAGE
    // ============================================================

    mapping(uint256 => Property) private properties;

    mapping(address => uint256[]) private ownerProperties;

    mapping(uint256 => bool) private propertyExistsMapping;

    // ============================================================
    // EVENTS
    // ============================================================

    event PropertyRegistered(
        uint256 indexed propertyId,
        string propertyNumber,
        address indexed owner,
        uint256 timestamp
    );

    event PropertyVerified(
        uint256 indexed propertyId,
        address indexed verifier,
        uint256 timestamp
    );

    event OwnershipTransferred(
        uint256 indexed propertyId,
        address indexed previousOwner,
        address indexed newOwner,
        uint256 timestamp
    );

    event PropertyStatusUpdated(
        uint256 indexed propertyId,
        PropertyStatus status,
        uint256 timestamp
    );

    // ============================================================
    // MODIFIERS
    // ============================================================

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized: Admin only");
        _;
    }

    modifier onlyAuthority() {
        require(
            authorities[msg.sender] || msg.sender == admin,
            "Not authorized: Authority only"
        );
        _;
    }

    modifier onlyVerifier() {
        require(
            verifiers[msg.sender] || msg.sender == admin,
            "Not authorized: Verifier only"
        );
        _;
    }

    modifier propertyExistsModifier(uint256 _propertyId) {
        require(
            propertyExistsMapping[_propertyId],
            "Property does not exist"
        );
        _;
    }

    modifier onlyPropertyOwner(uint256 _propertyId) {
        require(
            properties[_propertyId].currentOwner == msg.sender,
            "Not authorized: Property owner only"
        );
        _;
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================

    constructor() {
        admin = msg.sender;

        // Admin is automatically an authority and verifier
        authorities[msg.sender] = true;
        verifiers[msg.sender] = true;
    }

    // ============================================================
    // ROLE MANAGEMENT
    // ============================================================

    function addAuthority(address _authority) external onlyAdmin {
        require(
            _authority != address(0),
            "Invalid authority address"
        );

        authorities[_authority] = true;
    }

    function removeAuthority(address _authority) external onlyAdmin {
        authorities[_authority] = false;
    }

    function addVerifier(address _verifier) external onlyAdmin {
        require(
            _verifier != address(0),
            "Invalid verifier address"
        );

        verifiers[_verifier] = true;
    }

    function removeVerifier(address _verifier) external onlyAdmin {
        verifiers[_verifier] = false;
    }

    // ============================================================
    // PROPERTY REGISTRATION
    // ============================================================

    function registerProperty(
        uint256 _propertyId,
        string calldata _propertyNumber,
        string calldata _location,
        uint256 _area,
        string calldata _propertyType,
        address _initialOwner,
        bytes32 _documentHash
    ) external onlyAuthority {

        require(
            !propertyExistsMapping[_propertyId],
            "Property already exists"
        );

        require(
            _initialOwner != address(0),
            "Owner cannot be zero address"
        );

        require(
            _propertyId > 0,
            "Invalid property ID"
        );

        require(
            _area > 0,
            "Area must be greater than zero"
        );

        require(
            bytes(_propertyNumber).length > 0,
            "Property number required"
        );

        require(
            bytes(_location).length > 0,
            "Location required"
        );

        require(
            bytes(_propertyType).length > 0,
            "Property type required"
        );

        require(
            _documentHash != bytes32(0),
            "Document hash required"
        );

        Property memory newProperty = Property({
            propertyId: _propertyId,
            propertyNumber: _propertyNumber,
            location: _location,
            area: _area,
            propertyType: _propertyType,
            currentOwner: _initialOwner,
            previousOwner: address(0),
            documentHash: _documentHash,
            verified: false,
            status: PropertyStatus.REGISTERED,
            registeredAt: block.timestamp,
            lastTransferredAt: 0
        });

        properties[_propertyId] = newProperty;

        propertyExistsMapping[_propertyId] = true;

        ownerProperties[_initialOwner].push(_propertyId);

        emit PropertyRegistered(
            _propertyId,
            _propertyNumber,
            _initialOwner,
            block.timestamp
        );
    }

    // ============================================================
    // PROPERTY VERIFICATION
    // ============================================================

    function verifyProperty(
        uint256 _propertyId
    )
        external
        onlyVerifier
        propertyExistsModifier(_propertyId)
    {
        require(
            !properties[_propertyId].verified,
            "Property already verified"
        );

        properties[_propertyId].verified = true;

        properties[_propertyId].status = PropertyStatus.VERIFIED;

        emit PropertyVerified(
            _propertyId,
            msg.sender,
            block.timestamp
        );

        emit PropertyStatusUpdated(
            _propertyId,
            PropertyStatus.VERIFIED,
            block.timestamp
        );
    }

    // ============================================================
    // OWNERSHIP TRANSFER
    // ============================================================

    function transferOwnership(
        uint256 _propertyId,
        address _newOwner
    )
        external
        propertyExistsModifier(_propertyId)
        onlyPropertyOwner(_propertyId)
    {
        require(
            _newOwner != address(0),
            "New owner cannot be zero address"
        );

        require(
            _newOwner != properties[_propertyId].currentOwner,
            "New owner must be different"
        );

        require(
            properties[_propertyId].verified,
            "Property must be verified before transfer"
        );

        require(
            properties[_propertyId].status != PropertyStatus.DISPUTED,
            "Disputed property cannot be transferred"
        );

        address previousOwner =
            properties[_propertyId].currentOwner;

        properties[_propertyId].previousOwner = previousOwner;

        properties[_propertyId].currentOwner = _newOwner;

        properties[_propertyId].status =
            PropertyStatus.TRANSFERRED;

        properties[_propertyId].lastTransferredAt =
            block.timestamp;

        ownerProperties[_newOwner].push(_propertyId);

        emit OwnershipTransferred(
            _propertyId,
            previousOwner,
            _newOwner,
            block.timestamp
        );

        emit PropertyStatusUpdated(
            _propertyId,
            PropertyStatus.TRANSFERRED,
            block.timestamp
        );
    }

    // ============================================================
    // PROPERTY STATUS
    // ============================================================

    function updatePropertyStatus(
        uint256 _propertyId,
        PropertyStatus _status
    )
        external
        onlyAuthority
        propertyExistsModifier(_propertyId)
    {
        properties[_propertyId].status = _status;

        emit PropertyStatusUpdated(
            _propertyId,
            _status,
            block.timestamp
        );
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    function getProperty(
        uint256 _propertyId
    )
        external
        view
        propertyExistsModifier(_propertyId)
        returns (Property memory)
    {
        return properties[_propertyId];
    }

    function getCurrentOwner(
        uint256 _propertyId
    )
        external
        view
        propertyExistsModifier(_propertyId)
        returns (address)
    {
        return properties[_propertyId].currentOwner;
    }

    function getPropertiesByOwner(
        address _owner
    )
        external
        view
        returns (uint256[] memory)
    {
        return ownerProperties[_owner];
    }

    function propertyExists(
        uint256 _propertyId
    )
        external
        view
        returns (bool)
    {
        return propertyExistsMapping[_propertyId];
    }

    function isVerified(
        uint256 _propertyId
    )
        external
        view
        propertyExistsModifier(_propertyId)
        returns (bool)
    {
        return properties[_propertyId].verified;
    }

    function getDocumentHash(
        uint256 _propertyId
    )
        external
        view
        propertyExistsModifier(_propertyId)
        returns (bytes32)
    {
        return properties[_propertyId].documentHash;
    }

    // ============================================================
    // ROLE CHECK FUNCTIONS
    // ============================================================

    function isAuthority(
        address _account
    )
        external
        view
        returns (bool)
    {
        return authorities[_account];
    }

    function isVerifier(
        address _account
    )
        external
        view
        returns (bool)
    {
        return verifiers[_account];
    }
}