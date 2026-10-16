const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("FileRegistry", function () {
  const SAMPLE_CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  const SAMPLE_CID_2 = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB";
  const SAMPLE_FILENAME_HASH = ethers.keccak256(
    ethers.toUtf8Bytes("document.pdf")
  );
  const SAMPLE_MERKLE_ROOT = ethers.keccak256(
    ethers.toUtf8Bytes("merkle-root-seed")
  );
  const NEW_MERKLE_ROOT = ethers.keccak256(
    ethers.toUtf8Bytes("new-merkle-root-seed")
  );

  async function deployFixture() {
    const [deployer, alice, bob] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory("Groth16Verifier");
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();
    const verifierAddr = await verifier.getAddress();

    // Predict the FileRegistry address so AccessNFT can set it as owner
    const deployerNonce = await ethers.provider.getTransactionCount(
      deployer.address
    );
    const futureRegistryAddr = ethers.getCreateAddress({
      from: deployer.address,
      nonce: deployerNonce + 1,
    });

    const AccessNFT = await ethers.getContractFactory("AccessNFT");
    const accessNFT = await AccessNFT.deploy(futureRegistryAddr);
    await accessNFT.waitForDeployment();
    const accessNFTAddr = await accessNFT.getAddress();

    const FileRegistry = await ethers.getContractFactory("FileRegistry");
    const fileRegistry = await FileRegistry.deploy(verifierAddr, accessNFTAddr);
    await fileRegistry.waitForDeployment();
    const registryAddr = await fileRegistry.getAddress();

    // Sanity: predicted address must match
    expect(registryAddr.toLowerCase()).to.equal(
      futureRegistryAddr.toLowerCase()
    );

    return { verifier, accessNFT, fileRegistry, deployer, alice, bob };
  }

  async function deployAndUploadFixture() {
    const fixture = await loadFixture(deployFixture);
    const { fileRegistry, alice } = fixture;

    const tx = await fileRegistry
      .connect(alice)
      .uploadFile(SAMPLE_CID, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT);
    await tx.wait();

    return { ...fixture, uploadTx: tx };
  }

  // ---------- 1. Deployment ----------

  describe("Deployment", function () {
    it("should deploy all three contracts", async function () {
      const { verifier, accessNFT, fileRegistry } =
        await loadFixture(deployFixture);

      expect(await verifier.getAddress()).to.be.properAddress;
      expect(await accessNFT.getAddress()).to.be.properAddress;
      expect(await fileRegistry.getAddress()).to.be.properAddress;
    });

    it("should link FileRegistry to the correct verifier", async function () {
      const { verifier, fileRegistry } = await loadFixture(deployFixture);

      expect(await fileRegistry.verifier()).to.equal(
        await verifier.getAddress()
      );
    });

    it("should link FileRegistry to the correct AccessNFT", async function () {
      const { accessNFT, fileRegistry } = await loadFixture(deployFixture);

      expect(await fileRegistry.accessNFT()).to.equal(
        await accessNFT.getAddress()
      );
    });

    it("should set FileRegistry as the AccessNFT owner", async function () {
      const { accessNFT, fileRegistry } = await loadFixture(deployFixture);

      expect(await accessNFT.owner()).to.equal(
        await fileRegistry.getAddress()
      );
    });

    it("should start with zero file count", async function () {
      const { fileRegistry } = await loadFixture(deployFixture);

      expect(await fileRegistry.fileCount()).to.equal(0);
    });

    it("should set correct NFT name and symbol", async function () {
      const { accessNFT } = await loadFixture(deployFixture);

      expect(await accessNFT.name()).to.equal("ZKP Storage File");
      expect(await accessNFT.symbol()).to.equal("ZKPF");
    });
  });

  // ---------- 2. File Upload ----------

  describe("File Upload", function () {
    it("should store file metadata correctly", async function () {
      const { fileRegistry, alice } = await loadFixture(deployFixture);

      await fileRegistry
        .connect(alice)
        .uploadFile(SAMPLE_CID, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT);

      const file = await fileRegistry.getFile(1);
      expect(file.encryptedCID).to.equal(SAMPLE_CID);
      expect(file.fileNameHash).to.equal(SAMPLE_FILENAME_HASH);
      expect(file.owner).to.equal(alice.address);
      expect(file.accessMerkleRoot).to.equal(SAMPLE_MERKLE_ROOT);
      expect(file.tokenId).to.equal(1);
      expect(file.createdAt).to.be.greaterThan(0);
    });

    it("should increment file count", async function () {
      const { fileRegistry, alice } = await loadFixture(deployFixture);

      await fileRegistry
        .connect(alice)
        .uploadFile(SAMPLE_CID, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT);
      expect(await fileRegistry.fileCount()).to.equal(1);

      await fileRegistry
        .connect(alice)
        .uploadFile(SAMPLE_CID_2, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT);
      expect(await fileRegistry.fileCount()).to.equal(2);
    });

    it("should mint an NFT to the uploader", async function () {
      const { fileRegistry, accessNFT, alice } =
        await loadFixture(deployFixture);

      await fileRegistry
        .connect(alice)
        .uploadFile(SAMPLE_CID, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT);

      expect(await accessNFT.ownerOf(1)).to.equal(alice.address);
    });

    it("should set the correct token URI", async function () {
      const { fileRegistry, accessNFT, alice } =
        await loadFixture(deployFixture);

      await fileRegistry
        .connect(alice)
        .uploadFile(SAMPLE_CID, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT);

      expect(await accessNFT.tokenURI(1)).to.equal("ipfs://" + SAMPLE_CID);
      expect(await accessNFT.tokenCID(1)).to.equal(SAMPLE_CID);
    });

    it("should emit FileUploaded event with correct args", async function () {
      const { fileRegistry, alice } = await loadFixture(deployFixture);

      await expect(
        fileRegistry
          .connect(alice)
          .uploadFile(SAMPLE_CID, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT)
      )
        .to.emit(fileRegistry, "FileUploaded")
        .withArgs(1, alice.address, SAMPLE_CID, 1);
    });

    it("should emit FileMinted event on AccessNFT", async function () {
      const { fileRegistry, accessNFT, alice } =
        await loadFixture(deployFixture);

      await expect(
        fileRegistry
          .connect(alice)
          .uploadFile(SAMPLE_CID, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT)
      )
        .to.emit(accessNFT, "FileMinted")
        .withArgs(1, alice.address, SAMPLE_CID);
    });

    it("should allow different users to upload different files", async function () {
      const { fileRegistry, alice, bob } = await loadFixture(deployFixture);

      await fileRegistry
        .connect(alice)
        .uploadFile(SAMPLE_CID, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT);
      await fileRegistry
        .connect(bob)
        .uploadFile(SAMPLE_CID_2, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT);

      const file1 = await fileRegistry.getFile(1);
      const file2 = await fileRegistry.getFile(2);
      expect(file1.owner).to.equal(alice.address);
      expect(file2.owner).to.equal(bob.address);
    });
  });

  // ---------- 3. File Access (updateAccessRoot) ----------

  describe("File Access", function () {
    it("should allow the file owner to update access root", async function () {
      const { fileRegistry, alice } = await loadFixture(
        deployAndUploadFixture
      );

      await fileRegistry.connect(alice).updateAccessRoot(1, NEW_MERKLE_ROOT);

      const file = await fileRegistry.getFile(1);
      expect(file.accessMerkleRoot).to.equal(NEW_MERKLE_ROOT);
    });

    it("should emit AccessRootUpdated with old and new roots", async function () {
      const { fileRegistry, alice } = await loadFixture(
        deployAndUploadFixture
      );

      await expect(
        fileRegistry.connect(alice).updateAccessRoot(1, NEW_MERKLE_ROOT)
      )
        .to.emit(fileRegistry, "AccessRootUpdated")
        .withArgs(1, SAMPLE_MERKLE_ROOT, NEW_MERKLE_ROOT);
    });

    it("should revert when a non-owner tries to update access root", async function () {
      const { fileRegistry, bob } = await loadFixture(deployAndUploadFixture);

      await expect(
        fileRegistry.connect(bob).updateAccessRoot(1, NEW_MERKLE_ROOT)
      ).to.be.revertedWithCustomError(fileRegistry, "Unauthorized");
    });

    it("should revert when updating access root for non-existent file", async function () {
      const { fileRegistry, alice } = await loadFixture(
        deployAndUploadFixture
      );

      await expect(
        fileRegistry.connect(alice).updateAccessRoot(999, NEW_MERKLE_ROOT)
      ).to.be.revertedWithCustomError(fileRegistry, "FileNotFound");
    });
  });

  // ---------- 4. File Deletion ----------

  describe("File Deletion", function () {
    it("should remove file metadata after deletion", async function () {
      const { fileRegistry, alice } = await loadFixture(
        deployAndUploadFixture
      );

      await fileRegistry.connect(alice).deleteFile(1);

      await expect(fileRegistry.getFile(1)).to.be.revertedWithCustomError(
        fileRegistry,
        "FileNotFound"
      );
    });

    it("should burn the associated NFT", async function () {
      const { fileRegistry, accessNFT, alice } = await loadFixture(
        deployAndUploadFixture
      );

      await fileRegistry.connect(alice).deleteFile(1);

      // ownerOf should revert for a burned token (ERC721NonexistentToken)
      await expect(accessNFT.ownerOf(1)).to.be.reverted;
    });

    it("should emit FileDeleted event", async function () {
      const { fileRegistry, alice } = await loadFixture(
        deployAndUploadFixture
      );

      await expect(fileRegistry.connect(alice).deleteFile(1))
        .to.emit(fileRegistry, "FileDeleted")
        .withArgs(1, alice.address);
    });

    it("should emit FileBurned event on AccessNFT", async function () {
      const { fileRegistry, accessNFT, alice } = await loadFixture(
        deployAndUploadFixture
      );

      await expect(fileRegistry.connect(alice).deleteFile(1))
        .to.emit(accessNFT, "FileBurned")
        .withArgs(1);
    });

    it("should not change the file count after deletion", async function () {
      const { fileRegistry, alice } = await loadFixture(
        deployAndUploadFixture
      );

      await fileRegistry.connect(alice).deleteFile(1);

      // _fileCounter is never decremented
      expect(await fileRegistry.fileCount()).to.equal(1);
    });

    it("should allow re-uploading the same CID after deletion", async function () {
      const { fileRegistry, alice } = await loadFixture(
        deployAndUploadFixture
      );

      await fileRegistry.connect(alice).deleteFile(1);

      await expect(
        fileRegistry
          .connect(alice)
          .uploadFile(SAMPLE_CID, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT)
      ).to.not.be.reverted;

      expect(await fileRegistry.fileCount()).to.equal(2);
    });
  });

  // ---------- 5. Access Control ----------

  describe("Access Control", function () {
    it("should prevent non-owner from deleting a file", async function () {
      const { fileRegistry, bob } = await loadFixture(deployAndUploadFixture);

      await expect(
        fileRegistry.connect(bob).deleteFile(1)
      ).to.be.revertedWithCustomError(fileRegistry, "Unauthorized");
    });

    it("should prevent non-owner from updating access root", async function () {
      const { fileRegistry, deployer } = await loadFixture(
        deployAndUploadFixture
      );

      await expect(
        fileRegistry.connect(deployer).updateAccessRoot(1, NEW_MERKLE_ROOT)
      ).to.be.revertedWithCustomError(fileRegistry, "Unauthorized");
    });

    it("should prevent direct minting on AccessNFT", async function () {
      const { accessNFT, alice } = await loadFixture(deployFixture);

      await expect(
        accessNFT.connect(alice).mint(alice.address, SAMPLE_CID)
      ).to.be.revertedWithCustomError(accessNFT, "OwnableUnauthorizedAccount");
    });

    it("should prevent direct burning on AccessNFT", async function () {
      const { accessNFT, alice } = await loadFixture(deployAndUploadFixture);

      await expect(
        accessNFT.connect(alice).burn(1)
      ).to.be.revertedWithCustomError(accessNFT, "OwnableUnauthorizedAccount");
    });

    it("should check ownership via NFT, not the stored owner field", async function () {
      const { fileRegistry, accessNFT, alice, bob } = await loadFixture(
        deployAndUploadFixture
      );

      // Transfer the NFT from alice to bob
      await accessNFT
        .connect(alice)
        .transferFrom(alice.address, bob.address, 1);

      // Now bob is the NFT owner and should be able to update/delete
      await expect(
        fileRegistry.connect(bob).updateAccessRoot(1, NEW_MERKLE_ROOT)
      ).to.not.be.reverted;

      // Alice no longer has access
      await expect(
        fileRegistry.connect(alice).deleteFile(1)
      ).to.be.revertedWithCustomError(fileRegistry, "Unauthorized");
    });
  });

  // ---------- 6. Edge Cases ----------

  describe("Edge Cases", function () {
    it("should revert when uploading with an empty CID", async function () {
      const { fileRegistry, alice } = await loadFixture(deployFixture);

      await expect(
        fileRegistry
          .connect(alice)
          .uploadFile("", SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT)
      ).to.be.revertedWithCustomError(fileRegistry, "InvalidCID");
    });

    it("should revert when uploading a duplicate CID", async function () {
      const { fileRegistry, alice, bob } = await loadFixture(
        deployAndUploadFixture
      );

      await expect(
        fileRegistry
          .connect(bob)
          .uploadFile(SAMPLE_CID, SAMPLE_FILENAME_HASH, SAMPLE_MERKLE_ROOT)
      ).to.be.revertedWithCustomError(fileRegistry, "FileAlreadyExists");
    });

    it("should revert when deleting a non-existent file", async function () {
      const { fileRegistry, alice } = await loadFixture(deployFixture);

      await expect(
        fileRegistry.connect(alice).deleteFile(999)
      ).to.be.revertedWithCustomError(fileRegistry, "FileNotFound");
    });

    it("should revert when getting a non-existent file", async function () {
      const { fileRegistry } = await loadFixture(deployFixture);

      await expect(fileRegistry.getFile(1)).to.be.revertedWithCustomError(
        fileRegistry,
        "FileNotFound"
      );
    });

    it("should revert when deleting an already deleted file", async function () {
      const { fileRegistry, alice } = await loadFixture(
        deployAndUploadFixture
      );

      await fileRegistry.connect(alice).deleteFile(1);

      await expect(
        fileRegistry.connect(alice).deleteFile(1)
      ).to.be.revertedWithCustomError(fileRegistry, "FileNotFound");
    });

    it("should handle uploading with zero-value merkle root and filename hash", async function () {
      const { fileRegistry, alice } = await loadFixture(deployFixture);

      await expect(
        fileRegistry
          .connect(alice)
          .uploadFile(SAMPLE_CID, ethers.ZeroHash, ethers.ZeroHash)
      ).to.not.be.reverted;

      const file = await fileRegistry.getFile(1);
      expect(file.fileNameHash).to.equal(ethers.ZeroHash);
      expect(file.accessMerkleRoot).to.equal(ethers.ZeroHash);
    });

    it("should revert tokenURI for a non-existent token", async function () {
      const { accessNFT } = await loadFixture(deployFixture);

      await expect(accessNFT.tokenURI(999)).to.be.reverted;
    });

    it("should revert tokenCID for a non-existent token", async function () {
      const { accessNFT } = await loadFixture(deployFixture);

      await expect(accessNFT.tokenCID(999)).to.be.reverted;
    });
  });

  // ---------- 7. ZKP Verification ----------

  describe("ZKP Verification", function () {
    it("should have a verifyAccess function", async function () {
      const { fileRegistry } = await loadFixture(deployFixture);

      expect(fileRegistry.verifyAccess).to.be.a("function");
    });

    it("should revert verifyAccess for non-existent file", async function () {
      const { fileRegistry, alice } = await loadFixture(deployFixture);

      const fakeProof = Array(8).fill(0);
      const leafHash = 1;

      await expect(
        fileRegistry.connect(alice).verifyAccess(999, fakeProof, leafHash)
      ).to.be.revertedWithCustomError(fileRegistry, "FileNotFound");
    });

    it("should revert verifyAccess with invalid proof", async function () {
      const { fileRegistry, alice } = await loadFixture(
        deployAndUploadFixture
      );

      const fakeProof = Array(8).fill(0);
      const leafHash = 1;

      await expect(
        fileRegistry.connect(alice).verifyAccess(1, fakeProof, leafHash)
      ).to.be.revertedWithCustomError(fileRegistry, "InvalidProof");
    });

    it("should have a verifyProof function on the verifier", async function () {
      const { verifier } = await loadFixture(deployFixture);

      expect(verifier.verifyProof).to.be.a("function");
    });

    it("should revert verifyProof when public input exceeds scalar field", async function () {
      const { verifier } = await loadFixture(deployFixture);

      const SNARK_SCALAR_FIELD = BigInt(
        "21888242871839275222246405745257275088548364400416034343698204186575808495617"
      );
      const fakeProof = Array(8).fill(0);

      await expect(
        verifier.verifyProof(fakeProof, [SNARK_SCALAR_FIELD, 0])
      ).to.be.revertedWithCustomError(verifier, "InvalidProof");
    });
  });
});
