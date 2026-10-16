// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

import "./PropertyStorage.sol";
import "./HistoryTracker.sol";

contract TransferLogic is PropertyStorage {
    event OwnershipUpdated(uint indexed propertyId, address[] newOwners, uint[] percentages); // Emitted when ownership is updated
    event OwnershipTransferInitiated(uint indexed propertyId, address[] newOwners, address indexed initiator); // Emitted when an ownership transfer is initiated
    event OwnershipTransferApproved(uint indexed propertyId, address indexed approver, address indexed whoHasToApprove); // Emitted when an ownership transfer is approved not by all the owners

    // Modifier to restrict access to government entities
    modifier onlyGovernment() {
        require(
            isGovernment[msg.sender],
            "Only government entities can perform this action"
        );
        _;
    }

    // Modifier to restrict access to the contract (only callable by: contract owner, government, or authorized professionals)
    modifier onlyAuthorized(uint _propertyId) {
        require(
            isGovernment[msg.sender] ||
                msg.sender == contractOwner ||
                (isProfessional[msg.sender] &&
                    authorizedProperties[msg.sender][_propertyId]) ||
                    propertyToOwnerToPercentage[_propertyId][msg.sender] > 0,
            "Only authorized entities can perform this action"
        );
        _;
    }

    /**
     * @notice Initiates an ownership transfer, creating a request that requires a second approval.
     * @dev Can be called by either a government entity or the current property owner.
     * @param _propertyId The ID of the property to transfer.
     * @param _newOwners The addresses of the intended new owners.
     * @param _percentages The ownership percentages for each new owner.
     */
    function initiateOwnershipTransfer(uint _propertyId, address[] memory _newOwners, uint[] memory _percentages) external {
        require(isGovernment[msg.sender] || propertyToOwnerToPercentage[_propertyId][msg.sender] > 0, "Only government or the current owner can initiate a transfer.");
        require(_newOwners.length > 0 && _newOwners.length == _percentages.length, "New owners and percentages must be non-empty and of equal length.");
        require(ownershipTransferRequests[_propertyId].newOwners.length == 0, "There is already a pending transfer request for this property.");

        // Check if the percentage array sums to 100%
        uint totalPercentage = 0;
        for(uint i = 0; i < _percentages.length; i++) {
            totalPercentage += _percentages[i];
        }
        require(totalPercentage == 100, "Total new ownership must be 100.");

        // Create a new transfer request
        TransferRequest storage request = ownershipTransferRequests[_propertyId];
        request.newOwners = _newOwners;
        request.percentages = _percentages;

        if (isGovernment[msg.sender]) {
            request.governmentApproved = true;
        } else {
            request.ownersApproval[msg.sender] = true; // Mark the owner as having approved the transfer
        }

        emit OwnershipTransferInitiated(_propertyId, _newOwners, msg.sender);
    }

    /**
     * @notice Approves a pending ownership transfer.
     * @dev Must be called by the party that did not initiate the transfer (government or owner).
     * @param _propertyId The ID of the property to transfer.
     */
    function approveOwnershipTransfer(uint _propertyId) external {
        TransferRequest storage request = ownershipTransferRequests[_propertyId];

        require(request.newOwners.length != 0, "No transfer request for this property.");
        require(isGovernment[msg.sender] || propertyToOwnerToPercentage[_propertyId][msg.sender] > 0, "Only government or the current owner can approve a transfer.");
        
        if (isGovernment[msg.sender]) {
            require(!request.governmentApproved, "Government has already approved this transfer.");
            request.governmentApproved = true;
        } else {
            require(!request.ownersApproval[msg.sender], "You have already approved this transfer.");
            request.ownersApproval[msg.sender] = true;
        }

        // Check if all new owners have approved the transfer
        bool allApproved = true;
        for (uint i = 0; i < propertyToOwners[_propertyId].length; i++) {
            if (!request.ownersApproval[propertyToOwners[_propertyId][i]]) {    // Check if the owner has approved the transfer
                allApproved = false;
                emit OwnershipTransferApproved(_propertyId, msg.sender, propertyToOwners[_propertyId][i]); // Emit an event for tracking
                break;
            }
        }

        // If all parties have approved, execute the transfer.
        if (request.governmentApproved && allApproved) {
            _executeOwnershipTransfer(_propertyId);
        }
    }

    /**
     * @notice Internal function to finalize the ownership transfer after all approvals are received.
     * @param _propertyId The ID of the property being transferred.
     */
    function _executeOwnershipTransfer(uint _propertyId) internal {
        TransferRequest storage request = ownershipTransferRequests[_propertyId];

        address[] memory oldOwners = propertyToOwners[_propertyId]; // Get the current owners

        uint[] memory oldPercentages = new uint[](oldOwners.length); // Create an array to store the old percentages
        // Populate the old percentages array
        for (uint i = 0; i < oldOwners.length; i++) {
            oldPercentages[i] = propertyToOwnerToPercentage[_propertyId][oldOwners[i]]; // Get the old ownership percentage for each owner
        }

        // Clear the old ownership mapping
        for (uint i = 0; i < oldOwners.length; i++) {
            delete propertyToOwnerToPercentage[_propertyId][oldOwners[i]]; // Remove old owners
        }

        // Update the ownership mapping with the new owners and their percentages
        for (uint i = 0; i < request.newOwners.length; i++) {
            require(request.newOwners[i] != address(0), "New owner address cannot be zero.");
            require(request.percentages[i] > 0, "Ownership percentage must be greater than zero.");
            propertyToOwnerToPercentage[_propertyId][request.newOwners[i]] = request.percentages[i]; // Set the new ownership percentage for each new owner
        }

        delete propertyToOwners[_propertyId];
        propertyToOwners[_propertyId] = request.newOwners; // Update the list of owners

        historyTracker.logChange(
            _propertyId,
            msg.sender, // The approver who completes the transaction
            "owners",
            abi.encode(oldOwners),
            abi.encode(request.newOwners)
        );

        historyTracker.logChange(
            _propertyId,
            msg.sender, // The approver who completes the transaction
            "percentages",
            abi.encode(oldPercentages),
            abi.encode(request.percentages)
        );

        emit OwnershipUpdated(_propertyId, request.newOwners, request.percentages); // Emit an event for tracking
        
        // Clean up the completed request

        // For each address in ownersApproval reset the approval status
        for (uint i = 0; i < propertyToOwners[_propertyId].length; i++) {
            address owner = propertyToOwners[_propertyId][i];
            delete ownershipTransferRequests[_propertyId].ownersApproval[owner];
        }
        
        delete ownershipTransferRequests[_propertyId];
    }

    /**
     * @notice Cancels a pending ownership transfer request.
     * @dev Can be called by the government.
     * @param _propertyId The ID of the property with a pending transfer.
     */
    function cancelOwnershipTransfer(uint _propertyId) external onlyGovernment {
        require(ownershipTransferRequests[_propertyId].newOwners.length != 0, "No transfer request to cancel.");
        
        // Clean up the completed request

        // For each address in ownersApproval reset the approval status
        for (uint i = 0; i < propertyToOwners[_propertyId].length; i++) {
            address owner = propertyToOwners[_propertyId][i];
            delete ownershipTransferRequests[_propertyId].ownersApproval[owner];
        }
        
        delete ownershipTransferRequests[_propertyId];
    }
}