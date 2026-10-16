// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title OMA3AppMetadata
/// @notice A contract for managing decentralized application metadata using DIDs with registry integration
/// @dev This contract stores metadata as JSON, with access control for authorized registry
contract OMA3AppMetadata is Ownable {
    /// @notice Mapping of DIDs to their metadata JSON
    mapping(string => string) public metadataJsonByDID;

    /// @notice Address of the authorized registry contract
    address public authorizedRegistry;

    /// @notice Emitted when metadata is set
    event MetadataSet(
        string indexed did,
        uint8 major,
        uint8 minor,
        uint8 patch,
        string metadataJson,
        bytes32 metadataHash,
        uint256 timestamp
    );

    /// @notice Emitted when registry is authorized
    event RegistryAuthorized(address indexed registryAddress);

    // Constants for validation
    uint256 private constant MAX_DID_LENGTH = 128;
    uint256 private constant MAX_JSON_LENGTH = 10000; // 10 KB max
    string private constant ERROR_PREFIX = "AppMetadata Contract Error: ";

    /// @notice Modifier to restrict access to authorized registry only
    modifier onlyAuthorizedRegistry() {
        require(msg.sender == authorizedRegistry, string.concat(ERROR_PREFIX, "Only authorized registry"));
        _;
    }

    /// @notice Constructor - sets the deployer as owner
    constructor() Ownable(msg.sender) {}

    /// @notice Sets or updates the authorized registry address
    /// @param _registryAddress Address of the registry contract
    /// @dev Can be called multiple times by owner to update the registry
    function setAuthorizedRegistry(address _registryAddress) 
        external 
        onlyOwner 
    {
        require(_registryAddress != address(0), string.concat(ERROR_PREFIX, "Invalid registry address"));
        
        authorizedRegistry = _registryAddress;
        
        emit RegistryAuthorized(_registryAddress);
    }

    /// @notice Sets metadata for an app - called by authorized registry only
    /// @param did Unique identifier for the application (base DID, not versioned)
    /// @param major Major version number
    /// @param minor Minor version number
    /// @param patch Patch version number
    /// @param metadataJson JSON string containing the app metadata
    function setMetadataForRegistry(
        string memory did,
        uint8 major,
        uint8 minor,
        uint8 patch,
        string memory metadataJson
    ) external onlyAuthorizedRegistry {
        _validateInputs(did, metadataJson);
        
        // Store metadata by base DID (gas efficient - shared across versions)
        metadataJsonByDID[did] = metadataJson;
        
        // Emit event with full version context for historical tracking
        emit MetadataSet(
            did,
            major,
            minor,
            patch,
            metadataJson,
            keccak256(bytes(metadataJson)),
            block.timestamp
        );
    }



    /// @notice Gets the metadata JSON for a specific DID
    /// @param did Unique identifier for the application
    /// @return The metadata JSON string
    function getMetadataJson(string memory did) external view returns (string memory) {
        return metadataJsonByDID[did];
    }

    /// @notice Internal function to validate DID and metadata inputs
    /// @param did The DID string to validate
    /// @param metadataJson The metadata JSON string to validate
    function _validateInputs(string memory did, string memory metadataJson) internal pure {
        // DID validation
        require(bytes(did).length > 0, string.concat(ERROR_PREFIX, "DID cannot be empty"));
        require(bytes(did).length <= MAX_DID_LENGTH, string.concat(ERROR_PREFIX, "DID too long"));
        require(isLowercase(did), string.concat(ERROR_PREFIX, "DID must be lowercase"));
        
        // JSON validation
        require(bytes(metadataJson).length > 0, string.concat(ERROR_PREFIX, "Metadata JSON cannot be empty"));
        require(bytes(metadataJson).length <= MAX_JSON_LENGTH, string.concat(ERROR_PREFIX, "Metadata JSON too large"));
    }
    
    /// @notice Checks if a string contains only lowercase characters
    /// @param str The string to check
    /// @return True if the string is all lowercase or contains no letters
    function isLowercase(string memory str) internal pure returns (bool) {
        bytes memory strBytes = bytes(str);
        for (uint256 index = 0; index < strBytes.length; index++) {
            if (strBytes[index] >= 0x41 && strBytes[index] <= 0x5A) {
                return false;
            }
        }
        return true;
    }
}
