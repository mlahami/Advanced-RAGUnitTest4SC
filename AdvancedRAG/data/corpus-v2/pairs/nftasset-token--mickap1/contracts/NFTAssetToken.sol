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