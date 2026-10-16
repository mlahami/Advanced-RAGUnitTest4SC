// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "./KYCregistry.sol";

/**
 * @title FungibleAssetToken
 * @dev ERC-20 token representing fractional ownership of a real-world asset
 * @notice Transfers are restricted to KYC-verified addresses
 * @author Epitech Project - Tokenized Asset Platform
 */
contract FungibleAssetToken is ERC20, ERC20Burnable, ERC20Pausable, AccessControl {
    // ========== ROLES ==========
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    
    // ========== KYC ==========
    KYCRegistry public immutable kycRegistry;
    
    // ========== ASSET METADATA ==========
    struct AssetMetadata {
        string assetName;        // "Residence Lumiere Apartment"
        string assetType;        // "Real Estate"
        string location;         // "42 Rue de Vaugirard, 75015 Paris"
        uint256 totalValue;      // Total asset value (in base currency, e.g., EUR cents)
        string documentURI;      // IPFS hash with legal docs, photos, etc.
        uint256 tokenizationDate;
    }
    
    AssetMetadata public assetMetadata;
    
    // ========== SUPPLY ==========
    uint256 public immutable MAX_SUPPLY;
    
    // ========== EVENTS ==========
    event AssetMetadataUpdated(string documentURI);
    event TokensMinted(address indexed to, uint256 amount, uint256 timestamp);
    event TokensBurned(address indexed from, uint256 amount, uint256 timestamp);
    event KYCCheckFailed(address indexed from, address indexed to, string reason);
    
    // ========== ERRORS ==========
    error ExceedsMaxSupply();
    error RecipientNotWhitelisted();
    error SenderNotWhitelisted();
    error RecipientBlacklisted();
    error SenderBlacklisted();
    error ZeroAddress();
    error ZeroAmount();
    
    /**
     * @dev Constructor
     * @param name_ Token name (e.g., "Residence Lumiere Token")
     * @param symbol_ Token symbol (e.g., "PLM")
     * @param maxSupply_ Maximum token supply (fixed at deployment)
     * @param kycRegistry_ Address of KYCRegistry contract
     * @param assetName_ Name of the underlying asset
     * @param assetType_ Type of asset (e.g., "Real Estate")
     * @param location_ Asset location
     * @param totalValue_ Total asset value (in base currency)
     * @param documentURI_ IPFS hash of asset documents
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        address kycRegistry_,
        string memory assetName_,
        string memory assetType_,
        string memory location_,
        uint256 totalValue_,
        string memory documentURI_
    ) ERC20(name_, symbol_) {
        if (kycRegistry_ == address(0)) revert ZeroAddress();
        if (maxSupply_ == 0) revert ZeroAmount();
        
        kycRegistry = KYCRegistry(kycRegistry_);
        MAX_SUPPLY = maxSupply_;
        
        assetMetadata = AssetMetadata({
            assetName: assetName_,
            assetType: assetType_,
            location: location_,
            totalValue: totalValue_,
            documentURI: documentURI_,
            tokenizationDate: block.timestamp
        });
        
        // Grant roles to deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }
    
    // ========== MINTING FUNCTIONS ==========
    
    /**
     * @notice Mint new tokens (only by MINTER_ROLE)
     * @param to Address to mint tokens to (must be whitelisted)
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (totalSupply() + amount > MAX_SUPPLY) revert ExceedsMaxSupply();
        if (!kycRegistry.isWhitelisted(to)) revert RecipientNotWhitelisted();
        
        _mint(to, amount);
        emit TokensMinted(to, amount, block.timestamp);
    }
    
    /**
     * @notice Batch mint to multiple addresses
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to mint
     */
    function batchMint(address[] calldata recipients, uint256[] calldata amounts) 
        external 
        onlyRole(MINTER_ROLE) 
    {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }
        
        if (totalSupply() + totalAmount > MAX_SUPPLY) revert ExceedsMaxSupply();
        
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            if (!kycRegistry.isWhitelisted(recipients[i])) revert RecipientNotWhitelisted();
            
            _mint(recipients[i], amounts[i]);
            emit TokensMinted(recipients[i], amounts[i], block.timestamp);
        }
    }
    
    // ========== BURNING FUNCTIONS ==========
    
    /**
     * @notice Burn tokens (override to add event)
     * @param amount Amount to burn
     */
    function burn(uint256 amount) public override {
        super.burn(amount);
        emit TokensBurned(msg.sender, amount, block.timestamp);
    }
    
    /**
     * @notice Burn tokens from another address (override to add event)
     * @param account Address to burn from
     * @param amount Amount to burn
     */
    function burnFrom(address account, uint256 amount) public override {
        super.burnFrom(account, amount);
        emit TokensBurned(account, amount, block.timestamp);
    }
    
    // ========== ADMIN FUNCTIONS ==========
    
    /**
     * @notice Update asset document URI
     * @param newDocumentURI New IPFS hash
     */
    function updateDocumentURI(string memory newDocumentURI) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        assetMetadata.documentURI = newDocumentURI;
        emit AssetMetadataUpdated(newDocumentURI);
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
     * @notice This function is called for ALL transfers (transfer, transferFrom, mint, burn)
     */
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        // Allow minting (from == address(0)) and burning (to == address(0))
        if (from != address(0) && to != address(0)) {
            // Check blacklist FIRST (higher priority than whitelist)
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
        
        super._update(from, to, value);
    }
    
    // ========== VIEW FUNCTIONS ==========
    
    /**
     * @notice Check if an address can receive tokens
     * @param account Address to check
     * @return bool True if address is compliant
     */
    function canReceiveTokens(address account) external view returns (bool) {
        return kycRegistry.isWhitelisted(account) && !kycRegistry.isBlacklisted(account);
    }
    
    /**
     * @notice Get asset metadata
     * @return AssetMetadata struct
     */
    function getAssetMetadata() external view returns (AssetMetadata memory) {
        return assetMetadata;
    }
    
    /**
     * @notice Calculate price per token based on total value
     * @return uint256 Price per token (in base currency)
     */
    function pricePerToken() external view returns (uint256) {
        if (MAX_SUPPLY == 0) return 0;
        // Convert MAX_SUPPLY from Wei to whole tokens
        uint256 supplyInTokens = MAX_SUPPLY / (10 ** decimals());
        return assetMetadata.totalValue / supplyInTokens;
    }
    
    /**
     * @notice Get remaining supply available for minting
     * @return uint256 Remaining tokens
     */
    function remainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }
    
    /**
     * @notice Check if minting is still possible
     * @return bool True if supply not exhausted
     */
    function canMint() external view returns (bool) {
        return totalSupply() < MAX_SUPPLY;
    }
    
    /**
     * @notice Get percentage of asset owned by an address
     * @param account Address to check
     * @return uint256 Ownership percentage (in basis points, 10000 = 100%)
     */
    function ownershipPercentage(address account) external view returns (uint256) {
        if (MAX_SUPPLY == 0) return 0;
        return (balanceOf(account) * 10000) / MAX_SUPPLY;
    }
}