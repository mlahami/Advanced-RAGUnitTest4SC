# nftasset-token--mickap1

- domain: nft-marketplace (nft-kyc)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Mickap1/G9---Blockchain @ fc4e0dba2c0113373a01ca8c42f9c8ae3b3a74a3
- license: LGPL-3.0
- targets: NFTAssetToken.sol, KYCregistry.sol
- validation: 41 passing tests, 0 failing; statement coverage NFTAssetToken.sol 98.44 %, KYCregistry.sol 22.58 %

## Contract: KYCregistry.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title KYCRegistry
 * @dev Central registry for KYC verification and compliance
 * @notice This contract manages whitelisting and blacklisting of addresses
 * @author Epitech Project - Tokenized Asset Platform
 */
contract KYCRegistry is AccessControl {
    // ========== ROLES ==========
    bytes32 public constant KYC_ADMIN_ROLE = keccak256("KYC_ADMIN_ROLE");
    
    // ========== ENUMS ==========
    enum KYCStatus {
        None,        // 0: No KYC submitted
        Pending,     // 1: KYC under review
        Approved,    // 2: KYC approved (whitelisted)
        Rejected,    // 3: KYC rejected
        Blacklisted  // 4: Address blacklisted
    }
    
    // ========== STRUCTS ==========
    struct KYCData {
        KYCStatus status;
        uint256 approvalDate;
        uint256 expiryDate;  // 0 = no expiry
        string dataURI;      // IPFS hash or link to encrypted KYC documents
    }
    
    // ========== STATE VARIABLES ==========
    mapping(address => KYCData) private _kycData;
    
    // Arrays to track addresses by status
    address[] private _allAddresses;
    mapping(address => bool) private _addressExists;
    
    // ========== EVENTS ==========
    event KYCSubmitted(address indexed user, string dataURI, uint256 timestamp);
    event KYCApproved(address indexed user, uint256 expiryDate, uint256 timestamp);
    event KYCRejected(address indexed user, string reason, uint256 timestamp);
    event AddressBlacklisted(address indexed user, string reason, uint256 timestamp);
    event AddressRemovedFromBlacklist(address indexed user, uint256 timestamp);
    event KYCRevoked(address indexed user, string reason, uint256 timestamp);
    
    // ========== CONSTRUCTOR ==========
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(KYC_ADMIN_ROLE, msg.sender);
    }
    
    // ========== MODIFIERS ==========
    modifier onlyKYCAdmin() {
        require(hasRole(KYC_ADMIN_ROLE, msg.sender), "KYCRegistry: caller is not KYC admin");
        _;
    }
    
    // ========== USER FUNCTIONS ==========
    
    /**
     * @notice Submit KYC data for review
     * @param dataURI IPFS hash or link to encrypted KYC documents
     */
    function submitKYC(string memory dataURI) external {
        require(
            _kycData[msg.sender].status == KYCStatus.None || 
            _kycData[msg.sender].status == KYCStatus.Rejected,
            "KYCRegistry: KYC already submitted"
        );
        
        // Track new address
        if (!_addressExists[msg.sender]) {
            _allAddresses.push(msg.sender);
            _addressExists[msg.sender] = true;
        }
        
        _kycData[msg.sender] = KYCData({
            status: KYCStatus.Pending,
            approvalDate: 0,
            expiryDate: 0,
            dataURI: dataURI
        });
        
        emit KYCSubmitted(msg.sender, dataURI, block.timestamp);
    }
    
    // ========== ADMIN FUNCTIONS ==========
    
    /**
     * @notice Approve KYC for a user (add to whitelist)
     * @param user Address to approve
     * @param expiryDate Timestamp when KYC expires (0 for no expiry)
     */
    function approveKYC(address user, uint256 expiryDate) external onlyKYCAdmin {
        require(_kycData[user].status != KYCStatus.Blacklisted, 
                "KYCRegistry: address is blacklisted");
        
        _kycData[user].status = KYCStatus.Approved;
        _kycData[user].approvalDate = block.timestamp;
        _kycData[user].expiryDate = expiryDate;
        
        emit KYCApproved(user, expiryDate, block.timestamp);
    }
    
    /**
     * @notice Reject KYC for a user
     * @param user Address to reject
     * @param reason Reason for rejection
     */
    function rejectKYC(address user, string memory reason) external onlyKYCAdmin {
        _kycData[user].status = KYCStatus.Rejected;
        emit KYCRejected(user, reason, block.timestamp);
    }
    
    /**
     * @notice Add address to blacklist
     * @param user Address to blacklist
     * @param reason Reason for blacklisting
     */
    function blacklistAddress(address user, string memory reason) external onlyKYCAdmin {
        _kycData[user].status = KYCStatus.Blacklisted;
        emit AddressBlacklisted(user, reason, block.timestamp);
    }
    
    /**
     * @notice Remove address from blacklist
     * @param user Address to remove from blacklist
     */
    function removeFromBlacklist(address user) external onlyKYCAdmin {
        require(_kycData[user].status == KYCStatus.Blacklisted, 
                "KYCRegistry: address is not blacklisted");
        
        _kycData[user].status = KYCStatus.None;
        emit AddressRemovedFromBlacklist(user, block.timestamp);
    }
    
    /**
     * @notice Revoke previously approved KYC
     * @param user Address to revoke KYC
     * @param reason Reason for revocation
     */
    function revokeKYC(address user, string memory reason) external onlyKYCAdmin {
        require(_kycData[user].status == KYCStatus.Approved, 
                "KYCRegistry: KYC not approved");
        
        _kycData[user].status = KYCStatus.Rejected;
        emit KYCRevoked(user, reason, block.timestamp);
    }
    
    /**
     * @notice Batch approve multiple addresses
     * @param users Array of addresses to approve
     * @param expiryDate Timestamp when KYC expires (same for all)
     */
    function batchApproveKYC(address[] calldata users, uint256 expiryDate) 
        external 
        onlyKYCAdmin 
    {
        for (uint256 i = 0; i < users.length; i++) {
            if (_kycData[users[i]].status != KYCStatus.Blacklisted) {
                _kycData[users[i]].status = KYCStatus.Approved;
                _kycData[users[i]].approvalDate = block.timestamp;
                _kycData[users[i]].expiryDate = expiryDate;
                emit KYCApproved(users[i], expiryDate, block.timestamp);
            }
        }
    }
    
    // ========== VIEW FUNCTIONS ==========
    
    /**
     * @notice Check if address is whitelisted (KYC approved and not expired)
     * @param user Address to check
     * @return bool True if whitelisted and not expired
     */
    function isWhitelisted(address user) public view returns (bool) {
        KYCData memory data = _kycData[user];
        
        if (data.status != KYCStatus.Approved) {
            return false;
        }
        
        if (data.expiryDate > 0 && block.timestamp > data.expiryDate) {
            return false;
        }
        
        return true;
    }
    
    /**
     * @notice Check if address is blacklisted
     * @param user Address to check
     * @return bool True if blacklisted
     */
    function isBlacklisted(address user) public view returns (bool) {
        return _kycData[user].status == KYCStatus.Blacklisted;
    }
    
    /**
     * @notice Get KYC status of an address
     * @param user Address to check
     * @return KYCStatus Current status
     */
    function getKYCStatus(address user) external view returns (KYCStatus) {
        return _kycData[user].status;
    }
    
    /**
     * @notice Get full KYC data of an address
     * @param user Address to check
     * @return KYCData Full KYC data struct
     */
    function getKYCData(address user) external view returns (KYCData memory) {
        return _kycData[user];
    }
    
    /**
     * @notice Check if both sender and recipient are compliant for transfer
     * @param from Sender address
     * @param to Recipient address
     * @return bool True if transfer is allowed
     */
    function canTransfer(address from, address to) external view returns (bool) {
        return isWhitelisted(from) && 
               isWhitelisted(to) && 
               !isBlacklisted(from) && 
               !isBlacklisted(to);
    }
    
    // ========== LISTING FUNCTIONS ==========
    
    /**
     * @notice Get all addresses that have ever interacted with KYC
     * @return address[] Array of all addresses
     */
    function getAllAddresses() external view returns (address[] memory) {
        return _allAddresses;
    }
    
    /**
     * @notice Get count of all addresses
     * @return uint256 Total number of addresses
     */
    function getAddressCount() external view returns (uint256) {
        return _allAddresses.length;
    }
    
    /**
     * @notice Get addresses by status with pagination
     * @param status The KYC status to filter by
     * @param offset Starting index
     * @param limit Maximum number of results
     * @return addresses Array of addresses with the given status
     * @return total Total count of addresses with this status
     */
    function getAddressesByStatus(
        KYCStatus status,
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory addresses, uint256 total) {
        // First pass: count addresses with this status
        uint256 count = 0;
        for (uint256 i = 0; i < _allAddresses.length; i++) {
            if (_kycData[_allAddresses[i]].status == status) {
                count++;
            }
        }
        
        // Calculate actual limit
        uint256 end = offset + limit;
        if (end > count) {
            end = count;
        }
        
        // If offset is beyond count, return empty array
        if (offset >= count) {
            return (new address[](0), count);
        }
        
        // Second pass: collect addresses
        address[] memory result = new address[](end - offset);
        uint256 resultIndex = 0;
        uint256 currentIndex = 0;
        
        for (uint256 i = 0; i < _allAddresses.length && resultIndex < result.length; i++) {
            if (_kycData[_allAddresses[i]].status == status) {
                if (currentIndex >= offset) {
                    result[resultIndex] = _allAddresses[i];
                    resultIndex++;
                }
                currentIndex++;
            }
        }
        
        return (result, count);
    }
    
    /**
     * @notice Get all addresses with a specific status (no pagination)
     * @param status The KYC status to filter by
     * @return address[] Array of addresses with the given status
     */
    function getAllAddressesByStatus(KYCStatus status) external view returns (address[] memory) {
        // First pass: count
        uint256 count = 0;
        for (uint256 i = 0; i < _allAddresses.length; i++) {
            if (_kycData[_allAddresses[i]].status == status) {
                count++;
            }
        }
        
        // Second pass: collect
        address[] memory result = new address[](count);
        uint256 resultIndex = 0;
        
        for (uint256 i = 0; i < _allAddresses.length; i++) {
            if (_kycData[_allAddresses[i]].status == status) {
                result[resultIndex] = _allAddresses[i];
                resultIndex++;
            }
        }
        
        return result;
    }
    
    /**
     * @notice Get multiple KYC data at once
     * @param users Array of addresses to query
     * @return KYCData[] Array of KYC data
     */
    function getBatchKYCData(address[] calldata users) external view returns (KYCData[] memory) {
        KYCData[] memory results = new KYCData[](users.length);
        for (uint256 i = 0; i < users.length; i++) {
            results[i] = _kycData[users[i]];
        }
        return results;
    }
    
    /**
     * @notice Get statistics about KYC statuses
     * @return pending Count of pending KYCs
     * @return approved Count of approved KYCs
     * @return rejected Count of rejected KYCs
     * @return blacklisted Count of blacklisted addresses
     * @return total Total addresses
     */
    function getStatistics() external view returns (
        uint256 pending,
        uint256 approved,
        uint256 rejected,
        uint256 blacklisted,
        uint256 total
    ) {
        total = _allAddresses.length;
        
        for (uint256 i = 0; i < _allAddresses.length; i++) {
            KYCStatus status = _kycData[_allAddresses[i]].status;
            
            if (status == KYCStatus.Pending) {
                pending++;
            } else if (status == KYCStatus.Approved) {
                approved++;
            } else if (status == KYCStatus.Rejected) {
                rejected++;
            } else if (status == KYCStatus.Blacklisted) {
                blacklisted++;
            }
        }
        
        return (pending, approved, rejected, blacklisted, total);
    }
}
```

## Contract: NFTAssetToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./KYCregistry.sol";

/**
 * @title NFTAssetToken
 * @dev ERC-721 token representing unique real-world assets
 * @notice Transfers are restricted to KYC-verified addresses
 * @author Epitech Project - Tokenized Asset Platform
 */
contract NFTAssetToken is 
    ERC721, 
    ERC721URIStorage, 
    ERC721Burnable, 
    ERC721Pausable,
    AccessControl 
{
    // ========== ROLES ==========
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    
    // ========== KYC ==========
    KYCRegistry public immutable kycRegistry;
    
    // ========== TOKEN ID COUNTER ==========
    uint256 private _nextTokenId;
    
    // ========== COLLECTION METADATA ==========
    string public collectionDescription;
    string public assetType; // "Artwork", "Diamond", "Real Estate", etc.
    
    // ========== INDIVIDUAL ASSET DATA ==========
    struct AssetData {
        string name;             // "Sunset Over Blockchain"
        uint256 valuation;       // Asset value in base currency
        uint256 tokenizationDate;
        string certificateURI;   // IPFS hash of authenticity certificate
        bool isActive;           // Can be deactivated if needed
    }
    
    mapping(uint256 => AssetData) public assetData;
    
    // ========== EVENTS ==========
    event AssetMinted(
        uint256 indexed tokenId, 
        address indexed owner, 
        string name, 
        uint256 valuation,
        uint256 timestamp
    );
    event AssetValuationUpdated(uint256 indexed tokenId, uint256 newValuation);
    event AssetDeactivated(uint256 indexed tokenId);
    event AssetReactivated(uint256 indexed tokenId);
    event KYCCheckFailed(address indexed from, address indexed to, string reason);
    
    // ========== ERRORS ==========
    error RecipientNotWhitelisted();
    error SenderNotWhitelisted();
    error RecipientBlacklisted();
    error SenderBlacklisted();
    error ZeroAddress();
    error TokenDoesNotExist();
    error AssetIsDeactivated();
    
    /**
     * @dev Constructor
     * @param name_ Collection name (e.g., "Tokenized Artwork Collection")
     * @param symbol_ Collection symbol (e.g., "TART")
     * @param kycRegistry_ Address of KYCRegistry contract
     * @param assetType_ Type of assets in collection
     * @param description_ Collection description
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address kycRegistry_,
        string memory assetType_,
        string memory description_
    ) ERC721(name_, symbol_) {
        if (kycRegistry_ == address(0)) revert ZeroAddress();
        
        kycRegistry = KYCRegistry(kycRegistry_);
        assetType = assetType_;
        collectionDescription = description_;
        
        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }
    
    // ========== MINTING FUNCTIONS ==========
    
    /**
     * @notice Mint a new NFT representing a unique asset
     * @param to Address to mint to (must be whitelisted)
     * @param assetName Name of the asset
     * @param valuation Asset valuation
     * @param uri Metadata URI (IPFS)
     * @param certificateURI Certificate of authenticity URI
     * @return uint256 Token ID of minted NFT
     */
    function mintAsset(
        address to,
        string memory assetName,
        uint256 valuation,
        string memory uri,
        string memory certificateURI
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        if (to == address(0)) revert ZeroAddress();
        if (!kycRegistry.isWhitelisted(to)) revert RecipientNotWhitelisted();
        
        uint256 tokenId = _nextTokenId++;
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        
        assetData[tokenId] = AssetData({
            name: assetName,
            valuation: valuation,
            tokenizationDate: block.timestamp,
            certificateURI: certificateURI,
            isActive: true
        });
        
        emit AssetMinted(tokenId, to, assetName, valuation, block.timestamp);
        
        return tokenId;
    }
    
    /**
     * @notice Batch mint multiple NFTs
     * @param recipients Array of recipient addresses
     * @param assetNames Array of asset names
     * @param valuations Array of valuations
     * @param uris Array of metadata URIs
     * @param certificateURIs Array of certificate URIs
     * @return uint256[] Array of minted token IDs
     */
    function batchMintAssets(
        address[] calldata recipients,
        string[] calldata assetNames,
        uint256[] calldata valuations,
        string[] calldata uris,
        string[] calldata certificateURIs
    ) external onlyRole(MINTER_ROLE) returns (uint256[] memory) {
        require(
            recipients.length == assetNames.length &&
            recipients.length == valuations.length &&
            recipients.length == uris.length &&
            recipients.length == certificateURIs.length,
            "Arrays length mismatch"
        );
        
        uint256[] memory tokenIds = new uint256[](recipients.length);
        
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            if (!kycRegistry.isWhitelisted(recipients[i])) revert RecipientNotWhitelisted();
            
            uint256 tokenId = _nextTokenId++;
            
            _safeMint(recipients[i], tokenId);
            _setTokenURI(tokenId, uris[i]);
            
            assetData[tokenId] = AssetData({
                name: assetNames[i],
                valuation: valuations[i],
                tokenizationDate: block.timestamp,
                certificateURI: certificateURIs[i],
                isActive: true
            });
            
            tokenIds[i] = tokenId;
            
            emit AssetMinted(tokenId, recipients[i], assetNames[i], valuations[i], block.timestamp);
        }
        
        return tokenIds;
    }
    
    // ========== ADMIN FUNCTIONS ==========
    
    /**
     * @notice Update asset valuation
     * @param tokenId Token ID
     * @param newValuation New valuation
     */
    function updateValuation(uint256 tokenId, uint256 newValuation) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        
        assetData[tokenId].valuation = newValuation;
        emit AssetValuationUpdated(tokenId, newValuation);
    }
    
    /**
     * @notice Update token URI
     * @param tokenId Token ID
     * @param newURI New metadata URI
     */
    function updateTokenURI(uint256 tokenId, string memory newURI) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        _setTokenURI(tokenId, newURI);
    }
    
    /**
     * @notice Deactivate an asset
     * @param tokenId Token ID
     */
    function deactivateAsset(uint256 tokenId) external onlyRole(ADMIN_ROLE) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        
        assetData[tokenId].isActive = false;
        emit AssetDeactivated(tokenId);
    }
    
    /**
     * @notice Reactivate an asset
     * @param tokenId Token ID
     */
    function reactivateAsset(uint256 tokenId) external onlyRole(ADMIN_ROLE) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        
        assetData[tokenId].isActive = true;
        emit AssetReactivated(tokenId);
    }
    
    /**
     * @notice Pause all token transfers
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    /**
     * @notice Unpause token transfers
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
    
    // ========== OVERRIDES (KYC Enforcement) ==========
    
    /**
     * @dev Override _update to enforce KYC compliance
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Pausable)
        returns (address)
    {
        address from = _ownerOf(tokenId);
        
        // Allow minting (from == address(0)) and burning (to == address(0))
        if (from != address(0) && to != address(0)) {
            // Check blacklist first (security priority)
            if (kycRegistry.isBlacklisted(from)) {
                emit KYCCheckFailed(from, to, "Sender is blacklisted");
                revert SenderBlacklisted();
            }
            
            if (kycRegistry.isBlacklisted(to)) {
                emit KYCCheckFailed(from, to, "Recipient is blacklisted");
                revert RecipientBlacklisted();
            }
            
            // Then check whitelist
            if (!kycRegistry.isWhitelisted(from)) {
                emit KYCCheckFailed(from, to, "Sender not whitelisted");
                revert SenderNotWhitelisted();
            }
            
            if (!kycRegistry.isWhitelisted(to)) {
                emit KYCCheckFailed(from, to, "Recipient not whitelisted");
                revert RecipientNotWhitelisted();
            }
        }
        
        return super._update(to, tokenId, auth);
    }
    
    // ========== VIEW FUNCTIONS ==========
    
    /**
     * @notice Get complete asset data for a token
     * @param tokenId Token ID
     * @return AssetData struct
     */
    function getAssetData(uint256 tokenId) external view returns (AssetData memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        return assetData[tokenId];
    }
    
    /**
     * @notice Get all token IDs owned by an address
     * @param owner Address to query
     * @return uint256[] Array of token IDs
     */
    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        uint256 tokenCount = balanceOf(owner);
        uint256[] memory tokenIds = new uint256[](tokenCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < _nextTokenId; i++) {
            if (_ownerOf(i) == owner) {
                tokenIds[index] = i;
                index++;
                if (index == tokenCount) break;
            }
        }
        
        return tokenIds;
    }
    
    /**
     * @notice Get total number of minted tokens
     * @return uint256 Total supply
     */
    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }
    
    /**
     * @notice Get total valuation of all active assets
     * @return uint256 Total collection value
     */
    function totalCollectionValue() external view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < _nextTokenId; i++) {
            if (_ownerOf(i) != address(0) && assetData[i].isActive) {
                total += assetData[i].valuation;
            }
        }
        return total;
    }
    
    /**
     * @notice Get total value of assets owned by an address
     * @param owner Address to query
     * @return uint256 Total value of owned assets
     */
    function totalValueOf(address owner) external view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < _nextTokenId; i++) {
            if (_ownerOf(i) == owner && assetData[i].isActive) {
                total += assetData[i].valuation;
            }
        }
        return total;
    }
    
    /**
     * @notice Check if an address can receive tokens
     * @param account Address to check
     * @return bool True if address is compliant
     */
    function canReceiveTokens(address account) external view returns (bool) {
        return kycRegistry.isWhitelisted(account) && !kycRegistry.isBlacklisted(account);
    }
    
    // ========== REQUIRED OVERRIDES ==========
    
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }
    
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

## Tests: NFTAssetToken.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTAssetToken", function () {
    let nft;
    let kycRegistry;
    let owner;
    let admin;
    let alice;
    let bob;
    let charlie;

    const COLLECTION_NAME = "Tokenized Artwork Collection";
    const COLLECTION_SYMBOL = "TART";
    const ASSET_TYPE = "Digital Art";
    const COLLECTION_DESC = "Collection of unique digital artworks";

    beforeEach(async function () {
        [owner, admin, alice, bob, charlie] = await ethers.getSigners();

        const KYCRegistryFactory = await ethers.getContractFactory("KYCRegistry");
        kycRegistry = await KYCRegistryFactory.deploy();
        await kycRegistry.waitForDeployment();

        const KYC_ADMIN_ROLE = await kycRegistry.KYC_ADMIN_ROLE();
        await kycRegistry.grantRole(KYC_ADMIN_ROLE, admin.address);

        const NFTFactory = await ethers.getContractFactory("NFTAssetToken");
        nft = await NFTFactory.deploy(
            COLLECTION_NAME,
            COLLECTION_SYMBOL,
            await kycRegistry.getAddress(),
            ASSET_TYPE,
            COLLECTION_DESC
        );
        await nft.waitForDeployment();

        await kycRegistry.connect(admin).approveKYC(alice.address, 0);
        await kycRegistry.connect(admin).approveKYC(bob.address, 0);
    });

    describe("Deployment", function () {
        it("Should set the correct collection name and symbol", async function () {
            expect(await nft.name()).to.equal(COLLECTION_NAME);
            expect(await nft.symbol()).to.equal(COLLECTION_SYMBOL);
        });

        it("Should set the correct KYC registry", async function () {
            expect(await nft.kycRegistry()).to.equal(await kycRegistry.getAddress());
        });

        it("Should set the correct asset type and description", async function () {
            expect(await nft.assetType()).to.equal(ASSET_TYPE);
            expect(await nft.collectionDescription()).to.equal(COLLECTION_DESC);
        });

        it("Should grant roles to deployer", async function () {
            const DEFAULT_ADMIN_ROLE = await nft.DEFAULT_ADMIN_ROLE();
            const ADMIN_ROLE = await nft.ADMIN_ROLE();
            const MINTER_ROLE = await nft.MINTER_ROLE();
            const PAUSER_ROLE = await nft.PAUSER_ROLE();

            expect(await nft.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
            expect(await nft.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
            expect(await nft.hasRole(MINTER_ROLE, owner.address)).to.be.true;
            expect(await nft.hasRole(PAUSER_ROLE, owner.address)).to.be.true;
        });

        it("Should initialize with zero total supply", async function () {
            expect(await nft.totalSupply()).to.equal(0);
        });
    });

    describe("Minting", function () {
        it("Should mint NFT to whitelisted address", async function () {
            await expect(
                nft.mintAsset(
                    alice.address,
                    "Sunset Over Blockchain",
                    15000,
                    "ipfs://QmArtwork123",
                    "ipfs://QmCertificate456"
                )
            ).to.emit(nft, "AssetMinted");

            expect(await nft.ownerOf(0)).to.equal(alice.address);
            expect(await nft.balanceOf(alice.address)).to.equal(1);
            expect(await nft.totalSupply()).to.equal(1);
        });

        it("Should not mint to non-whitelisted address", async function () {
            await expect(
                nft.mintAsset(charlie.address, "Digital Dreams", 20000, "ipfs://QmArt", "ipfs://QmCert")
            ).to.be.revertedWithCustomError(nft, "RecipientNotWhitelisted");
        });

        it("Should assign sequential token IDs", async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
            await nft.mintAsset(bob.address, "Art 2", 15000, "ipfs://2", "ipfs://cert2");
            await nft.mintAsset(alice.address, "Art 3", 20000, "ipfs://3", "ipfs://cert3");

            expect(await nft.ownerOf(0)).to.equal(alice.address);
            expect(await nft.ownerOf(1)).to.equal(bob.address);
            expect(await nft.ownerOf(2)).to.equal(alice.address);
            expect(await nft.totalSupply()).to.equal(3);
        });

        it("Should store correct asset data", async function () {
            await nft.mintAsset(
                alice.address,
                "Sunset Over Blockchain",
                15000,
                "ipfs://QmArtwork123",
                "ipfs://QmCertificate456"
            );

            const assetData = await nft.getAssetData(0);
            expect(assetData.name).to.equal("Sunset Over Blockchain");
            expect(assetData.valuation).to.equal(15000);
            expect(assetData.certificateURI).to.equal("ipfs://QmCertificate456");
            expect(assetData.isActive).to.be.true;
            expect(assetData.tokenizationDate).to.be.gt(0);
        });

        it("Should not allow non-minter to mint", async function () {
            await expect(
                nft.connect(alice).mintAsset(bob.address, "Artwork", 10000, "ipfs://uri", "ipfs://cert")
            ).to.be.reverted;
        });

        it("Should not mint to zero address", async function () {
            await expect(
                nft.mintAsset(ethers.ZeroAddress, "Artwork", 10000, "ipfs://uri", "ipfs://cert")
            ).to.be.revertedWithCustomError(nft, "ZeroAddress");
        });
    });

    describe("Batch Minting", function () {
        it("Should batch mint multiple NFTs", async function () {
            const recipients = [alice.address, bob.address, alice.address];
            const names = ["Art 1", "Art 2", "Art 3"];
            const valuations = [10000, 15000, 20000];
            const uris = ["ipfs://1", "ipfs://2", "ipfs://3"];
            const certs = ["ipfs://cert1", "ipfs://cert2", "ipfs://cert3"];

            await nft.batchMintAssets(recipients, names, valuations, uris, certs);

            expect(await nft.ownerOf(0)).to.equal(alice.address);
            expect(await nft.ownerOf(1)).to.equal(bob.address);
            expect(await nft.ownerOf(2)).to.equal(alice.address);
            expect(await nft.totalSupply()).to.equal(3);
        });

        it("Should revert if arrays length mismatch", async function () {
            await expect(
                nft.batchMintAssets(
                    [alice.address, bob.address],
                    ["Art 1"],
                    [10000, 15000],
                    ["ipfs://1", "ipfs://2"],
                    ["ipfs://cert1", "ipfs://cert2"]
                )
            ).to.be.revertedWith("Arrays length mismatch");
        });

        it("Should revert if any recipient not whitelisted", async function () {
            await expect(
                nft.batchMintAssets(
                    [alice.address, charlie.address],
                    ["Art 1", "Art 2"],
                    [10000, 15000],
                    ["ipfs://1", "ipfs://2"],
                    ["ipfs://cert1", "ipfs://cert2"]
                )
            ).to.be.revertedWithCustomError(nft, "RecipientNotWhitelisted");
        });
    });

    describe("Transfers with KYC", function () {
        beforeEach(async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
        });

        it("Should allow transfer between whitelisted addresses", async function () {
            await nft.connect(alice).transferFrom(alice.address, bob.address, 0);

            expect(await nft.ownerOf(0)).to.equal(bob.address);
            expect(await nft.balanceOf(alice.address)).to.equal(0);
            expect(await nft.balanceOf(bob.address)).to.equal(1);
        });

        it("Should not allow transfer to non-whitelisted address", async function () {
            await expect(
                nft.connect(alice).transferFrom(alice.address, charlie.address, 0)
            ).to.be.revertedWithCustomError(nft, "RecipientNotWhitelisted");
        });

        it("Should not allow transfer from non-whitelisted address", async function () {
            await kycRegistry.connect(admin).revokeKYC(alice.address, "Test");

            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, 0)
            ).to.be.revertedWithCustomError(nft, "SenderNotWhitelisted");
        });

        it("Should not allow transfer if sender is blacklisted", async function () {
            await kycRegistry.connect(admin).blacklistAddress(alice.address, "Test");

            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, 0)
            ).to.be.revertedWithCustomError(nft, "SenderBlacklisted");
        });

        it("Should not allow transfer if recipient is blacklisted", async function () {
            await kycRegistry.connect(admin).blacklistAddress(bob.address, "Test");

            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, 0)
            ).to.be.revertedWithCustomError(nft, "RecipientBlacklisted");
        });

        it("Should emit KYCCheckFailed event on failed transfer", async function () {
            // Note: Events emitted before a revert cannot be tested with chai-matchers
            // This test verifies the revert happens with the correct error
            await expect(
                nft.connect(alice).transferFrom(alice.address, charlie.address, 0)
            ).to.be.revertedWithCustomError(nft, "RecipientNotWhitelisted");
        });
    });

    describe("Burning", function () {
        beforeEach(async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
        });

        it("Should allow owner to burn their NFT", async function () {
            await nft.connect(alice).burn(0);

            await expect(nft.ownerOf(0)).to.be.reverted;
            expect(await nft.balanceOf(alice.address)).to.equal(0);
        });

        it("Should not allow non-owner to burn", async function () {
            await expect(nft.connect(bob).burn(0)).to.be.reverted;
        });
    });

    describe("Pausable", function () {
        beforeEach(async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
        });

        it("Should pause transfers", async function () {
            await nft.pause();

            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, 0)
            ).to.be.reverted;
        });

        it("Should unpause transfers", async function () {
            await nft.pause();
            await nft.unpause();

            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, 0)
            ).to.not.be.reverted;
        });

        it("Should not allow non-pauser to pause", async function () {
            await expect(nft.connect(alice).pause()).to.be.reverted;
        });
    });

    describe("Admin Functions", function () {
        beforeEach(async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
        });

        it("Should allow admin to update valuation", async function () {
            await expect(nft.updateValuation(0, 15000))
                .to.emit(nft, "AssetValuationUpdated")
                .withArgs(0, 15000);

            const assetData = await nft.getAssetData(0);
            expect(assetData.valuation).to.equal(15000);
        });

        it("Should allow admin to update token URI", async function () {
            await nft.updateTokenURI(0, "ipfs://newURI");
            expect(await nft.tokenURI(0)).to.equal("ipfs://newURI");
        });

        it("Should allow admin to deactivate asset", async function () {
            await expect(nft.deactivateAsset(0))
                .to.emit(nft, "AssetDeactivated")
                .withArgs(0);

            const assetData = await nft.getAssetData(0);
            expect(assetData.isActive).to.be.false;
        });

        it("Should allow admin to reactivate asset", async function () {
            await nft.deactivateAsset(0);

            await expect(nft.reactivateAsset(0))
                .to.emit(nft, "AssetReactivated")
                .withArgs(0);

            const assetData = await nft.getAssetData(0);
            expect(assetData.isActive).to.be.true;
        });

        it("Should not allow non-admin to update valuation", async function () {
            await expect(nft.connect(alice).updateValuation(0, 15000)).to.be.reverted;
        });

        it("Should revert on updating non-existent token", async function () {
            await expect(
                nft.updateValuation(999, 15000)
            ).to.be.revertedWithCustomError(nft, "TokenDoesNotExist");
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
            await nft.mintAsset(bob.address, "Art 2", 15000, "ipfs://2", "ipfs://cert2");
            await nft.mintAsset(alice.address, "Art 3", 20000, "ipfs://3", "ipfs://cert3");
        });

        it("Should return tokens of owner", async function () {
            const aliceTokens = await nft.tokensOfOwner(alice.address);
            expect(aliceTokens.length).to.equal(2);
            expect(aliceTokens[0]).to.equal(0);
            expect(aliceTokens[1]).to.equal(2);

            const bobTokens = await nft.tokensOfOwner(bob.address);
            expect(bobTokens.length).to.equal(1);
            expect(bobTokens[0]).to.equal(1);
        });

        it("Should calculate total collection value", async function () {
            const totalValue = await nft.totalCollectionValue();
            expect(totalValue).to.equal(45000);
        });

        it("Should calculate total value of owner", async function () {
            const aliceValue = await nft.totalValueOf(alice.address);
            expect(aliceValue).to.equal(30000);

            const bobValue = await nft.totalValueOf(bob.address);
            expect(bobValue).to.equal(15000);
        });

        it("Should exclude deactivated assets from total values", async function () {
            await nft.deactivateAsset(0);

            const totalValue = await nft.totalCollectionValue();
            expect(totalValue).to.equal(35000);

            const aliceValue = await nft.totalValueOf(alice.address);
            expect(aliceValue).to.equal(20000);
        });

        it("Should correctly check if address can receive tokens", async function () {
            expect(await nft.canReceiveTokens(alice.address)).to.be.true;
            expect(await nft.canReceiveTokens(charlie.address)).to.be.false;

            await kycRegistry.connect(admin).blacklistAddress(alice.address, "Test");
            expect(await nft.canReceiveTokens(alice.address)).to.be.false;
        });

        it("Should return correct total supply", async function () {
            expect(await nft.totalSupply()).to.equal(3);
        });

        it("Should return correct asset data", async function () {
            const assetData = await nft.getAssetData(0);

            expect(assetData.name).to.equal("Art 1");
            expect(assetData.valuation).to.equal(10000);
            expect(assetData.certificateURI).to.equal("ipfs://cert1");
            expect(assetData.isActive).to.be.true;
            expect(assetData.tokenizationDate).to.be.gt(0);
        });

        it("Should revert when getting data for non-existent token", async function () {
            await expect(nft.getAssetData(999)).to.be.revertedWithCustomError(nft, "TokenDoesNotExist");
        });
    });

    describe("Integration: Full Flow", function () {
        it("Should handle complete NFT lifecycle", async function () {
            await nft.mintAsset(
                alice.address,
                "Sunset Over Blockchain",
                15000,
                "ipfs://QmArtwork123",
                "ipfs://QmCertificate456"
            );
            expect(await nft.ownerOf(0)).to.equal(alice.address);

            let assetData = await nft.getAssetData(0);
            expect(assetData.name).to.equal("Sunset Over Blockchain");
            expect(assetData.valuation).to.equal(15000);

            await nft.connect(alice).transferFrom(alice.address, bob.address, 0);
            expect(await nft.ownerOf(0)).to.equal(bob.address);

            await nft.updateValuation(0, 20000);
            assetData = await nft.getAssetData(0);
            expect(assetData.valuation).to.equal(20000);

            const bobValue = await nft.totalValueOf(bob.address);
            expect(bobValue).to.equal(20000);

            await nft.connect(bob).burn(0);
            await expect(nft.ownerOf(0)).to.be.reverted;
        });

        it("Should handle multiple owners and valuations", async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
            await nft.mintAsset(bob.address, "Art 2", 15000, "ipfs://2", "ipfs://cert2");
            await nft.mintAsset(alice.address, "Art 3", 20000, "ipfs://3", "ipfs://cert3");

            expect(await nft.balanceOf(alice.address)).to.equal(2);
            expect(await nft.balanceOf(bob.address)).to.equal(1);

            const aliceTokens = await nft.tokensOfOwner(alice.address);
            expect(aliceTokens.length).to.equal(2);
            expect(aliceTokens[0]).to.equal(0);
            expect(aliceTokens[1]).to.equal(2);

            const totalValue = await nft.totalCollectionValue();
            expect(totalValue).to.equal(45000);

            const aliceValue = await nft.totalValueOf(alice.address);
            expect(aliceValue).to.equal(30000);

            await nft.updateValuation(0, 12000);
            await nft.updateValuation(2, 25000);

            const newAliceValue = await nft.totalValueOf(alice.address);
            expect(newAliceValue).to.equal(37000);
        });
    });
});
```
