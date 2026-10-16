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