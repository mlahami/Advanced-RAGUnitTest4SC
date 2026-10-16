# profile-manager--bigceru

- domain: registries-identity (registry)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Bigceru/Blockchain-LandRegister @ 3d05345ef101524788f66e9de1af0becf28a69e8
- license: MIT
- targets: ProfileManager.sol, HistoryTracker.sol, IRegistration.sol, PropertyRegistry.sol, PropertyStorage.sol, Registration.sol, TransferLogic.sol, ViewGetFunctions.sol
- validation: 9 passing tests, 0 failing; statement coverage ProfileManager.sol 100.0 %, HistoryTracker.sol 25.0 %, IRegistration.sol 100.0 %, PropertyRegistry.sol 100.0 %, PropertyStorage.sol 100.0 %, Registration.sol 100.0 %, TransferLogic.sol 0.0 %, ViewGetFunctions.sol 0.0 %

## Contract: HistoryTracker.sol (dependency)

```solidity
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
```

## Contract: IRegistration.sol (dependency)

```solidity
// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

interface IRegistration {
    function logicalRegisterProperty(
        string memory _geoHash,
        uint _area,
        string memory _cadastralClass,
        address[] memory _owners,
        uint[] memory _percentages,
        string[] memory _ipfsHash
    ) external returns (uint);
}
```

## Contract: ProfileManager.sol (primary target)

```solidity
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
```

## Contract: PropertyRegistry.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PropertyStorage.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./IRegistration.sol";

contract PropertyRegistry is PropertyStorage, ERC721 {
    
    // ###############
    // # Constructor #
    // ###############

    // Constructor to initialize the HistoryTracker contract and ERC721 token
    constructor(address _historyTrackerAddress) ERC721("PropertyNFT", "PNFT") {
        historyTracker = HistoryTracker(_historyTrackerAddress); // Initialize the HistoryTracker contract
        contractOwner = msg.sender; // Set the contract owner to the address that deploys the contract
    }

    // Modifier to restrict access to the contract owner
    modifier onlyOwner() {
        require(
            msg.sender == contractOwner,
            "Only the contract owner can perform this action"
        );
        _;
    }

    function registerProperty(
        string memory _geoHash,
        uint _area,
        string memory _cadastralClass,
        address[] memory _owners,
        uint[] memory _percentages,
        string[] memory _ipfsHash
    ) external returns (uint) {
        // Get the address of the Registration facet from the router
        address facet = facets[IRegistration.logicalRegisterProperty.selector];
        require(facet != address(0), "Registration facet not set");

        // Prepare the function call data
        bytes memory data = abi.encodeWithSelector(
            IRegistration.logicalRegisterProperty.selector,
            _geoHash, _area, _cadastralClass, _owners, _percentages, _ipfsHash
        );
        
        // Perform the delegatecall to the logic facet
        (bool success, bytes memory returnData) = facet.delegatecall(data);

        if (success) {
            uint propertyId = abi.decode(returnData, (uint));
            _mint(address(this), propertyId);
            return propertyId;
        } else {
            // Bubble up the revert reason (needed to propagate errors from the delegatecall)
            assembly {
                revert(add(returnData, 32), mload(returnData))
            }
        }
    }

    function addFacet(bytes4[] calldata _selectors, address _facetAddress) external onlyOwner {
        for (uint i = 0; i < _selectors.length; i++) {
            facets[_selectors[i]] = _facetAddress;
        }
    }

    fallback() external payable {
        // Fallback function to accept Ether
        // This function is called when no other function matches the call

        address facet = facets[msg.sig];
        require(facet != address(0), "Function does not exist in any facet");
        
        assembly {
            // Copy msg.data to memory
            let dataSize := calldatasize()
            calldatacopy(0, 0, dataSize)

            // Delegate call to the facet
            let result := delegatecall(gas(), facet, 0, dataSize, 0, 0)

            // Copy the return data back to the caller
            let returnDataSize := returndatasize()
            returndatacopy(0, 0, returnDataSize)

            // Revert if the delegate call failed
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    receive() external payable {
        // Receive function to accept Ether
    }
}
```

## Contract: PropertyStorage.sol (dependency)

```solidity
// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;
import "./HistoryTracker.sol";

abstract contract PropertyStorage {

    // TODO: move some data to IPFS
    // Struct representing a property
    struct Property {
        string geoHash;             // Geographical coordinates (e.g., "9v6r7zxy")
        uint area;                  // Area in square meters
        string cadastralClass;      // Cadastral class (e.g., "A/2")
        string[] ipfsHash;          // Reference to the property blueprint stored on IPFS
    }

    // Stores the ownership percentage for each owner of a property (Property ID => (Owner address => Percentage))
    mapping(uint => mapping(address => uint)) internal propertyToOwnerToPercentage;
    // Stores the list of addresses for each property's owners to allow iteration (Property ID => Owner addresses[])
    mapping(uint => address[]) internal propertyToOwners;

    // Struct for managing multi-signature ownership transfers
    struct TransferRequest {
        address[] newOwners;
        uint[] percentages;
        bool governmentApproved;
        mapping (address => bool) ownersApproval;   // Mapping to track which owners have approved the transfer
    }

    // Mapping for pending ownership transfers
    mapping(uint => TransferRequest) internal ownershipTransferRequests;

    // Struct for managing multi-signature modification request
    struct ModificationRequest {
        string newIpfsHash;
        string description;
        uint hashIndex;                             // Index of the IPFS hash in the property array
        bool professionalApproved;
        mapping (address => bool) ownersApproval;   // Mapping to track which owners have approved the transfer
    }

    // Mapping for pending modification requests
    mapping(uint => ModificationRequest) internal modificationRequestMap;

    // TODO: if something about the property changes, the hash will change
    mapping(uint => Property) internal properties;       // Mapping from unique property ID to Property struct
    mapping(bytes32 => bool) internal propertyHashes;    // Mapping property hashes (to find duplicates)

    // Role-based access control
    mapping(address => bool) public isGovernment;                               // Government entities can register properties
    mapping(address => bool) public isProfessional;                             // Professionals can read/write property data
    mapping(address => mapping(uint => bool)) internal authorizedProperties;     // Mapping to store for each professional the properties they are authorized to manage

    address public contractOwner;       // Store contract owner
    uint internal nextPropertyId = 1;    // Counter for generating unique property IDs

    // Reference to the HistoryTracker contract
    HistoryTracker internal historyTracker;

    // Maps function selectors to facet addresses
    mapping(bytes4 => address) internal facets;
}
```

## Contract: Registration.sol (dependency)

```solidity
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
```

## Contract: TransferLogic.sol (dependency)

```solidity
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
```

## Contract: ViewGetFunctions.sol (dependency)

```solidity
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
```

## Tests: ProfileManager.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const hre = require("hardhat");

// Helper function to get function selectors from a contract artifact
function getSelectors(contractInterface) {
    const selectors = [];
    contractInterface.forEachFunction((func) => {
        selectors.push(func.selector);
    });
    return selectors;
}

// Helper function to merge ABI arrays and remove any duplicate entries.
function mergeABIs(abis) {
    const combined = abis.flat();
    const uniqueEntries = new Map();

    combined.forEach(item => {
        // Create a unique signature for each ABI entry to handle de-duplication.
        let key;
        if (item.type === 'function') {
            // For functions, the signature must include parameter types to correctly
            // handle function overloading (e.g., myFunction(uint) vs. myFunction(address)).
            const paramTypes = (item.inputs || []).map(i => i.type).join(',');
            key = `function:${item.name}:${paramTypes}`;
        } else {
            // For events and other types, the name is usually sufficient.
            key = `${item.type}:${item.name}`;
        }
        
        // If we haven't seen this signature before, add it to our map.
        if (!uniqueEntries.has(key)) {
            uniqueEntries.set(key, item);
        }
    });

    return Array.from(uniqueEntries.values());
}

describe("PropertyRegistry", function () {
  let propertyRegistryProxy, historyTracker;
  let profileManagerFacet, transferLogicFacet, viewGetFunctionsFacet, registrationFacet;
  let owner, government, government2, professional, professional2, user1, user2, user3;

  beforeEach(async function () {
    // Deploy HistoryTracker
    const HistoryTracker = await hre.ethers.getContractFactory("HistoryTracker");
    historyTracker = await HistoryTracker.deploy();
    await historyTracker.waitForDeployment();
    // console.log("HistoryTracker deployed to:", (await historyTracker.getAddress()).toString());

    // Deploy ProfileStorage
    // const PropertyStorage = await hre.ethers.getContractFactory("PropertyStorage");
    // const propertyStorage = await PropertyStorage.deploy();
    // await propertyStorage.waitForDeployment();
    // console.log("PropertyRegistry deployed to:", (await propertyStorage.getAddress()).toString());

    // Deploy ProfileManager
    const ProfileManager = await hre.ethers.getContractFactory("ProfileManager");
    const profileManager = await ProfileManager.deploy();
    await profileManager.waitForDeployment();
    // console.log("PropertyRegistry deployed to:", (await profileManager.getAddress()).toString());

    // Deploy TransferLogic
    const TransferLogic = await hre.ethers.getContractFactory("TransferLogic");
    const transferLogic = await TransferLogic.deploy();
    await transferLogic.waitForDeployment();
    // console.log("TransferLogic deployed to:", (await transferLogic.getAddress()).toString());

    // Deploy Registration
    const Registration = await hre.ethers.getContractFactory("Registration");
    const registration = await Registration.deploy();
    await registration.waitForDeployment();
    // console.log("TransferLogic deployed to:", (await registration.getAddress()).toString());

    // Deploy ViewGetFunctions
    const ViewGetFunctions = await hre.ethers.getContractFactory("ViewGetFunctions");
    const viewGetFunctions = await ViewGetFunctions.deploy();
    await viewGetFunctions.waitForDeployment();
    // console.log("TransferLogic deployed to:", (await viewGetFunctions.getAddress()).toString());

    // Deploy PropertyRegistry, passing the address of HistoryTracker
    const PropertyRegistry = await hre.ethers.getContractFactory("PropertyRegistry");
    const propertyRegistry = await PropertyRegistry.deploy(historyTracker.target);
    await propertyRegistry.waitForDeployment();
    // console.log("PropertyRegistry deployed to:", (await propertyRegistry.getAddress()).toString());

    // #############################
    // # LINK FACETS TO THE FACADE #
    // #############################

    // Function Selector: A unique, 4-byte ID number for a single function.
    // ABI: The complete user manual for the entire contract, describing all its functions and events in detail.

    // console.log("[2] Linking facets to the PropertyRegistry...");

    // Get the selectors for the facets
    const historyTrackerSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("HistoryTracker").abi));
    const profileManagerSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("ProfileManager").abi));
    const transferLogicSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("TransferLogic").abi));
    const viewGetFunctionsSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("ViewGetFunctions").abi));
    const registrationSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("Registration").abi));

    // Get the accounts
    [owner, government, government2, professional, professional2, user1, user2, user3] = await ethers.getSigners();

    // Link the facets to the PropertyRegistry (facade)
    await propertyRegistry.connect(owner).addFacet(historyTrackerSelectors, historyTracker.target);
    // console.log("HistoryTracker linked successfully.");

    await propertyRegistry.connect(owner).addFacet(profileManagerSelectors, profileManager.target);
    // console.log("ProfileManager linked successfully.");

    await propertyRegistry.connect(owner).addFacet(transferLogicSelectors, transferLogic.target);
    // console.log("TransferLogic linked successfully.");

    await propertyRegistry.connect(owner).addFacet(registrationSelectors, registration.target);
    // console.log("Registration linked successfully.");

    await propertyRegistry.connect(owner).addFacet(viewGetFunctionsSelectors, viewGetFunctions.target);
    // console.log("ViewGetFunctions linked successfully.");

    // console.log("\nLinking complete!");

    // # Authorize facets for history tracking #
    // console.log("Authorizing facets for history tracking...");
    let tx = await historyTracker.connect(owner).addAuthorizedLogger(propertyRegistry.target);
    await tx.wait(); // Wait for the transaction to be mined
    // console.log("TransferLogic authorized for history tracking.");

    // Attach ABIs to the deployed proxy contract address for interaction
    // profileManagerFacet = await ethers.getContractAt("ProfileManager", propertyRegistry.target);
    // transferLogicFacet = await ethers.getContractAt("TransferLogic", propertyRegistry.target);
    // viewGetFunctionsFacet = await ethers.getContractAt("ViewGetFunctions", propertyRegistry.target);
    // registrationFacet = await ethers.getContractAt("Registration", propertyRegistry.target);

    // Get the ABIs from all contracts that make up the diamond
    const propertyRegistryABI = hre.artifacts.readArtifactSync("PropertyRegistry").abi;
    const registrationABI = hre.artifacts.readArtifactSync("Registration").abi;
    const profileManagerABI = hre.artifacts.readArtifactSync("ProfileManager").abi;
    const transferLogicABI = hre.artifacts.readArtifactSync("TransferLogic").abi;
    const viewGetFunctionsABI = hre.artifacts.readArtifactSync("ViewGetFunctions").abi;
    const historyTrackerABI = hre.artifacts.readArtifactSync("HistoryTracker").abi

    // Merge them all into a single, de-duplicated ABI
    const combinedABI = mergeABIs([
        propertyRegistryABI,
        registrationABI,
        profileManagerABI,
        transferLogicABI,
        viewGetFunctionsABI,
        historyTrackerABI
    ]);

    // Create our single, all-knowing contract object!
    // It points to the proxy's address but uses the combined "super ABI".
    propertyRegistryProxy = new ethers.Contract(propertyRegistry.target, combinedABI, owner);
  });

  describe("Roles management", function () {
    it("Owner can add and remove government entities", async function () {
      await propertyRegistryProxy.addGovernmentEntity(government.address);
      expect(await propertyRegistryProxy.isGovernment(government.address)).to.be.true;

      await propertyRegistryProxy.removeGovernmentEntity(government.address);
      expect(await propertyRegistryProxy.isGovernment(government.address)).to.be.false;
    });

    it("Owner can add and remove professionals", async function () {
      await propertyRegistryProxy.addProfessional(professional.address);
      expect(await propertyRegistryProxy.isProfessional(professional.address)).to.be.true;

      await propertyRegistryProxy.removeProfessional(professional.address);
      expect(await propertyRegistryProxy.isProfessional(professional.address)).to.be.false;
    });

    it("Non-owner cannot add or remove government/professional", async function () {
      await expect(
        propertyRegistryProxy.connect(user1).addGovernmentEntity(user2.address)
      ).to.be.revertedWith("Only the contract owner can perform this action");

      await expect(
        propertyRegistryProxy.connect(user1).addProfessional(user2.address)
      ).to.be.revertedWith("Only the contract owner can perform this action");
    });
  });

  describe("Professional authorization", function () {
    let propertyId;
    beforeEach(async function () {
      await propertyRegistryProxy.addGovernmentEntity(government.address);
      const tx = await propertyRegistryProxy.connect(government).registerProperty(
        "9v6r7zxy",
        100,
        "A/2",
        [user1.address],
        [100],
        ["ipfsHash1"]
      );
      await expect(tx).to.emit(propertyRegistryProxy, "PropertyRegistered").withArgs(1, [user1.address]);
      propertyId = 1;
    });

    it("Owner can authorize a professional with payment", async function () {
      const contractOwnerInitialBalance = await ethers.provider.getBalance(owner.address);

      await propertyRegistryProxy.connect(owner).addProfessional(professional.address);
      await expect(
        propertyRegistryProxy.connect(owner).authorizeProfessional(professional.address, propertyId, { value: ethers.parseEther("0.01") })
      ).to.emit(propertyRegistryProxy, "ProfessionalAuthorized").withArgs(professional.address, propertyId);

      // Verify the professional is now authorized
      expect(await propertyRegistryProxy.isAuthorized(professional.address, propertyId)).to.be.true;

      // DO NOT CHECK PAYMENT SINCE THE CONTRACT OWNER PAYED HIMSELF
    });

    it("Professional can pay to get authorization", async function () {
      await propertyRegistryProxy.connect(owner).addProfessional(professional.address);

      // Capture initial balances
      const contractOwnerInitialBalance = await ethers.provider.getBalance(owner.address);
      const professionalInitialBalance = await ethers.provider.getBalance(professional.address);

      // Verify the professional is not authorized
      expect(await propertyRegistryProxy.isAuthorized(professional.address, propertyId)).to.be.false;

      await expect(
        propertyRegistryProxy.connect(professional).authorizeProfessional(professional.address, propertyId, { value: ethers.parseEther("0.01") })
      ).to.emit(propertyRegistryProxy, "ProfessionalAuthorized").withArgs(professional.address, propertyId);

      // Verify the professional is now authorized
      expect(await propertyRegistryProxy.isAuthorized(professional.address, propertyId)).to.be.true;

      // Check balances after payment
      const contractOwnerFinalBalance = await ethers.provider.getBalance(owner.address);
      const professionalFinalBalance = await ethers.provider.getBalance(professional.address);
      expect(contractOwnerFinalBalance).to.equal(contractOwnerInitialBalance + ethers.parseEther("0.01"));
      expect(professionalFinalBalance).to.lessThanOrEqual(professionalInitialBalance - ethers.parseEther("0.01"));  // It can be less due to gas fees
    });

    it("Fails if payment is too low", async function () {
      await propertyRegistryProxy.connect(owner).addProfessional(professional.address);
      await expect(
        propertyRegistryProxy.connect(owner).authorizeProfessional(professional.address, propertyId, { value: ethers.parseEther("0.001") })
      ).to.be.revertedWith("You must pay 0.01 ether to authorize a professional");
    });

    it("Fails if property does not exist", async function () {
      await propertyRegistryProxy.connect(owner).addProfessional(professional.address);
      await expect(
        propertyRegistryProxy.connect(owner).authorizeProfessional(professional.address, 999, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Property does not exist");
    });

    it("Fails if the professional is already authorized", async function () {
      await propertyRegistryProxy.connect(owner).addProfessional(professional.address);
      await propertyRegistryProxy.connect(owner).authorizeProfessional(professional.address, propertyId, { value: ethers.parseEther("0.01") });
      await expect(
        propertyRegistryProxy.connect(owner).authorizeProfessional(professional.address, propertyId, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Professional already authorized for this property");
    });

    it("Fails if the professional is not registered", async function () {
      await expect(
        propertyRegistryProxy.connect(owner).authorizeProfessional(user2.address, propertyId, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Only authorized entities can perform this action");
    });
  });

});
```
