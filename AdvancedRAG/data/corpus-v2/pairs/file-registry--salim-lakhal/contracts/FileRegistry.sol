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
