// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EnerpayRemittance
 * @notice Smart contract for handling remittances on Celo using cUSD
 * @dev Allows users to send remittances with platform fees and tracking
 */
contract EnerpayRemittance is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    
    // ============ State Variables ============
    
    /// @notice cUSD token contract address
    IERC20 public cUSD;
    
    /// @notice Treasury address for collecting platform fees
    address public treasuryAddress;
    
    /// @notice Platform fee in basis points (150 = 1.5%)
    uint256 public platformFee = 150;
    
    /// @notice Mapping of remittance ID to Remittance struct
    mapping(uint256 => Remittance) public remittances;
    
    /// @notice Counter for remittance IDs
    uint256 public remittanceCount;
    
    /// @notice Mapping of user address to array of remittance IDs
    mapping(address => uint256[]) public userRemittances;
    
    // ============ Structs ============
    
    /**
     * @notice Remittance data structure
     * @param sender Address of the sender
     * @param beneficiary Address of the beneficiary
     * @param amount Amount in cUSD (without fees)
     * @param destinationType Type of destination (e.g., "wallet", "bank", "mobile")
     * @param destinationId Identifier for the destination
     * @param timestamp When the remittance was created
     * @param status Current status of the remittance
     */
    struct Remittance {
        address sender;
        address beneficiary;
        uint256 amount;
        string destinationType;
        string destinationId;
        uint256 timestamp;
        RemittanceStatus status;
    }
    
    // ============ Enums ============
    
    /**
     * @notice Status of a remittance
     */
    enum RemittanceStatus {
        Pending,    // Remittance created but not completed
        Completed,  // Remittance successfully completed
        Failed,     // Remittance failed
        Refunded    // Remittance refunded to sender
    }
    
    // ============ Events ============
    
    /**
     * @notice Emitted when a new remittance is created
     * @param remittanceId Unique identifier for the remittance
     * @param sender Address of the sender
     * @param beneficiary Address of the beneficiary
     * @param amount Amount in cUSD
     * @param fee Platform fee charged
     * @param destinationType Type of destination
     * @param destinationId Identifier for the destination
     */
    event RemittanceCreated(
        uint256 indexed remittanceId,
        address indexed sender,
        address indexed beneficiary,
        uint256 amount,
        uint256 fee,
        string destinationType,
        string destinationId
    );
    
    /**
     * @notice Emitted when a remittance is completed
     * @param remittanceId Unique identifier for the remittance
     * @param status Final status of the remittance
     */
    event RemittanceCompleted(
        uint256 indexed remittanceId,
        RemittanceStatus status
    );
    
    // ============ Modifiers ============
    
    /**
     * @notice Ensures the remittance exists
     */
    modifier remittanceExists(uint256 _remittanceId) {
        require(_remittanceId < remittanceCount, "Remittance does not exist");
        _;
    }
    
    // ============ Constructor ============
    
    /**
     * @notice Initializes the contract
     * @param _cUSD Address of the cUSD token contract
     * @param _treasuryAddress Address where platform fees will be sent
     */
    constructor(address _cUSD, address _treasuryAddress) Ownable(msg.sender) {
        require(_cUSD != address(0), "Invalid cUSD address");
        require(_treasuryAddress != address(0), "Invalid treasury address");
        
        cUSD = IERC20(_cUSD);
        treasuryAddress = _treasuryAddress;
    }
    
    // ============ External Functions ============
    
    /**
     * @notice Sends a remittance
     * @param _beneficiary Address of the beneficiary
     * @param _amount Amount in cUSD (without fees)
     * @param _destinationType Type of destination (e.g., "wallet", "bank", "mobile")
     * @param _destinationId Identifier for the destination
     * @return remittanceId Unique identifier for the created remittance
     */
    function sendRemittance(
        address _beneficiary,
        uint256 _amount,
        string memory _destinationType,
        string memory _destinationId
    ) external nonReentrant returns (uint256) {
        require(_beneficiary != address(0), "Invalid beneficiary address");
        require(_amount > 0, "Amount must be greater than 0");
        require(
            bytes(_destinationType).length > 0,
            "Destination type cannot be empty"
        );
        
        // Calculate platform fee
        uint256 fee = (_amount * platformFee) / 10000;
        uint256 totalAmount = _amount + fee;
        
        // Transfer cUSD from user to contract
        cUSD.safeTransferFrom(msg.sender, address(this), totalAmount);
        
        // Create remittance record
        uint256 remittanceId = remittanceCount;
        remittances[remittanceId] = Remittance({
            sender: msg.sender,
            beneficiary: _beneficiary,
            amount: _amount,
            destinationType: _destinationType,
            destinationId: _destinationId,
            timestamp: block.timestamp,
            status: RemittanceStatus.Pending
        });
        
        // Add to user's remittance history
        userRemittances[msg.sender].push(remittanceId);
        
        remittanceCount++;
        
        // Transfer fee to treasury
        if (fee > 0) {
            // Verify contract has sufficient balance before transferring fee
            uint256 contractBalance = cUSD.balanceOf(address(this));
            require(contractBalance >= fee, "Insufficient contract balance for fee transfer");
            cUSD.safeTransfer(treasuryAddress, fee);
        }
        
        // If wallet-to-wallet, transfer immediately
        if (
            keccak256(bytes(_destinationType)) ==
            keccak256(bytes("wallet"))
        ) {
            cUSD.safeTransfer(_beneficiary, _amount);
            remittances[remittanceId].status = RemittanceStatus.Completed;
            
            emit RemittanceCompleted(
                remittanceId,
                RemittanceStatus.Completed
            );
        }
        
        emit RemittanceCreated(
            remittanceId,
            msg.sender,
            _beneficiary,
            _amount,
            fee,
            _destinationType,
            _destinationId
        );
        
        return remittanceId;
    }
    
    /**
     * @notice Completes a remittance (only owner)
     * @param _remittanceId ID of the remittance to complete
     * @param _status Final status (Completed, Failed, or Refunded)
     */
    function completeRemittance(
        uint256 _remittanceId,
        RemittanceStatus _status
    ) external onlyOwner remittanceExists(_remittanceId) {
        Remittance storage remittance = remittances[_remittanceId];
        
        require(
            remittance.status == RemittanceStatus.Pending,
            "Remittance already processed"
        );
        require(
            _status == RemittanceStatus.Completed ||
                _status == RemittanceStatus.Failed ||
                _status == RemittanceStatus.Refunded,
            "Invalid status"
        );
        
        remittance.status = _status;
        
        if (_status == RemittanceStatus.Completed) {
            // Transfer amount to beneficiary
            cUSD.safeTransfer(remittance.beneficiary, remittance.amount);
        } else if (_status == RemittanceStatus.Refunded) {
            // Refund amount to sender
            cUSD.safeTransfer(remittance.sender, remittance.amount);
        }
        // If Failed, amount stays in contract (can be handled separately)
        
        emit RemittanceCompleted(_remittanceId, _status);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Gets remittance history for a user
     * @param _user Address of the user
     * @return Array of remittance IDs belonging to the user
     */
    function getRemittanceHistory(
        address _user
    ) external view returns (uint256[] memory) {
        return userRemittances[_user];
    }
    
    /**
     * @notice Gets details of a specific remittance
     * @param _remittanceId ID of the remittance
     * @return Remittance struct with all details
     */
    function getRemittance(
        uint256 _remittanceId
    ) external view remittanceExists(_remittanceId) returns (Remittance memory) {
        return remittances[_remittanceId];
    }
    
    /**
     * @notice Calculates the platform fee for a given amount
     * @param _amount Amount in cUSD
     * @return fee Calculated fee
     * @return totalAmount Total amount including fee
     */
    function calculateFee(
        uint256 _amount
    ) external view returns (uint256 fee, uint256 totalAmount) {
        fee = (_amount * platformFee) / 10000;
        totalAmount = _amount + fee;
    }
    
    // ============ Owner Functions ============
    
    /**
     * @notice Updates the platform fee (only owner)
     * @param _newFee New fee in basis points (e.g., 150 = 1.5%)
     */
    function setPlatformFee(uint256 _newFee) external onlyOwner {
        require(_newFee <= 1000, "Fee cannot exceed 10%");
        platformFee = _newFee;
    }
    
    /**
     * @notice Updates the treasury address (only owner)
     * @param _newTreasury New treasury address
     */
    function setTreasuryAddress(address _newTreasury) external onlyOwner {
        require(_newTreasury != address(0), "Invalid treasury address");
        treasuryAddress = _newTreasury;
    }
    
    /**
     * @notice Emergency function to withdraw stuck funds (only owner)
     * @param _amount Amount to withdraw
     * @param _to Address to send funds to
     */
    function emergencyWithdraw(
        uint256 _amount,
        address _to
    ) external onlyOwner {
        require(_to != address(0), "Invalid address");
        cUSD.safeTransfer(_to, _amount);
    }
}

