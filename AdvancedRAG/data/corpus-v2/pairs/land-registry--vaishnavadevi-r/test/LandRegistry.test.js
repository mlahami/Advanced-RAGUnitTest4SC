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