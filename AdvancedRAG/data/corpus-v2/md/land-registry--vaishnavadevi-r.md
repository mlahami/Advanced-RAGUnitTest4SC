# land-registry--vaishnavadevi-r

- domain: registries-identity (registry)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/VaishnavaDevi-R/Blockchain-Land-Registry-Property-Ownership @ a9ec58d1835cd51a16e176e32037b05c69c38913
- license: MIT
- targets: LandRegistry.sol
- validation: 20 passing tests, 0 failing; statement coverage LandRegistry.sol 94.74 %

## Contract: LandRegistry.sol (primary target)

```solidity
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
```

## Tests: LandRegistry.test.js

```javascript
const { expect } = require("chai");
const hre = require("hardhat");

describe("LandRegistry", function () {

    let landRegistry;
    let admin;
    let authority;
    let verifier;
    let owner;
    let buyer;
    let unauthorized;

    const PROPERTY_ID = 1001;
    const PROPERTY_NUMBER = "P001";
    const LOCATION = "Coimbatore, Tamil Nadu";
    const AREA = 1200;
    const PROPERTY_TYPE = "Residential";

    const DOCUMENT_HASH =
        hre.ethers.keccak256(
            hre.ethers.toUtf8Bytes("property-001-document")
        );

    beforeEach(async function () {

        [
            admin,
            authority,
            verifier,
            owner,
            buyer,
            unauthorized
        ] = await hre.ethers.getSigners();

        const LandRegistry =
            await hre.ethers.getContractFactory("LandRegistry");

        landRegistry = await LandRegistry.deploy();

        await landRegistry.waitForDeployment();

        // Give roles to test accounts
        await landRegistry
            .connect(admin)
            .addAuthority(authority.address);

        await landRegistry
            .connect(admin)
            .addVerifier(verifier.address);
    });

    // ============================================================
    // DEPLOYMENT
    // ============================================================

    it("should deploy the contract with the correct admin", async function () {

        expect(await landRegistry.admin())
            .to.equal(admin.address);
    });

    // ============================================================
    // ROLE MANAGEMENT
    // ============================================================

    it("should allow admin to add an authority", async function () {

        expect(
            await landRegistry.isAuthority(authority.address)
        ).to.equal(true);
    });

    it("should allow admin to add a verifier", async function () {

        expect(
            await landRegistry.isVerifier(verifier.address)
        ).to.equal(true);
    });

    // ============================================================
    // PROPERTY REGISTRATION
    // ============================================================

    it("should allow an authority to register a property", async function () {

        await expect(
            landRegistry
                .connect(authority)
                .registerProperty(
                    PROPERTY_ID,
                    PROPERTY_NUMBER,
                    LOCATION,
                    AREA,
                    PROPERTY_TYPE,
                    owner.address,
                    DOCUMENT_HASH
                )
        )
            .to.emit(landRegistry, "PropertyRegistered")
            .withArgs(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                owner.address,
                (value) => value > 0
            );

        const property =
            await landRegistry.getProperty(PROPERTY_ID);

        expect(property.propertyId)
            .to.equal(PROPERTY_ID);

        expect(property.propertyNumber)
            .to.equal(PROPERTY_NUMBER);

        expect(property.location)
            .to.equal(LOCATION);

        expect(property.area)
            .to.equal(AREA);

        expect(property.propertyType)
            .to.equal(PROPERTY_TYPE);

        expect(property.currentOwner)
            .to.equal(owner.address);

        expect(property.verified)
            .to.equal(false);
    });

    // ============================================================
    // DUPLICATE PROPERTY
    // ============================================================

    it("should reject duplicate property registration", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        await expect(
            landRegistry
                .connect(authority)
                .registerProperty(
                    PROPERTY_ID,
                    "P002",
                    LOCATION,
                    AREA,
                    PROPERTY_TYPE,
                    owner.address,
                    DOCUMENT_HASH
                )
        )
            .to.be.revertedWith("Property already exists");
    });

    // ============================================================
    // UNAUTHORIZED REGISTRATION
    // ============================================================

    it("should reject unauthorized property registration", async function () {

        await expect(
            landRegistry
                .connect(unauthorized)
                .registerProperty(
                    PROPERTY_ID,
                    PROPERTY_NUMBER,
                    LOCATION,
                    AREA,
                    PROPERTY_TYPE,
                    owner.address,
                    DOCUMENT_HASH
                )
        )
            .to.be.revertedWith(
                "Not authorized: Authority only"
            );
    });

    // ============================================================
    // ZERO ADDRESS OWNER
    // ============================================================

    it("should reject zero address as initial owner", async function () {

        await expect(
            landRegistry
                .connect(authority)
                .registerProperty(
                    PROPERTY_ID,
                    PROPERTY_NUMBER,
                    LOCATION,
                    AREA,
                    PROPERTY_TYPE,
                    hre.ethers.ZeroAddress,
                    DOCUMENT_HASH
                )
        )
            .to.be.revertedWith(
                "Owner cannot be zero address"
            );
    });

    // ============================================================
    // INVALID AREA
    // ============================================================

    it("should reject zero property area", async function () {

        await expect(
            landRegistry
                .connect(authority)
                .registerProperty(
                    PROPERTY_ID,
                    PROPERTY_NUMBER,
                    LOCATION,
                    0,
                    PROPERTY_TYPE,
                    owner.address,
                    DOCUMENT_HASH
                )
        )
            .to.be.revertedWith(
                "Area must be greater than zero"
            );
    });

    // ============================================================
    // PROPERTY VERIFICATION
    // ============================================================

    it("should allow verifier to verify a property", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        await expect(
            landRegistry
                .connect(verifier)
                .verifyProperty(PROPERTY_ID)
        )
            .to.emit(landRegistry, "PropertyVerified")
            .withArgs(
                PROPERTY_ID,
                verifier.address,
                (value) => value > 0
            );

        const property =
            await landRegistry.getProperty(PROPERTY_ID);

        expect(property.verified)
            .to.equal(true);

        expect(property.status)
            .to.equal(1);
    });

    // ============================================================
    // UNAUTHORIZED VERIFICATION
    // ============================================================

    it("should reject unauthorized verification", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        await expect(
            landRegistry
                .connect(unauthorized)
                .verifyProperty(PROPERTY_ID)
        )
            .to.be.revertedWith(
                "Not authorized: Verifier only"
            );
    });

    // ============================================================
    // DUPLICATE VERIFICATION
    // ============================================================

    it("should reject verification if property is already verified", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        await landRegistry
            .connect(verifier)
            .verifyProperty(PROPERTY_ID);

        await expect(
            landRegistry
                .connect(verifier)
                .verifyProperty(PROPERTY_ID)
        )
            .to.be.revertedWith(
                "Property already verified"
            );
    });

    // ============================================================
    // OWNERSHIP TRANSFER
    // ============================================================

    it("should allow the current owner to transfer ownership", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        await landRegistry
            .connect(verifier)
            .verifyProperty(PROPERTY_ID);

        await expect(
            landRegistry
                .connect(owner)
                .transferOwnership(
                    PROPERTY_ID,
                    buyer.address
                )
        )
            .to.emit(landRegistry, "OwnershipTransferred")
            .withArgs(
                PROPERTY_ID,
                owner.address,
                buyer.address,
                (value) => value > 0
            );

        const property =
            await landRegistry.getProperty(PROPERTY_ID);

        expect(property.currentOwner)
            .to.equal(buyer.address);

        expect(property.previousOwner)
            .to.equal(owner.address);
    });

    // ============================================================
    // UNVERIFIED TRANSFER
    // ============================================================

    it("should reject transfer of an unverified property", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        await expect(
            landRegistry
                .connect(owner)
                .transferOwnership(
                    PROPERTY_ID,
                    buyer.address
                )
        )
            .to.be.revertedWith(
                "Property must be verified before transfer"
            );
    });

    // ============================================================
    // NON-OWNER TRANSFER
    // ============================================================

    it("should reject transfer by a non-owner", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        await landRegistry
            .connect(verifier)
            .verifyProperty(PROPERTY_ID);

        await expect(
            landRegistry
                .connect(unauthorized)
                .transferOwnership(
                    PROPERTY_ID,
                    buyer.address
                )
        )
            .to.be.revertedWith(
                "Not authorized: Property owner only"
            );
    });

    // ============================================================
    // ZERO ADDRESS TRANSFER
    // ============================================================

    it("should reject transfer to zero address", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        await landRegistry
            .connect(verifier)
            .verifyProperty(PROPERTY_ID);

        await expect(
            landRegistry
                .connect(owner)
                .transferOwnership(
                    PROPERTY_ID,
                    hre.ethers.ZeroAddress
                )
        )
            .to.be.revertedWith(
                "New owner cannot be zero address"
            );
    });

    // ============================================================
    // OLD OWNER TRANSFER
    // ============================================================

    it("should reject transfer by the old owner after transfer", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        await landRegistry
            .connect(verifier)
            .verifyProperty(PROPERTY_ID);

        await landRegistry
            .connect(owner)
            .transferOwnership(
                PROPERTY_ID,
                buyer.address
            );

        await expect(
            landRegistry
                .connect(owner)
                .transferOwnership(
                    PROPERTY_ID,
                    unauthorized.address
                )
        )
            .to.be.revertedWith(
                "Not authorized: Property owner only"
            );
    });

    // ============================================================
    // PROPERTY EXISTENCE
    // ============================================================

    it("should correctly report whether a property exists", async function () {

        expect(
            await landRegistry.propertyExists(PROPERTY_ID)
        ).to.equal(false);

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        expect(
            await landRegistry.propertyExists(PROPERTY_ID)
        ).to.equal(true);
    });

    // ============================================================
    // OWNER PROPERTY LIST
    // ============================================================

    it("should return properties owned by an address", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        const propertyIds =
            await landRegistry.getPropertiesByOwner(
                owner.address
            );

        expect(propertyIds.length)
            .to.equal(1);

        expect(propertyIds[0])
            .to.equal(PROPERTY_ID);
    });

    // ============================================================
    // DOCUMENT HASH
    // ============================================================

    it("should preserve the document hash", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        const storedHash =
            await landRegistry.getDocumentHash(
                PROPERTY_ID
            );

        expect(storedHash)
            .to.equal(DOCUMENT_HASH);
    });

    // ============================================================
    // STATUS UPDATE
    // ============================================================

    it("should allow authority to update property status", async function () {

        await landRegistry
            .connect(authority)
            .registerProperty(
                PROPERTY_ID,
                PROPERTY_NUMBER,
                LOCATION,
                AREA,
                PROPERTY_TYPE,
                owner.address,
                DOCUMENT_HASH
            );

        // DISPUTED = 4
        await landRegistry
            .connect(authority)
            .updatePropertyStatus(
                PROPERTY_ID,
                4
            );

        const property =
            await landRegistry.getProperty(PROPERTY_ID);

        expect(property.status)
            .to.equal(4);
    });

});
```
