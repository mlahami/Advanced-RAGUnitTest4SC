// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract HistoryTracker {
    // Reference to the PropertyRegistry contract
    // PropertyRegistry public registry;
    address public registryAddress;
    mapping(address => bool) public authorizedLoggers;

    // Struct to record property changes
    struct PropertyChange {
        uint timestamp;         // The time when the change occurred
        address changedBy;      // Address of the user who made the change
        string field;           // The field that was changed (e.g., "owner", "area", etc.)
        bytes oldValue;       // The previous value of the field
        bytes newValue;       // The new value of the field
    }

    // Mapping to store the history of changes for each property by its ID
    mapping(uint => PropertyChange[]) public propertyHistory;

    // Constructor to initialize the contract with the address of the PropertyRegistry
    constructor() {
        // registry = PropertyRegistry(_registryAddress);
        registryAddress = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == registryAddress, "Only owner can perform this action");
        _;
    }

    function addAuthorizedLogger(address _logger) external onlyOwner {
        authorizedLoggers[_logger] = true;
    }

    function removeAuthorizedLogger(address _logger) external onlyOwner {
        authorizedLoggers[_logger] = false;
    }

    /**
     * @dev Logs a change to a property. This function can only be called by the PropertyRegistry contract.
     * @param _propertyId The ID of the property being updated
     * @param _changedBy The address of the user who made the change
     * @param _field The field that was changed
     * @param _oldValue The previous value of the field
     * @param _newValue The new value of the field
     */
    function logChange(
        uint _propertyId,
        address _changedBy,
        string memory _field,
        bytes memory _oldValue,
        bytes memory _newValue
    ) external {
        require(authorizedLoggers[msg.sender], "Unauthorized logger");
        propertyHistory[_propertyId].push(PropertyChange(
            block.timestamp,
            _changedBy,
            _field,
            _oldValue,
            _newValue
        ));
    }

    /**
     * @dev Logs a change to a property with a description. This function can only be called by the PropertyRegistry contract.
     * @param _propertyId The ID of the property being updated
     * @param _changedBy The address of the user who made the change
     * @param _field The field that was changed
     * @param _oldValue The previous value of the field
     * @param _newValue The new value of the field
     * @param _description A description of the change
     */
    // function logChangeWithDescription(
    //     uint _propertyId,
    //     address _changedBy,
    //     string memory _field,
    //     bytes memory _oldValue,
    //     bytes memory _newValue,
    //     string memory _description
    // ) external {
    //     require(authorizedLoggers[msg.sender], "Unauthorized logger");
    //     propertyHistory[_propertyId].push(PropertyChange(
    //         block.timestamp,
    //         _changedBy,
    //         string(abi.encodePacked(_field, ": ", _description)),   // Include description in the field
    //         _oldValue,
    //         _newValue
    //     ));
    // }

    /**
     * @dev Retrieves the entire history of changes for a specific property.
     * @param _propertyId The ID of the property
     * @return An array of PropertyChange structs representing the history of the property
     */
    function getHistory(uint _propertyId) external view returns (PropertyChange[] memory) {
        return propertyHistory[_propertyId];
    }
}