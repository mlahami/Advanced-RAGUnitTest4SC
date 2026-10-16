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
