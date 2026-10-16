// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

import "./PropertyStorage.sol";

// Trick the compiler to allow _mint function to be used in the Registration contract
// This is necessary because we do not inherit from ERC721 directly in the Registration contract
// The real implementation of _mint is in the ERC721 contract, which is inherited by PropertyRegistry
// abstract contract ERC721Mintable {
//     function _mint(address to, uint256 tokenId) internal virtual;
// }

contract Registration is PropertyStorage {
    // Events for tracking changes
    event PropertyRegistered(uint indexed propertyId, address[] owners); // Emitted when a property is registered

    // Modifier to restrict access to the contract owner or government entities
    modifier onlyOwnerOrGovernment() {
        require(
            isGovernment[msg.sender] || msg.sender == contractOwner,
            "Only the contract owner or government can perform this action"
        );
        _;
    }

    // #################################
    // # Property Management Functions #
    // #################################

    // Function to register a new property (only callable by government entities and the contract owner)
    function logicalRegisterProperty(
        string memory _geoHash,
        uint _area,
        string memory _cadastralClass,
        address[] memory _owners,
        uint[] memory _percentages,
        string[] memory _ipfsHash
    ) external onlyOwnerOrGovernment returns (uint) {
        require(_owners.length > 0 && _owners.length == _percentages.length, "Owner and percentage arrays must match and be non-empty.");

        // Check if the property already exists by hashing the Property details
        bytes32 propertyHash = keccak256(abi.encodePacked(_geoHash, _area, _cadastralClass));   // Removed ipfsHash
        require(!propertyHashes[propertyHash], "Property already registered");

        // Ensure that the total ownership percentage equals 100%
        uint totalPercentage = 0;
        for (uint i = 0; i < _percentages.length; i++) {
            totalPercentage += _percentages[i];
        }
        require(totalPercentage == 100, "Total ownership percentage must equal 100.");

        // Generate a new property ID
        require(nextPropertyId < type(uint).max, "Maximum property ID reached"); // Prevent overflow of property ID counter
        uint propertyId = nextPropertyId; // Generate a new property ID
        nextPropertyId++; // Increment the property ID counter

        // Populate the propertyToOwnerToPercentage mapping and propertyToOwners array
        for (uint i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0), "Owner address cannot be zero.");
            require(_percentages[i] > 0, "Ownership percentage must be greater than zero.");
            
            propertyToOwnerToPercentage[propertyId][_owners[i]] = _percentages[i];  // Store the ownership percentage for each owner
            propertyToOwners[propertyId].push(_owners[i]);                          // Add the owner to the list
        }

        // Store the property hash to prevent duplicates
        propertyHashes[propertyHash] = true;
        properties[propertyId] = Property(_geoHash, _area, _cadastralClass, _ipfsHash);     // Store the property details in the mapping

        // The contract itself becomes the owner of the ERC721 token.   
        // _mint(address(this), propertyId); // Mint an NFT for the property
        emit PropertyRegistered(propertyId, _owners); // Emit an event for tracking

        return propertyId; // Return the new property ID
    }
}