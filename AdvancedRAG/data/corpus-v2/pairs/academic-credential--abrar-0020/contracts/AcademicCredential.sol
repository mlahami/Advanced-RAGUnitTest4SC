// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AcademicCredential
 * @dev Non-transferable (Soulbound) ERC721 token for academic credentials
 * @notice This contract manages the issuance and verification of academic credentials as NFTs
 */
contract AcademicCredential is ERC721, ERC721URIStorage, AccessControl {
    // Role definitions
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    // Token ID counter
    uint256 private _tokenIdCounter;

    // Struct to store credential details
    struct Credential {
        uint256 tokenId;
        address student;
        string metadataURI;
        uint256 issueTimestamp;
        bool revoked;
    }

    // Mappings
    mapping(uint256 => Credential) private _credentials;
    mapping(address => uint256[]) private _studentCredentials;
    mapping(bytes32 => bool) private _metadataHashExists;

    // Events
    event CredentialIssued(
        uint256 indexed tokenId,
        address indexed student,
        string metadataURI,
        uint256 timestamp
    );

    event CredentialRevoked(
        uint256 indexed tokenId,
        address indexed revokedBy,
        uint256 timestamp
    );

    /**
     * @dev Constructor sets up the contract with name, symbol, and admin role
     * @param admin Address of the initial admin
     */
    constructor(address admin) ERC721("Academic Credential", "ACADCRED") {
        require(admin != address(0), "Admin address cannot be zero");
        
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
    }

    /**
     * @dev Issue a new credential to a student
     * @param student Address of the student receiving the credential
     * @param metadataURI IPFS URI containing the credential metadata
     */
    function issueCredential(address student, string memory metadataURI)
        public
        onlyRole(ISSUER_ROLE)
        returns (uint256)
    {
        // Input validation
        require(student != address(0), "Cannot issue to zero address");
        require(bytes(metadataURI).length > 0, "Metadata URI cannot be empty");

        // Prevent duplicate credentials based on metadata hash
        bytes32 metadataHash = keccak256(abi.encodePacked(student, metadataURI));
        require(!_metadataHashExists[metadataHash], "Credential already exists for this metadata");

        // Assign current counter value first (starts at 0), then increment
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;

        // Mint the token
        _mint(student, tokenId);
        _setTokenURI(tokenId, metadataURI);

        // Store credential details
        _credentials[tokenId] = Credential({
            tokenId: tokenId,
            student: student,
            metadataURI: metadataURI,
            issueTimestamp: block.timestamp,
            revoked: false
        });

        // Track student credentials
        _studentCredentials[student].push(tokenId);

        // Mark metadata hash as used
        _metadataHashExists[metadataHash] = true;

        emit CredentialIssued(tokenId, student, metadataURI, block.timestamp);

        return tokenId;
    }

    /**
     * @dev Revoke a credential
     * @param tokenId ID of the credential to revoke
     */
    function revokeCredential(uint256 tokenId) public onlyRole(ISSUER_ROLE) {
        require(_ownerOf(tokenId) != address(0), "Credential does not exist");
        require(!_credentials[tokenId].revoked, "Credential already revoked");

        _credentials[tokenId].revoked = true;

        emit CredentialRevoked(tokenId, msg.sender, block.timestamp);
    }

    /**
     * @dev Verify a credential and get its details
     * @param tokenId ID of the credential to verify
     * @return Credential struct containing all credential details
     */
    function verifyCredential(uint256 tokenId)
        public
        view
        returns (Credential memory)
    {
        require(_ownerOf(tokenId) != address(0), "Credential does not exist");
        return _credentials[tokenId];
    }

    /**
     * @dev Get all credentials for a student
     * @param student Address of the student
     * @return Array of token IDs owned by the student
     */
    function getStudentCredentials(address student)
        public
        view
        returns (uint256[] memory)
    {
        return _studentCredentials[student];
    }

    /**
     * @dev Get credential details by token ID
     * @param tokenId ID of the credential
     * @return Credential struct
     */
    function getCredentialDetails(uint256 tokenId)
        public
        view
        returns (Credential memory)
    {
        require(_ownerOf(tokenId) != address(0), "Credential does not exist");
        return _credentials[tokenId];
    }

    /**
     * @dev Check if a credential is valid (exists and not revoked)
     * @param tokenId ID of the credential
     * @return bool True if credential is valid
     */
    function isCredentialValid(uint256 tokenId) public view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) {
            return false;
        }
        return !_credentials[tokenId].revoked;
    }

    /**
     * @dev Get the total number of credentials issued
     * @return uint256 Total count of credentials
     */
    function getTotalCredentials() public view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev Override to prevent transfers (Soulbound logic)
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override returns (address) {
        address from = _ownerOf(tokenId);
        
        // Allow minting (from == address(0))
        // Block transfers (from != address(0) && to != address(0))
        // Allow burning if needed (to == address(0))
        require(
            from == address(0) || to == address(0),
            "Credentials are non-transferable (Soulbound)"
        );

        return super._update(to, tokenId, auth);
    }

    /**
     * @dev Override to support both ERC721URIStorage and AccessControl
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    /**
     * @dev Override to support interface detection for AccessControl and ERC721
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
