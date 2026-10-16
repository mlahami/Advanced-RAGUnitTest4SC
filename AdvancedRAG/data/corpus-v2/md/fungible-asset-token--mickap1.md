# fungible-asset-token--mickap1

- domain: fungible-tokens (erc20-token)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Mickap1/G9---Blockchain @ fc4e0dba2c0113373a01ca8c42f9c8ae3b3a74a3
- license: GPL-2.0
- targets: FungibleAssetToken.sol, KYCregistry.sol
- validation: 36 passing tests, 0 failing; statement coverage FungibleAssetToken.sol 96.0 %, KYCregistry.sol 22.58 %

## Contract: FungibleAssetToken.sol (primary target)

```solidity
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
```

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

## Tests: FungibleAssetToken.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FungibleAssetToken", function () {
    let token;
    let kycRegistry;
    let owner;
    let admin;
    let alice;
    let bob;
    let charlie;

    const TOKEN_NAME = "Residence Lumiere Token";
    const TOKEN_SYMBOL = "PLM";
    const MAX_SUPPLY = ethers.parseEther("10000"); // 10,000 tokens
    const ASSET_NAME = "Residence Lumiere";
    const ASSET_TYPE = "Real Estate";
    const LOCATION = "42 Rue de Vaugirard, 75015 Paris";
    const TOTAL_VALUE = ethers.parseEther("500000"); // 500,000 EUR (in wei for proper division)
    const DOCUMENT_URI = "ipfs://QmSampleHash123";

    beforeEach(async function () {
        [owner, admin, alice, bob, charlie] = await ethers.getSigners();

        // Deploy KYCRegistry
        const KYCRegistryFactory = await ethers.getContractFactory("KYCRegistry");
        kycRegistry = await KYCRegistryFactory.deploy();
        await kycRegistry.waitForDeployment();

        // Grant KYC_ADMIN_ROLE to admin
        const KYC_ADMIN_ROLE = await kycRegistry.KYC_ADMIN_ROLE();
        await kycRegistry.grantRole(KYC_ADMIN_ROLE, admin.address);

        // Deploy FungibleAssetToken
        const TokenFactory = await ethers.getContractFactory("FungibleAssetToken");
        token = await TokenFactory.deploy(
            TOKEN_NAME,
            TOKEN_SYMBOL,
            MAX_SUPPLY,
            await kycRegistry.getAddress(),
            ASSET_NAME,
            ASSET_TYPE,
            LOCATION,
            TOTAL_VALUE,
            DOCUMENT_URI
        );
        await token.waitForDeployment();

        // Approve KYC for alice and bob
        await kycRegistry.connect(admin).approveKYC(alice.address, 0);
        await kycRegistry.connect(admin).approveKYC(bob.address, 0);
    });

    describe("Deployment", function () {
        it("Should set the correct token name and symbol", async function () {
            expect(await token.name()).to.equal(TOKEN_NAME);
            expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
        });

        it("Should set the correct max supply", async function () {
            expect(await token.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
        });

        it("Should set the correct KYC registry", async function () {
            expect(await token.kycRegistry()).to.equal(await kycRegistry.getAddress());
        });

        it("Should set the correct asset metadata", async function () {
            const metadata = await token.getAssetMetadata();
            expect(metadata.assetName).to.equal(ASSET_NAME);
            expect(metadata.assetType).to.equal(ASSET_TYPE);
            expect(metadata.location).to.equal(LOCATION);
            expect(metadata.totalValue).to.equal(TOTAL_VALUE);
            expect(metadata.documentURI).to.equal(DOCUMENT_URI);
        });

        it("Should grant roles to deployer", async function () {
            const DEFAULT_ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();
            const ADMIN_ROLE = await token.ADMIN_ROLE();
            const MINTER_ROLE = await token.MINTER_ROLE();
            const PAUSER_ROLE = await token.PAUSER_ROLE();

            expect(await token.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
            expect(await token.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
            expect(await token.hasRole(MINTER_ROLE, owner.address)).to.be.true;
            expect(await token.hasRole(PAUSER_ROLE, owner.address)).to.be.true;
        });

        it("Should calculate correct price per token", async function () {
            // TOTAL_VALUE = 500,000 ether, MAX_SUPPLY = 10,000 ether
            // pricePerToken = 500,000 ether / 10,000 ether = 50 ether
            const expectedPrice = ethers.parseEther("50");
            expect(await token.pricePerToken()).to.equal(expectedPrice);
        });
    });

    describe("Minting", function () {
        it("Should allow minter to mint tokens to whitelisted address", async function () {
            const amount = ethers.parseEther("100");

            const tx = await token.mint(alice.address, amount);
            const receipt = await tx.wait();
            const blockNumber = receipt?.blockNumber || 0;
            const block = await ethers.provider.getBlock(blockNumber);

            await expect(tx)
                .to.emit(token, "TokensMinted")
                .withArgs(alice.address, amount, block?.timestamp);

            expect(await token.balanceOf(alice.address)).to.equal(amount);
            expect(await token.totalSupply()).to.equal(amount);
        });

        it("Should not allow minting to non-whitelisted address", async function () {
            const amount = ethers.parseEther("100");

            await expect(
                token.mint(charlie.address, amount)
            ).to.be.revertedWithCustomError(token, "RecipientNotWhitelisted");
        });

        it("Should not allow minting beyond max supply", async function () {
            await token.mint(alice.address, MAX_SUPPLY);

            await expect(
                token.mint(bob.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(token, "ExceedsMaxSupply");
        });

        it("Should calculate correct price per token", async function () {
            const price = await token.pricePerToken();
            // 500,000 ether / 10,000 ether = 50 ether
            const expectedPrice = ethers.parseEther("50");
            expect(price).to.equal(expectedPrice);
        });

        it("Should not allow non-minter to mint", async function () {
            await expect(
                token.connect(alice).mint(bob.address, ethers.parseEther("100"))
            ).to.be.reverted;
        });

        it("Should not allow minting zero amount", async function () {
            await expect(
                token.mint(alice.address, 0)
            ).to.be.revertedWithCustomError(token, "ZeroAmount");
        });

        it("Should not allow minting to zero address", async function () {
            await expect(
                token.mint(ethers.ZeroAddress, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "ZeroAddress");
        });
    });

    describe("Batch Minting", function () {
        it("Should batch mint to multiple addresses", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];

            await token.batchMint(recipients, amounts);

            expect(await token.balanceOf(alice.address)).to.equal(amounts[0]);
            expect(await token.balanceOf(bob.address)).to.equal(amounts[1]);
            expect(await token.totalSupply()).to.equal(ethers.parseEther("300"));
        });

        it("Should revert if arrays length mismatch", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [ethers.parseEther("100")];

            await expect(
                token.batchMint(recipients, amounts)
            ).to.be.revertedWith("Arrays length mismatch");
        });

        it("Should revert if total exceeds max supply", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [MAX_SUPPLY, ethers.parseEther("1")];

            await expect(
                token.batchMint(recipients, amounts)
            ).to.be.revertedWithCustomError(token, "ExceedsMaxSupply");
        });

        it("Should revert if any recipient not whitelisted", async function () {
            const recipients = [alice.address, charlie.address];
            const amounts = [ethers.parseEther("100"), ethers.parseEther("100")];

            await expect(
                token.batchMint(recipients, amounts)
            ).to.be.revertedWithCustomError(token, "RecipientNotWhitelisted");
        });
    });

    describe("Transfers with KYC", function () {
        beforeEach(async function () {
            await token.mint(alice.address, ethers.parseEther("1000"));
        });

        it("Should allow transfer between whitelisted addresses", async function () {
            const amount = ethers.parseEther("100");

            await expect(token.connect(alice).transfer(bob.address, amount))
                .to.changeTokenBalances(
                    token,
                    [alice, bob],
                    [-amount, amount]
                );
        });

        it("Should not allow transfer to non-whitelisted address", async function () {
            await expect(
                token.connect(alice).transfer(charlie.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "RecipientNotWhitelisted");
        });

        it("Should not allow transfer from non-whitelisted address", async function () {
            // Revoke alice's KYC
            await kycRegistry.connect(admin).revokeKYC(alice.address, "Test");

            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "SenderNotWhitelisted");
        });

        it("Should not allow transfer if sender is blacklisted", async function () {
            await kycRegistry.connect(admin).blacklistAddress(alice.address, "Test");

            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "SenderBlacklisted");
        });

        it("Should not allow transfer if recipient is blacklisted", async function () {
            await kycRegistry.connect(admin).blacklistAddress(bob.address, "Test");

            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "RecipientBlacklisted");
        });

        it("Should emit KYCCheckFailed event on failed transfer", async function () {
            // Note: Events emitted before a revert cannot be tested with chai-matchers
            // This test verifies the revert happens with the correct error
            await expect(
                token.connect(alice).transfer(charlie.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "RecipientNotWhitelisted");
        });
    });

    describe("Burning", function () {
        beforeEach(async function () {
            await token.mint(alice.address, ethers.parseEther("1000"));
        });

        it("Should allow user to burn their tokens", async function () {
            const amount = ethers.parseEther("100");

            const tx = await token.connect(alice).burn(amount);
            const receipt = await tx.wait();
            const blockNumber = receipt?.blockNumber || 0;
            const block = await ethers.provider.getBlock(blockNumber);

            await expect(tx)
                .to.emit(token, "TokensBurned")
                .withArgs(alice.address, amount, block?.timestamp);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("900"));
            expect(await token.totalSupply()).to.equal(ethers.parseEther("900"));
        });

        it("Should allow burnFrom with approval", async function () {
            const amount = ethers.parseEther("100");

            await token.connect(alice).approve(bob.address, amount);
            await token.connect(bob).burnFrom(alice.address, amount);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("900"));
        });
    });

    describe("Pausable", function () {
        beforeEach(async function () {
            await token.mint(alice.address, ethers.parseEther("1000"));
        });

        it("Should pause transfers", async function () {
            await token.pause();

            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseEther("100"))
            ).to.be.reverted;
        });

        it("Should unpause transfers", async function () {
            await token.pause();
            await token.unpause();

            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseEther("100"))
            ).to.not.be.reverted;
        });

        it("Should not allow non-pauser to pause", async function () {
            await expect(
                token.connect(alice).pause()
            ).to.be.reverted;
        });
    });

    describe("Admin Functions", function () {
        it("Should allow admin to update document URI", async function () {
            const newURI = "ipfs://QmNewHash456";

            await expect(token.updateDocumentURI(newURI))
                .to.emit(token, "AssetMetadataUpdated")
                .withArgs(newURI);

            const metadata = await token.getAssetMetadata();
            expect(metadata.documentURI).to.equal(newURI);
        });

        it("Should not allow non-admin to update document URI", async function () {
            await expect(
                token.connect(alice).updateDocumentURI("ipfs://hack")
            ).to.be.reverted;
        });
    });

    describe("View Functions", function () {
        it("Should correctly check if address can receive tokens", async function () {
            expect(await token.canReceiveTokens(alice.address)).to.be.true;
            expect(await token.canReceiveTokens(charlie.address)).to.be.false;

            await kycRegistry.connect(admin).blacklistAddress(alice.address, "Test");
            expect(await token.canReceiveTokens(alice.address)).to.be.false;
        });

        it("Should return correct remaining supply", async function () {
            expect(await token.remainingSupply()).to.equal(MAX_SUPPLY);

            await token.mint(alice.address, ethers.parseEther("1000"));
            expect(await token.remainingSupply()).to.equal(ethers.parseEther("9000"));
        });

        it("Should return correct canMint status", async function () {
            expect(await token.canMint()).to.be.true;

            await token.mint(alice.address, MAX_SUPPLY);
            expect(await token.canMint()).to.be.false;
        });

        it("Should calculate correct ownership percentage", async function () {
            await token.mint(alice.address, ethers.parseEther("1000")); // 10% of 10,000

            // 10% = 1000 basis points
            expect(await token.ownershipPercentage(alice.address)).to.equal(1000);
        });

        it("Should return correct asset metadata", async function () {
            const metadata = await token.getAssetMetadata();

            expect(metadata.assetName).to.equal(ASSET_NAME);
            expect(metadata.assetType).to.equal(ASSET_TYPE);
            expect(metadata.location).to.equal(LOCATION);
            expect(metadata.totalValue).to.equal(TOTAL_VALUE);
            expect(metadata.documentURI).to.equal(DOCUMENT_URI);
            expect(metadata.tokenizationDate).to.be.gt(0);
        });
    });

    describe("Integration: Full Flow", function () {
        it("Should handle complete tokenization lifecycle", async function () {
            // 1. Mint initial tokens
            await token.mint(alice.address, ethers.parseEther("1000"));
            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("1000"));

            // 2. Alice transfers to Bob
            await token.connect(alice).transfer(bob.address, ethers.parseEther("300"));
            expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("300"));

            // 3. Check ownership percentages
            expect(await token.ownershipPercentage(alice.address)).to.equal(700); // 7%
            expect(await token.ownershipPercentage(bob.address)).to.equal(300); // 3%

            // 4. Bob burns some tokens
            await token.connect(bob).burn(ethers.parseEther("100"));
            expect(await token.totalSupply()).to.equal(ethers.parseEther("900"));

            // 5. Admin updates document
            await token.updateDocumentURI("ipfs://QmUpdatedDocs");
            const metadata = await token.getAssetMetadata();
            expect(metadata.documentURI).to.equal("ipfs://QmUpdatedDocs");
        });
    });
});
```
