// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;
import "./PropertyStorage.sol";

contract ProfileManager is PropertyStorage{

    event ProfessionalAuthorized(address indexed professional, uint indexed propertyId); // Emitted when a professional is authorized

    // #########################################################
    // # Modifier to restrict access to the contract functions #
    // #########################################################

    // Modifier to restrict access to the contract owner
    modifier onlyOwner() {
        require(
            msg.sender == contractOwner,
            "Only the contract owner can perform this action"
        );
        _;
    }

    // UNUSED MODIFIERS ARE COMMENTED TO MAXIMIZE CODE COVERAGE

    // Modifier to restrict access to government entities
    // modifier onlyGovernment() {
    //     require(
    //         isGovernment[msg.sender],
    //         "Only government entities can perform this action"
    //     );
    //     _;
    // }

    // Modifier to restrict access to the contract owner or government entities
    // modifier onlyOwnerOrGovernment() {
    //     require(
    //         isGovernment[msg.sender] || msg.sender == contractOwner,
    //         "Only the contract owner or government can perform this action"
    //     );
    //     _;
    // }

    // Modifier to restrict access to professionals
    // modifier onlyProfessional() {
    //     require(
    //         isProfessional[msg.sender],
    //         "Only professionals can perform this action"
    //     );
    //     _;
    // }

    // Modifier to restrict access to the contract (only callable by: contract owner, government, or professionals)
    modifier onlyRegisteredEntity(address _user) {
        require(
            isGovernment[_user] ||
                _user == contractOwner ||
                isProfessional[_user],
            "Only authorized entities can perform this action"
        );
        _;
    }

    // Modifier to restrict access to the property owner
    // modifier onlyPropertyOwner (uint _propertyId) {
    //     // Check if the caller is the owner of the property
    //     require(
    //         propertyToOwnerToPercentage[_propertyId][msg.sender] > 0,
    //         "Only the property owner can perform this action"
    //     );
    //     _;
    // }

    // ##############################
    // # Professional Authorization #
    // ##############################

    // Function that enables to a professional to access a property after payment
    function authorizeProfessional(
        address _professional,
        uint _propertyId
    ) external payable onlyRegisteredEntity(_professional) {
        // Check if the property exists
        require(bytes(properties[_propertyId].geoHash).length != 0, "Property does not exist");
        
        require(msg.value == 0.01 ether, "You must pay 0.01 ether to authorize a professional"); // Require a payment for authorization

        // Check if the professional already have access to the property
        require(!authorizedProperties[_professional][_propertyId], "Professional already authorized for this property");

        // Transfer the payment to the contract owner
        payable(contractOwner).transfer(msg.value);
        authorizedProperties[_professional][_propertyId] = true; // Authorize the professional for the property
        emit ProfessionalAuthorized(_professional, _propertyId); // Emit an event for tracking
    }

    // Function to return the authorized status of a professional for a property
    function isAuthorized(address _professional, uint _propertyId) external view returns (bool) {
        // Check if the caller is the contract owner, a government entity, or the professional himself
        require(msg.sender == contractOwner || isGovernment[msg.sender] || (isProfessional[msg.sender] && msg.sender == _professional), "Only authorized entities can check authorization status");
        
        return authorizedProperties[_professional][_propertyId]; // Return the authorization status
    }

    // ###########################################################
    // # Functions to add or remove entities with specific roles #
    // ###########################################################

    // Function to add a government entity (only callable by the contract owner)
    function addGovernmentEntity(address _government) external onlyOwner {
        isGovernment[_government] = true; // Add the address to the government mapping
    }

    // Function to remove a government entity (only callable by the contract owner)
    function removeGovernmentEntity(address _government) external onlyOwner {
        isGovernment[_government] = false; // Remove the address from the government mapping
    }

    // Function to add a professional (only callable by the contract owner)
    function addProfessional(address _professional) external onlyOwner {
        isProfessional[_professional] = true; // Add the address to the professional mapping
    }

    // Function to remove a professional (only callable by the contract owner)
    function removeProfessional(address _professional) external onlyOwner {
        isProfessional[_professional] = false; // Remove the address from the professional mapping
    }
}