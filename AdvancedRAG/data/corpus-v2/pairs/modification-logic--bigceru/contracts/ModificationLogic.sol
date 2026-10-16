// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

import "./PropertyStorage.sol";
import "./HistoryTracker.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract ModificationLogic is PropertyStorage {
    event ModificationDone(uint indexed propertyId, string _newIpfsHash, string _description); // Emitted when ownership is updated
    event ModificationInitiated(uint indexed propertyId, string _newIpfsHash, address indexed initiator); // Emitted when an ownership transfer is initiated
    event ModificationApproved(uint indexed propertyId, address indexed approver, address indexed whoHasToApprove); // Emitted when an ownership transfer is approved not by all the owners

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
                    authorizedProperties[msg.sender][_propertyId]),
            "Only authorized entities can perform this action"
        );
        _;
    }

    modifier onlyAuthorizedOwner(uint _propertyId) {
        require(
            propertyToOwnerToPercentage[_propertyId][msg.sender] > 0,
            "Only owners can perform this action"
        );
        _;
    }

    /**
     * @notice Initiates a modification request for a property.
     * @dev Can be called by a government entity, the current property owner, a professional.
     * @param _propertyId The ID of the property to modify.
     * @param _newIpfsHash The new IPFS hash to set for the property.
     * @param _description A description of the modification.
     */
    function initiateModification(uint _propertyId, string memory _newIpfsHash, string memory _description, uint _hashIndex) external onlyAuthorized(_propertyId) {
        require(bytes(_newIpfsHash).length != 0, "New IPFS hash must be non-empty.");
        require(bytes(_description).length != 0, "Description must be non-empty.");
        require(bytes(modificationRequestMap[_propertyId].newIpfsHash).length == 0, "There is already a pending transfer request for this property.");
        // Ensure there is an actual change to prevent unnecessary transactions
        require(_hashIndex == properties[_propertyId].ipfsHash.length || keccak256(abi.encodePacked(properties[_propertyId].ipfsHash[_hashIndex])) != keccak256(abi.encodePacked(_newIpfsHash)), "New IPFS hash is the same as the old one.");


        // Create a new transfer request
        ModificationRequest storage request = modificationRequestMap[_propertyId];
        request.newIpfsHash = _newIpfsHash;
        request.description = _description;
        request.hashIndex = _hashIndex;         // Store the index of the IPFS hash in the property array

        request.professionalApproved = true;

        emit ModificationInitiated(_propertyId, _newIpfsHash, msg.sender);
    }

    /**
     * @notice Approves a pending modification request.
     * @dev Can be called by the current property owners.
     * @param _propertyId The ID of the property being modified.
     */
    function approveModification(uint _propertyId) external onlyAuthorizedOwner(_propertyId) {
        ModificationRequest storage request = modificationRequestMap[_propertyId];

        require(bytes(request.newIpfsHash).length != 0, "No modification request found for this property.");
        
        require(!request.ownersApproval[msg.sender], "You have already approved this transfer.");
        request.ownersApproval[msg.sender] = true;

        // Check if all new owners have approved the transfer
        bool allApproved = true;
        for (uint i = 0; i < propertyToOwners[_propertyId].length; i++) {
            if (!request.ownersApproval[propertyToOwners[_propertyId][i]]) {    // Check if the owner has approved the transfer
                allApproved = false;
                emit ModificationApproved(_propertyId, msg.sender, propertyToOwners[_propertyId][i]); // Emit an event for tracking
                break;
            }
        }

        // If all parties have approved, execute the transfer.
        if (request.professionalApproved && allApproved) {
            _executeModification(_propertyId);
        }
    }

    /**
     * @notice Internal function to finalize the modification request after all approvals are received.
     * @param _propertyId The ID of the property being modified.
     */
    function _executeModification(uint _propertyId) internal {
        Property storage prop = properties[_propertyId];
        ModificationRequest storage request = modificationRequestMap[_propertyId];

        require(bytes(prop.geoHash).length != 0, "Property does not exist");

        string memory oldIpfsHash;

        // Check index
        if (request.hashIndex >= prop.ipfsHash.length) {
            // New document is added
            oldIpfsHash = ""; // No old hash if we're adding a new one
        }
        else {
            // Existing document is modified
            oldIpfsHash = prop.ipfsHash[request.hashIndex];
        }

        
        // Ensure there is an actual change to prevent unnecessary transactions
        require(keccak256(abi.encodePacked(oldIpfsHash)) != keccak256(abi.encodePacked(request.newIpfsHash)), "New IPFS hash is the same as the old one.");

        // Log the change before updating the state.
        // We cast the bytes32 hashes to dynamic bytes to fit the logChange function signature.
        historyTracker.logChange(
            _propertyId,
            msg.sender,
            string(abi.encodePacked("ipfsHash[", Strings.toString(request.hashIndex), "]: ", request.description)),  // Include description in the field
            abi.encode(oldIpfsHash),
            abi.encode(request.newIpfsHash)
        );

        if (request.hashIndex >= prop.ipfsHash.length) {
            // If the index is out of bounds, we are adding a new IPFS hash
            prop.ipfsHash.push(request.newIpfsHash);
        } else {
            // Update the state with the new hash
            prop.ipfsHash[request.hashIndex] = request.newIpfsHash;
        }

        emit ModificationDone(_propertyId, request.newIpfsHash, request.description); // Emit an event for tracking
        
        // Clean up the completed request

        // For each address in ownersApproval reset the approval status
        for (uint i = 0; i < propertyToOwners[_propertyId].length; i++) {
            address owner = propertyToOwners[_propertyId][i];
            delete request.ownersApproval[owner];
        }

        delete modificationRequestMap[_propertyId];
    }

    /**
     * @notice Cancels a pending modification request.
     * @dev Can be called by the government.
     * @param _propertyId The ID of the property with a pending modification.
     */
    function cancelModification(uint _propertyId) external onlyGovernment {
        require(bytes(modificationRequestMap[_propertyId].newIpfsHash).length != 0, "No modification request to cancel.");
        
        // Clean up the completed request

        // For each address in ownersApproval reset the approval status
        for (uint i = 0; i < propertyToOwners[_propertyId].length; i++) {
            address owner = propertyToOwners[_propertyId][i];
            delete modificationRequestMap[_propertyId].ownersApproval[owner];
        }

        delete modificationRequestMap[_propertyId];
    }

    // /**
    //  * @notice Modifies the IPFS hash of a property.
    //  * @dev Can only be called by authorized entities (government, contract owner, or professionals with access).
    //  * @param _propertyId The ID of the property to modify.
    //  * @param _newIpfsHash The new IPFS hash to set for the property.
    //  */
    // function modifyProperty(uint256 _propertyId, string memory _newIpfsHash, string memory _description) external onlyAuthorized(_propertyId) {
    //     Property storage prop = properties[_propertyId];
    //     require(bytes(prop.geoHash).length != 0, "Property does not exist");

    //     string memory oldIpfsHash = prop.ipfsHash;
        
    //     // Ensure there is an actual change to prevent unnecessary transactions
    //     require(keccak256(abi.encodePacked(oldIpfsHash)) != keccak256(abi.encodePacked(_newIpfsHash)), "New IPFS hash is the same as the old one.");

    //     // Log the change before updating the state.
    //     // We cast the bytes32 hashes to dynamic bytes to fit the logChange function signature.
    //     historyTracker.logChange(
    //         _propertyId,
    //         msg.sender,
    //         string(abi.encodePacked("ipfsHash: ", _description)),  // Include description in the field
    //         abi.encode(oldIpfsHash),
    //         abi.encode(_newIpfsHash)
    //     );

    //     // Update the state with the new hash
    //     prop.ipfsHash = _newIpfsHash;
    // }
}