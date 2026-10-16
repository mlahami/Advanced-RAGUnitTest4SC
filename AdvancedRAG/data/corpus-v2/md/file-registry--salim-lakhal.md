# file-registry--salim-lakhal

- domain: registries-identity (registry)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/salim-lakhal/zkp-decentralized-storage @ 3f137fcbbfdb44fb5d8d79bb2068b14c683920c2
- license: MIT
- targets: FileRegistry.sol, AccessNFT.sol, Groth16Verifier.sol
- validation: 41 passing tests, 0 failing; statement coverage FileRegistry.sol 88.46 %, AccessNFT.sol 100.0 %, Groth16Verifier.sol 9.52 %

## Contract: AccessNFT.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title AccessNFT
/// @notice ERC-721 tokens representing file ownership in the decentralized storage system.
/// @dev Only the FileRegistry (set as owner) can mint and burn tokens.
contract AccessNFT is ERC721, Ownable {
    error NotTokenOwner();
    error TokenDoesNotExist();

    uint256 private _nextTokenId;
    mapping(uint256 => string) private _tokenCIDs;

    event FileMinted(uint256 indexed tokenId, address indexed owner, string cid);
    event FileBurned(uint256 indexed tokenId);

    /// @param registry The FileRegistry contract address, set as owner for mint/burn permissions.
    constructor(address registry) ERC721("ZKP Storage File", "ZKPF") Ownable(registry) {}

    /// @notice Mint a new file ownership NFT. Only callable by the FileRegistry.
    /// @param to The file owner's address.
    /// @param cid The IPFS CID associated with this file.
    /// @return tokenId The minted token ID.
    function mint(address to, string calldata cid) external onlyOwner returns (uint256 tokenId) {
        _nextTokenId++;
        tokenId = _nextTokenId;
        _safeMint(to, tokenId);
        _tokenCIDs[tokenId] = cid;
        emit FileMinted(tokenId, to, cid);
    }

    /// @notice Burn a file NFT. Only callable by the FileRegistry.
    function burn(uint256 tokenId) external onlyOwner {
        _requireOwned(tokenId);
        delete _tokenCIDs[tokenId];
        _burn(tokenId);
        emit FileBurned(tokenId);
    }

    /// @notice Returns the IPFS CID stored for the given token.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat("ipfs://", _tokenCIDs[tokenId]);
    }

    /// @notice Returns the raw CID for a token.
    function tokenCID(uint256 tokenId) external view returns (string memory) {
        _requireOwned(tokenId);
        return _tokenCIDs[tokenId];
    }
}
```

## Contract: FileRegistry.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Groth16Verifier.sol";
import "./AccessNFT.sol";

/// @title FileRegistry
/// @notice Core registry for encrypted file metadata with ZKP-based access control.
contract FileRegistry is ReentrancyGuard {
    error Unauthorized();
    error FileNotFound();
    error InvalidCID();
    error InvalidProof();
    error FileAlreadyExists();

    struct FileMetadata {
        string encryptedCID;
        bytes32 fileNameHash;
        address owner;
        bytes32 accessMerkleRoot;
        uint256 tokenId;
        uint256 createdAt;
        bool exists;
    }

    Groth16Verifier public immutable verifier;
    AccessNFT public immutable accessNFT;

    uint256 private _fileCounter;
    mapping(uint256 => FileMetadata) private _files;
    mapping(bytes32 => uint256) private _cidToFileId;

    event FileUploaded(uint256 indexed fileId, address indexed owner, string encryptedCID, uint256 tokenId);
    event AccessRootUpdated(uint256 indexed fileId, bytes32 oldRoot, bytes32 newRoot);
    event FileDeleted(uint256 indexed fileId, address indexed owner);
    event AccessVerified(uint256 indexed fileId, address indexed requester);

    modifier onlyFileOwner(uint256 fileId) {
        FileMetadata storage f = _files[fileId];
        if (!f.exists) revert FileNotFound();
        if (accessNFT.ownerOf(f.tokenId) != msg.sender) revert Unauthorized();
        _;
    }

    constructor(address verifier_, address accessNFT_) {
        verifier = Groth16Verifier(verifier_);
        accessNFT = AccessNFT(accessNFT_);
    }

    /// @notice Upload an encrypted file reference and mint an ownership NFT.
    /// @param encryptedCID The IPFS CID of the encrypted file.
    /// @param fileNameHash Keccak256 hash of the original file name.
    /// @param accessMerkleRoot Initial Merkle root of the access list.
    function uploadFile(
        string calldata encryptedCID,
        bytes32 fileNameHash,
        bytes32 accessMerkleRoot
    ) external nonReentrant returns (uint256 fileId) {
        if (bytes(encryptedCID).length == 0) revert InvalidCID();

        bytes32 cidHash = keccak256(bytes(encryptedCID));
        if (_cidToFileId[cidHash] != 0) revert FileAlreadyExists();

        _fileCounter++;
        fileId = _fileCounter;

        uint256 tokenId = accessNFT.mint(msg.sender, encryptedCID);

        _files[fileId] = FileMetadata({
            encryptedCID: encryptedCID,
            fileNameHash: fileNameHash,
            owner: msg.sender,
            accessMerkleRoot: accessMerkleRoot,
            tokenId: tokenId,
            createdAt: block.timestamp,
            exists: true
        });

        _cidToFileId[cidHash] = fileId;

        emit FileUploaded(fileId, msg.sender, encryptedCID, tokenId);
    }

    /// @notice Update the access Merkle root to grant or revoke access.
    function updateAccessRoot(
        uint256 fileId,
        bytes32 newRoot
    ) external onlyFileOwner(fileId) {
        bytes32 oldRoot = _files[fileId].accessMerkleRoot;
        _files[fileId].accessMerkleRoot = newRoot;
        emit AccessRootUpdated(fileId, oldRoot, newRoot);
    }

    /// @notice Verify that a caller has access by validating a Groth16 proof.
    /// @param fileId The file to access.
    /// @param proof The 8-element encoded Groth16 proof.
    /// @param leafHash The leaf hash (public input) the prover claims membership for.
    /// @return True if the proof verifies against the file's access Merkle root.
    function verifyAccess(
        uint256 fileId,
        uint256[8] calldata proof,
        uint256 leafHash
    ) external returns (bool) {
        FileMetadata storage f = _files[fileId];
        if (!f.exists) revert FileNotFound();

        uint256[2] memory pubInputs = [uint256(f.accessMerkleRoot), leafHash];

        bool valid = verifier.verifyProof(proof, pubInputs);
        if (!valid) revert InvalidProof();

        emit AccessVerified(fileId, msg.sender);
        return true;
    }

    /// @notice Delete a file reference and burn the associated NFT.
    function deleteFile(uint256 fileId) external onlyFileOwner(fileId) nonReentrant {
        FileMetadata storage f = _files[fileId];

        bytes32 cidHash = keccak256(bytes(f.encryptedCID));
        delete _cidToFileId[cidHash];

        uint256 tokenId = f.tokenId;
        delete _files[fileId];

        accessNFT.burn(tokenId);

        emit FileDeleted(fileId, msg.sender);
    }

    /// @notice Retrieve file metadata.
    function getFile(uint256 fileId) external view returns (
        string memory encryptedCID,
        bytes32 fileNameHash,
        address owner,
        bytes32 accessMerkleRoot,
        uint256 tokenId,
        uint256 createdAt
    ) {
        FileMetadata storage f = _files[fileId];
        if (!f.exists) revert FileNotFound();
        return (f.encryptedCID, f.fileNameHash, f.owner, f.accessMerkleRoot, f.tokenId, f.createdAt);
    }

    /// @notice Get current file count.
    function fileCount() external view returns (uint256) {
        return _fileCounter;
    }
}
```

## Contract: Groth16Verifier.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Groth16Verifier
/// @notice Verifies Groth16 proofs for Merkle tree membership (2 public inputs: root, leaf hash).
/// @dev Follows the snarkjs-generated verifier structure with BN254 pairing checks.
contract Groth16Verifier {
    error InvalidProof();
    error InvalidPublicInputCount();

    uint256 internal constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant PRIME_Q =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    struct VerifyingKey {
        G1Point alpha1;
        G2Point beta2;
        G2Point gamma2;
        G2Point delta2;
        G1Point[] ic; // length = nPublicInputs + 1
    }

    struct Proof {
        G1Point a;
        G2Point b;
        G1Point c;
    }

    struct G1Point {
        uint256 x;
        uint256 y;
    }

    struct G2Point {
        uint256[2] x;
        uint256[2] y;
    }

    // Placeholder verification key -- replace with actual ceremony output.
    // These are valid BN254 generator points for structural correctness.
    function verifyingKey() internal pure returns (VerifyingKey memory vk) {
        vk.alpha1 = G1Point(
            20491192805390485299153009773594534940189261866228447918068658471970481763042,
            9383485363053290200918347156157836566562967994039712273449902621266178545958
        );
        vk.beta2 = G2Point(
            [4252822878758300859123897981450591353533073413197771768651442665752259397132,
             6375614351688725206403948262868962793625744043794305715222011528459656738731],
            [21847035105528745403288232691147584728191162732299865338377159692350059136679,
             10505242626370262277552901082094356697409835680220590971873171140371331206856]
        );
        vk.gamma2 = G2Point(
            [11559732032986387107991004021392285783925812861821192530917403151452391805634,
             10857046999023057135944570762232829481370756359578518086990519993285655852781],
            [4082367875863433681332203403145435568316851327593401208105741076214120093531,
             8495653923123431417604973247489272438418190587263600148770280649306958101930]
        );
        vk.delta2 = G2Point(
            [11559732032986387107991004021392285783925812861821192530917403151452391805634,
             10857046999023057135944570762232829481370756359578518086990519993285655852781],
            [4082367875863433681332203403145435568316851327593401208105741076214120093531,
             8495653923123431417604973247489272438418190587263600148770280649306958101930]
        );
        vk.ic = new G1Point[](3); // 2 public inputs + 1
        vk.ic[0] = G1Point(
            6819801395408938350212900248749732364821477541620635511814266536599629892365,
            9092252330033992554755034971584864587974280972948086568597554018278568571960
        );
        vk.ic[1] = G1Point(
            17882351432079341047610988279187702204876977081278321838421635109316786685818,
            5765811523082952599614572507844682494503654131444457199725535537036724411928
        );
        vk.ic[2] = G1Point(
            10060004714591227724274806090110082399150066792549898888075084220825795498488,
            5280738018133368717621796092803348628853024619851694741849024503795144437808
        );
    }

    /// @notice Verifies a Groth16 proof against 2 public inputs.
    /// @param proof The encoded proof (a, b, c points).
    /// @param pubInputs Array of 2 public inputs [merkleRoot, leafHash].
    /// @return True if the proof is valid.
    function verifyProof(
        uint256[8] calldata proof,
        uint256[2] calldata pubInputs
    ) external view returns (bool) {
        for (uint256 i = 0; i < 2; i++) {
            if (pubInputs[i] >= SNARK_SCALAR_FIELD) revert InvalidProof();
        }

        Proof memory p = Proof(
            G1Point(proof[0], proof[1]),
            G2Point([proof[2], proof[3]], [proof[4], proof[5]]),
            G1Point(proof[6], proof[7])
        );

        VerifyingKey memory vk = verifyingKey();

        // Compute linear combination of public inputs: vk_x = ic[0] + sum(pubInputs[i] * ic[i+1])
        G1Point memory vkX = vk.ic[0];
        for (uint256 i = 0; i < 2; i++) {
            vkX = addition(vkX, scalar_mul(vk.ic[i + 1], pubInputs[i]));
        }

        // Pairing check: e(A, B) == e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
        // Rearranged: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        return pairing(
            negate(p.a), p.b,
            vk.alpha1, vk.beta2,
            vkX, vk.gamma2,
            p.c, vk.delta2
        );
    }

    // -- BN254 elliptic curve operations --

    function negate(G1Point memory p) internal pure returns (G1Point memory) {
        if (p.x == 0 && p.y == 0) return G1Point(0, 0);
        return G1Point(p.x, PRIME_Q - (p.y % PRIME_Q));
    }

    function addition(G1Point memory p1, G1Point memory p2) internal view returns (G1Point memory r) {
        uint256[4] memory input;
        input[0] = p1.x;
        input[1] = p1.y;
        input[2] = p2.x;
        input[3] = p2.y;
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 6, input, 0x80, r, 0x40)
        }
        if (!success) revert InvalidProof();
    }

    function scalar_mul(G1Point memory p, uint256 s) internal view returns (G1Point memory r) {
        uint256[3] memory input;
        input[0] = p.x;
        input[1] = p.y;
        input[2] = s;
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 7, input, 0x60, r, 0x40)
        }
        if (!success) revert InvalidProof();
    }

    /// @dev Performs a 4-pairing product check via the bn256Pairing precompile (address 8).
    function pairing(
        G1Point memory a1, G2Point memory a2,
        G1Point memory b1, G2Point memory b2,
        G1Point memory c1, G2Point memory c2,
        G1Point memory d1, G2Point memory d2
    ) internal view returns (bool) {
        uint256[24] memory input = [
            a1.x, a1.y, a2.x[1], a2.x[0], a2.y[1], a2.y[0],
            b1.x, b1.y, b2.x[1], b2.x[0], b2.y[1], b2.y[0],
            c1.x, c1.y, c2.x[1], c2.x[0], c2.y[1], c2.y[0],
            d1.x, d1.y, d2.x[1], d2.x[0], d2.y[1], d2.y[0]
        ];
        uint256[1] memory out;
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 8, input, 0x300, out, 0x20)
        }
        if (!success) revert InvalidProof();
        return out[0] != 0;
    }
}
```

## Tests: FileRegistry.test.js

```javascript
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
```
