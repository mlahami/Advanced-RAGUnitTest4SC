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