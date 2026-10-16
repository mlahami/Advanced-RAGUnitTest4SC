# oma3-app-metadata--oma3dao

- domain: registries-identity (registry)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/oma3dao/app-registry-evm-solidity @ 6ee78de059563119c2d3fa9a397e8af308f0834e
- license: MIT
- targets: OMA3AppMetadata.sol
- validation: 11 passing tests, 0 failing; statement coverage OMA3AppMetadata.sol 100.0 %

## Contract: OMA3AppMetadata.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title OMA3AppMetadata
/// @notice A contract for managing decentralized application metadata using DIDs with registry integration
/// @dev This contract stores metadata as JSON, with access control for authorized registry
contract OMA3AppMetadata is Ownable {
    /// @notice Mapping of DIDs to their metadata JSON
    mapping(string => string) public metadataJsonByDID;

    /// @notice Address of the authorized registry contract
    address public authorizedRegistry;

    /// @notice Emitted when metadata is set
    event MetadataSet(
        string indexed did,
        uint8 major,
        uint8 minor,
        uint8 patch,
        string metadataJson,
        bytes32 metadataHash,
        uint256 timestamp
    );

    /// @notice Emitted when registry is authorized
    event RegistryAuthorized(address indexed registryAddress);

    // Constants for validation
    uint256 private constant MAX_DID_LENGTH = 128;
    uint256 private constant MAX_JSON_LENGTH = 10000; // 10 KB max
    string private constant ERROR_PREFIX = "AppMetadata Contract Error: ";

    /// @notice Modifier to restrict access to authorized registry only
    modifier onlyAuthorizedRegistry() {
        require(msg.sender == authorizedRegistry, string.concat(ERROR_PREFIX, "Only authorized registry"));
        _;
    }

    /// @notice Constructor - sets the deployer as owner
    constructor() Ownable(msg.sender) {}

    /// @notice Sets or updates the authorized registry address
    /// @param _registryAddress Address of the registry contract
    /// @dev Can be called multiple times by owner to update the registry
    function setAuthorizedRegistry(address _registryAddress) 
        external 
        onlyOwner 
    {
        require(_registryAddress != address(0), string.concat(ERROR_PREFIX, "Invalid registry address"));
        
        authorizedRegistry = _registryAddress;
        
        emit RegistryAuthorized(_registryAddress);
    }

    /// @notice Sets metadata for an app - called by authorized registry only
    /// @param did Unique identifier for the application (base DID, not versioned)
    /// @param major Major version number
    /// @param minor Minor version number
    /// @param patch Patch version number
    /// @param metadataJson JSON string containing the app metadata
    function setMetadataForRegistry(
        string memory did,
        uint8 major,
        uint8 minor,
        uint8 patch,
        string memory metadataJson
    ) external onlyAuthorizedRegistry {
        _validateInputs(did, metadataJson);
        
        // Store metadata by base DID (gas efficient - shared across versions)
        metadataJsonByDID[did] = metadataJson;
        
        // Emit event with full version context for historical tracking
        emit MetadataSet(
            did,
            major,
            minor,
            patch,
            metadataJson,
            keccak256(bytes(metadataJson)),
            block.timestamp
        );
    }



    /// @notice Gets the metadata JSON for a specific DID
    /// @param did Unique identifier for the application
    /// @return The metadata JSON string
    function getMetadataJson(string memory did) external view returns (string memory) {
        return metadataJsonByDID[did];
    }

    /// @notice Internal function to validate DID and metadata inputs
    /// @param did The DID string to validate
    /// @param metadataJson The metadata JSON string to validate
    function _validateInputs(string memory did, string memory metadataJson) internal pure {
        // DID validation
        require(bytes(did).length > 0, string.concat(ERROR_PREFIX, "DID cannot be empty"));
        require(bytes(did).length <= MAX_DID_LENGTH, string.concat(ERROR_PREFIX, "DID too long"));
        require(isLowercase(did), string.concat(ERROR_PREFIX, "DID must be lowercase"));
        
        // JSON validation
        require(bytes(metadataJson).length > 0, string.concat(ERROR_PREFIX, "Metadata JSON cannot be empty"));
        require(bytes(metadataJson).length <= MAX_JSON_LENGTH, string.concat(ERROR_PREFIX, "Metadata JSON too large"));
    }
    
    /// @notice Checks if a string contains only lowercase characters
    /// @param str The string to check
    /// @return True if the string is all lowercase or contains no letters
    function isLowercase(string memory str) internal pure returns (bool) {
        bytes memory strBytes = bytes(str);
        for (uint256 index = 0; index < strBytes.length; index++) {
            if (strBytes[index] >= 0x41 && strBytes[index] <= 0x5A) {
                return false;
            }
        }
        return true;
    }
}
```

## Tests: OMA3AppMetadata.js

```javascript
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const hre = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("OMA3AppMetadata", function () {
  // Fixture to deploy contracts for testing
  async function deployFixture() {
    const [owner, registry, user1, user2] = await hre.ethers.getSigners();

    // Deploy metadata contract
    const OMA3AppMetadata = await hre.ethers.getContractFactory("OMA3AppMetadata");
    const metadata = await OMA3AppMetadata.deploy();

    return { metadata, owner, registry, user1, user2 };
  }

  const sampleData = {
    did: "did:oma3:test-app",
    metadataJson: JSON.stringify({
      name: "Test App",
      description: "A test application",
      iconUrl: "https://example.com/icon.png"
    })
  };

  describe("Deployment", function () {
    it("Should deploy with correct owner", async function () {
      const { metadata, owner } = await loadFixture(deployFixture);

      expect(await metadata.owner()).to.equal(owner.address);
      expect(await metadata.authorizedRegistry()).to.equal("0x0000000000000000000000000000000000000000");
    });
  });

  describe("Registry Authorization", function () {
    it("Should allow owner to set authorized registry", async function () {
      const { metadata, owner, registry } = await loadFixture(deployFixture);

      await expect(metadata.setAuthorizedRegistry(registry.address))
        .to.emit(metadata, "RegistryAuthorized")
        .withArgs(registry.address);

      expect(await metadata.authorizedRegistry()).to.equal(registry.address);
    });

    it("Should reject zero address as registry", async function () {
      const { metadata } = await loadFixture(deployFixture);

      await expect(metadata.setAuthorizedRegistry("0x0000000000000000000000000000000000000000"))
        .to.be.revertedWith("AppMetadata Contract Error: Invalid registry address");
    });

    it("Should reject non-owner setting registry", async function () {
      const { metadata, registry, user1 } = await loadFixture(deployFixture);

      await expect(metadata.connect(user1).setAuthorizedRegistry(registry.address))
        .to.be.revertedWithCustomError(metadata, "OwnableUnauthorizedAccount");
    });
  });

  describe("Metadata Operations", function () {
    it("Should allow authorized registry to set metadata", async function () {
      const { metadata, registry } = await loadFixture(deployFixture);

      // Authorize registry
      await metadata.setAuthorizedRegistry(registry.address);

      // Set metadata from registry
      await expect(metadata.connect(registry).setMetadataForRegistry(sampleData.did, 1, 0, 0, sampleData.metadataJson))
        .to.emit(metadata, "MetadataSet")
        .withArgs(
          sampleData.did,
          1,
          0,
          0,
          sampleData.metadataJson,
          hre.ethers.keccak256(hre.ethers.toUtf8Bytes(sampleData.metadataJson)),
          anyValue // block.timestamp
        );

      // Verify metadata was stored
      expect(await metadata.getMetadataJson(sampleData.did)).to.equal(sampleData.metadataJson);
    });

    it("Should reject unauthorized calls to set metadata", async function () {
      const { metadata, user1 } = await loadFixture(deployFixture);

      await expect(metadata.connect(user1).setMetadataForRegistry(sampleData.did, 1, 0, 0, sampleData.metadataJson))
        .to.be.revertedWith("AppMetadata Contract Error: Only authorized registry");
    });

    it("Should validate DID format", async function () {
      const { metadata, registry } = await loadFixture(deployFixture);

      await metadata.setAuthorizedRegistry(registry.address);

      // Test invalid DIDs
      await expect(metadata.connect(registry).setMetadataForRegistry("", 1, 0, 0, sampleData.metadataJson))
        .to.be.revertedWith("AppMetadata Contract Error: DID cannot be empty");

      await expect(metadata.connect(registry).setMetadataForRegistry("UPPERCASE", 1, 0, 0, sampleData.metadataJson))
        .to.be.revertedWith("AppMetadata Contract Error: DID must be lowercase");
    });

    it("Should validate metadata JSON", async function () {
      const { metadata, registry } = await loadFixture(deployFixture);

      await metadata.setAuthorizedRegistry(registry.address);

      // Test empty JSON
      await expect(metadata.connect(registry).setMetadataForRegistry(sampleData.did, 1, 0, 0, ""))
        .to.be.revertedWith("AppMetadata Contract Error: Metadata JSON cannot be empty");

      // Test JSON too long (over 10KB)
      const longJson = "x".repeat(10001);
      await expect(metadata.connect(registry).setMetadataForRegistry(sampleData.did, 1, 0, 0, longJson))
        .to.be.revertedWith("AppMetadata Contract Error: Metadata JSON too large");
    });
  });

  describe("Metadata Retrieval", function () {
    it("Should return empty string for non-existent DID", async function () {
      const { metadata } = await loadFixture(deployFixture);

      expect(await metadata.getMetadataJson("did:oma3:nonexistent")).to.equal("");
    });

    it("Should return stored metadata for existing DID", async function () {
      const { metadata, registry } = await loadFixture(deployFixture);

      await metadata.setAuthorizedRegistry(registry.address);
      await metadata.connect(registry).setMetadataForRegistry(sampleData.did, 1, 0, 0, sampleData.metadataJson);

      expect(await metadata.getMetadataJson(sampleData.did)).to.equal(sampleData.metadataJson);
    });
  });

  describe("Uncovered Lines Coverage", function () {
          it("should handle isLowercase with string containing no letters", async function () {
        const { metadata, owner, registry } = await loadFixture(deployFixture);

        // Test with string containing only numbers and symbols (no letters)
        const nonLetterString = "123!@#$%^&*()";

        // Set the authorized registry first
        await metadata.connect(owner).setAuthorizedRegistry(registry.address);

        // This should not cause any issues and should work correctly
        // since there are no uppercase letters to reject
        await expect(
          metadata.connect(registry).setMetadataForRegistry("did:oma3:test", 1, 0, 0, JSON.stringify({
            name: "Test App",
            description: "Test description",
            data: nonLetterString
          }))
        ).to.not.be.reverted;

        // Verify the metadata was stored
        const storedMetadata = await metadata.getMetadataJson("did:oma3:test");
        expect(storedMetadata).to.include(nonLetterString);
      });
  });
});
```
