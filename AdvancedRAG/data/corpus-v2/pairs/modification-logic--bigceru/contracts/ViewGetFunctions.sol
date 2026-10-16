// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;
import "./PropertyStorage.sol";

contract ViewGetFunctions is PropertyStorage {

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

    // Modifier to restrict access to the contract owner or government entities
    modifier onlyOwnerOrGovernment() {
        require(
            isGovernment[msg.sender] || msg.sender == contractOwner,
            "Only the contract owner or government can perform this action"
        );
        _;
    }

    // ##############################
    // # Getters and View Functions #
    // ##############################

    // Function to return percentage of ownership for a specific property and owner
    function getOwnershipPercentage(uint _propertyId, address _owner) external view returns (uint) {
        // Check if the property exists
        require(bytes(properties[_propertyId].geoHash).length != 0, "Property does not exist");
        // Check if the owner is registered for the property
        require(propertyToOwnerToPercentage[_propertyId][_owner] > 0, "Owner is not registered for this property");

        return propertyToOwnerToPercentage[_propertyId][_owner]; // Return the ownership percentage for the owner
    }

    // Function to return the details of a property by its ID (only callable by authorized entities)
    function getProperty(uint _propertyId) external view onlyAuthorized(_propertyId) returns (
            string memory geoHash,
            uint area,
            string memory cadastralClass,
            string[] memory ipfsHash,
            address[] memory owners,
            uint[] memory percentages
        )
    {
        Property storage prop = properties[_propertyId]; // Retrieve the property details

        // Get percentages
        owners = propertyToOwners[_propertyId];     // Get the list of owners for the property
        percentages = new uint[](owners.length);    // Create an array to store the ownership percentages
        for (uint i = 0; i < owners.length; i++) {
            percentages[i] = propertyToOwnerToPercentage[_propertyId][owners[i]]; // Get the ownership percentage for each owner
        }

        return (
            prop.geoHash,
            prop.area,
            prop.cadastralClass,
            prop.ipfsHash,
            propertyToOwners[_propertyId],
            percentages
        ); // Return the property details
    }

    // Function to return the contract owner
    function getContractOwner() external view returns (address) {
        return contractOwner; // Return the contract owner address
    }

    // Function to return the history of a property
    function getHistory(uint _propertyId) external view onlyAuthorized(_propertyId) returns (HistoryTracker.PropertyChange[] memory) {
        return historyTracker.getHistory(_propertyId); // Return the history of the property
    }

    // Function to return the list of properties owned by a specific address
    function getPropertiesByOwner(address _owner) external view onlyOwnerOrGovernment returns (uint[] memory) {
        uint[] memory propertyIds = new uint[](nextPropertyId - 1); // Create an array to store property IDs
        uint count = 0; // Counter for the number of properties

        for (uint i = 1; i < nextPropertyId; i++) {
            if (propertyToOwnerToPercentage[i][_owner] > 0) {
                propertyIds[count] = i; // Add the property ID to the array
                count++; // Increment the counter
            }
        }

        // Resize the array to fit the number of properties found
        uint[] memory result = new uint[](count);
        for (uint j = 0; j < count; j++) {
            result[j] = propertyIds[j]; // Copy the property IDs to the result array
        }
        return result; // Return the list of property IDs
    }

    // Function to return the list of properties owned by a specific address (forced to be msg sender)
    function getMyProperties() internal view returns (uint[] memory) {
        uint[] memory propertyIds = new uint[](nextPropertyId - 1); // Create an array to store property IDs
        uint count = 0; // Counter for the number of properties

        for (uint i = 1; i < nextPropertyId; i++) {
            if (propertyToOwnerToPercentage[i][msg.sender] > 0) {
                propertyIds[count] = i; // Add the property ID to the array
                count++; // Increment the counter
            }
        }

        // Resize the array to fit the number of properties found
        uint[] memory result = new uint[](count);
        for (uint j = 0; j < count; j++) {
            result[j] = propertyIds[j]; // Copy the property IDs to the result array
        }
        return result; // Return the list of property IDs
    }

    function getYourProperties() external view returns (uint[] memory) {
        if (isProfessional[msg.sender]) {
            // Return authorized properties for professionals
            uint[] memory authorizedPropertyIds = new uint[](nextPropertyId - 1);
            uint count = 0; // Counter for the number of authorized properties
            
            for (uint i = 1; i < nextPropertyId; i++) {
                if (authorizedProperties[msg.sender][i]) {
                    authorizedPropertyIds[count] = i; // Add the property ID to the array
                    count++; // Increment the counter
                }
            }

            // Add also the properties owned by the professional
            uint[] memory ownedProperties = getMyProperties();
            for (uint i = 0; i < ownedProperties.length; i++) {
                // Check if the property is already in the authorized list
                bool alreadyAuthorized = false;

                for (uint j = 0; j < count; j++) {
                    if (authorizedPropertyIds[j] == ownedProperties[i]) {
                        alreadyAuthorized = true; // Mark as already authorized
                    }
                }
                if (alreadyAuthorized) continue; // Skip if already authorized

                authorizedPropertyIds[count] = ownedProperties[i]; // Add the owned property ID to the array
                count++; // Increment the counter
            }

            // Resize the array to fit the number of authorized properties found
            uint[] memory result = new uint[](count);
            for (uint j = 0; j < count; j++) {
                result[j] = authorizedPropertyIds[j]; // Copy the property IDs to the result array
            }
            return result; // Return the list of authorized property IDs
        }
        else if (isGovernment[msg.sender] || msg.sender == contractOwner) {
            // Return all properties
            uint[] memory allPropertyIds = new uint[](nextPropertyId - 1);
            for (uint i = 1; i < nextPropertyId; i++) {
                allPropertyIds[i - 1] = i; // Add all property IDs to the array
            }
            return allPropertyIds; // Return
        }

        // If the caller is just a user, return their owned properties
        return getMyProperties(); // Return the properties owned by the caller
    }


    // ###################################################################
    // # Funciton to return if there are pending requests for a property #
    // ###################################################################

    function thereIsModificationRequest(uint _propertyId) external view returns (bool) {
        return bytes(modificationRequestMap[_propertyId].newIpfsHash).length != 0;
    }

    function thereIsTransferRequest(uint _propertyId) external view returns (bool) {
        return ownershipTransferRequests[_propertyId].newOwners.length > 0;
    }
}