// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract ClaimSettlement is ReentrancyGuard, AccessControl, Pausable {
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant HOSPITAL_ROLE = keccak256("HOSPITAL_ROLE");

    enum ClaimStatus { Submitted, Validated, Approved, Rejected, Settled }

    struct Claim {
        uint256 id;
        string hospitalId;
        uint256 amount; // In smallest unit (e.g., Wei)
        string currency; // e.g., "INR", "EUR"
        string ipfsHash; // Link to documents
        ClaimStatus status;
        uint256 timestamp;
    }

    mapping(uint256 => Claim) public claims;
    mapping(uint256 => bool) public claimExists;
    
    event ClaimSubmitted(uint256 indexed id, string hospitalId, uint256 amount);
    event ClaimValidated(uint256 indexed id, bool isValid, uint256 fraudScore);
    event ClaimSettled(uint256 indexed id, uint256 amount);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function addValidator(address _validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(VALIDATOR_ROLE, _validator);
        emit ValidatorAdded(_validator);
    }

    function removeValidator(address _validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(VALIDATOR_ROLE, _validator);
        emit ValidatorRemoved(_validator);
    }

    function submitClaim(
        uint256 _id, 
        string memory _hospitalId, 
        uint256 _amount, 
        string memory _currency, 
        string memory _ipfsHash
    ) external whenNotPaused {
        require(!claimExists[_id], "Claim already exists");
        require(_amount > 0, "Amount must be greater than 0");
        require(bytes(_hospitalId).length > 0, "Invalid hospital ID");
        require(bytes(_ipfsHash).length > 0, "Invalid IPFS hash");
        
        // In production, we would check if msg.sender has HOSPITAL_ROLE
        // require(hasRole(HOSPITAL_ROLE, msg.sender), "Caller is not a registered hospital");

        claims[_id] = Claim({
            id: _id,
            hospitalId: _hospitalId,
            amount: _amount,
            currency: _currency,
            ipfsHash: _ipfsHash,
            status: ClaimStatus.Submitted,
            timestamp: block.timestamp
        });
        claimExists[_id] = true;

        emit ClaimSubmitted(_id, _hospitalId, _amount);
    }

    function validateClaim(uint256 _id, bool _isValid, uint256 _fraudScore) external onlyRole(VALIDATOR_ROLE) whenNotPaused {
        require(claimExists[_id], "Claim does not exist");
        require(claims[_id].status == ClaimStatus.Submitted, "Invalid status");

        if (_isValid && _fraudScore < 20) { // Threshold for auto-approval
            claims[_id].status = ClaimStatus.Approved;
        } else {
            claims[_id].status = ClaimStatus.Rejected;
        }

        emit ClaimValidated(_id, _isValid, _fraudScore);
    }

    function settleClaim(uint256 _id) external onlyRole(VALIDATOR_ROLE) nonReentrant whenNotPaused {
        require(claims[_id].status == ClaimStatus.Approved, "Claim not approved");
        
        // In a real system, this would trigger an ERC20 transfer
        // require(token.transfer(hospitalAddress, claims[_id].amount), "Transfer failed");
        
        claims[_id].status = ClaimStatus.Settled;
        
        emit ClaimSettled(_id, claims[_id].amount);
    }

    function getClaim(uint256 _id) external view returns (Claim memory) {
        return claims[_id];
    }
}
