// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/**
 * @title AgentIdentityRegistry
 * @notice ERC-8004 compliant Identity Registry for AI Agents
 * @dev ERC-721 based agent identity with IPFS metadata (ERC-8004 registration file)
 */
contract AgentIdentityRegistry is ERC721URIStorage {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    uint256 private _nextTokenId;

    // agentId => metadataKey => metadataValue
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    // agentId => agentWallet (x402 payment receiver)
    mapping(uint256 => address) private _agentWallets;

    // Track all minted token IDs for enumeration
    uint256[] private _allTokenIds;

    // ============================================================================
    // Events (ERC-8004)
    // ============================================================================

    event Registered(
        uint256 indexed agentId,
        string agentURI,
        address indexed owner
    );

    event URIUpdated(
        uint256 indexed agentId,
        string newURI,
        address indexed updatedBy
    );

    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );

    event AgentWalletSet(
        uint256 indexed agentId,
        address wallet
    );

    event AgentWalletUnset(
        uint256 indexed agentId
    );

    event Burned(
        uint256 indexed agentId,
        address indexed owner
    );

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor() ERC721("UniAgent Registry", "UNIAGENT") {
        _nextTokenId = 1;
    }

    // ============================================================================
    // Registration (ERC-8004)
    // ============================================================================

    /**
     * @notice Register a new agent with URI and metadata
     * @param agentURI IPFS URI pointing to ERC-8004 registration file
     * @param metadata Array of key-value metadata entries
     * @return agentId The token ID assigned to the agent
     */
    function register(
        string calldata agentURI,
        MetadataEntry[] calldata metadata
    ) external returns (uint256 agentId) {
        agentId = _nextTokenId++;
        _safeMint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);

        for (uint256 i = 0; i < metadata.length; i++) {
            require(
                keccak256(bytes(metadata[i].metadataKey)) != keccak256(bytes("agentWallet")),
                "AgentIdentityRegistry: use setAgentWallet"
            );
            _metadata[agentId][metadata[i].metadataKey] = metadata[i].metadataValue;
            emit MetadataSet(agentId, metadata[i].metadataKey, metadata[i].metadataKey, metadata[i].metadataValue);
        }

        _allTokenIds.push(agentId);

        emit Registered(agentId, agentURI, msg.sender);
    }

    /**
     * @notice Register a new agent with URI only (no metadata)
     * @param agentURI IPFS URI pointing to ERC-8004 registration file
     * @return agentId The token ID assigned to the agent
     */
    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = _nextTokenId++;
        _safeMint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);

        _allTokenIds.push(agentId);

        emit Registered(agentId, agentURI, msg.sender);
    }

    // ============================================================================
    // URI Management (ERC-8004)
    // ============================================================================

    /**
     * @notice Update the agent's metadata URI (owner only)
     * @param agentId The agent token ID
     * @param newURI New IPFS URI
     */
    function setAgentURI(uint256 agentId, string calldata newURI) external {
        require(ownerOf(agentId) == msg.sender, "AgentIdentityRegistry: not owner");
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    // ============================================================================
    // Metadata Management (ERC-8004)
    // ============================================================================

    /**
     * @notice Get on-chain metadata for an agent
     * @param agentId The agent token ID
     * @param metadataKey The metadata key
     * @return The metadata value as bytes
     */
    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory) {
        require(_ownerOf(agentId) != address(0), "AgentIdentityRegistry: agent does not exist");
        return _metadata[agentId][metadataKey];
    }

    /**
     * @notice Set on-chain metadata for an agent (owner only)
     * @param agentId The agent token ID
     * @param metadataKey The metadata key
     * @param metadataValue The metadata value as bytes
     */
    function setMetadata(
        uint256 agentId,
        string memory metadataKey,
        bytes memory metadataValue
    ) external {
        require(ownerOf(agentId) == msg.sender, "AgentIdentityRegistry: not owner");
        require(
            keccak256(bytes(metadataKey)) != keccak256(bytes("agentWallet")),
            "AgentIdentityRegistry: use setAgentWallet"
        );
        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    // ============================================================================
    // Agent Wallet (ERC-8004)
    // ============================================================================

    /**
     * @notice Set the agent's wallet address (owner only, simplified without EIP-712)
     * @param agentId The agent token ID
     * @param newWallet The wallet address to set
     */
    function setAgentWallet(uint256 agentId, address newWallet) external {
        require(ownerOf(agentId) == msg.sender, "AgentIdentityRegistry: not owner");
        require(newWallet != address(0), "AgentIdentityRegistry: invalid wallet");
        _agentWallets[agentId] = newWallet;
        emit AgentWalletSet(agentId, newWallet);
    }

    /**
     * @notice Get the agent's wallet address
     * @param agentId The agent token ID
     * @return The agent's wallet address
     */
    function getAgentWallet(uint256 agentId) external view returns (address) {
        require(_ownerOf(agentId) != address(0), "AgentIdentityRegistry: agent does not exist");
        return _agentWallets[agentId];
    }

    /**
     * @notice Remove the agent's wallet address (owner only)
     * @param agentId The agent token ID
     */
    function unsetAgentWallet(uint256 agentId) external {
        require(ownerOf(agentId) == msg.sender, "AgentIdentityRegistry: not owner");
        delete _agentWallets[agentId];
        emit AgentWalletUnset(agentId);
    }

    /**
     * @notice Burn an agent token, removing it from the registry (owner only)
     * @param agentId The agent token ID to burn
     */
    function burn(uint256 agentId) external {
        require(ownerOf(agentId) == msg.sender, "AgentIdentityRegistry: not owner");

        // Remove from _allTokenIds via swap-and-pop (linear scan; acceptable for registry scale)
        uint256 len = _allTokenIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (_allTokenIds[i] == agentId) {
                _allTokenIds[i] = _allTokenIds[len - 1];
                _allTokenIds.pop();
                break;
            }
        }

        // Clean up auxiliary mappings
        delete _agentWallets[agentId];

        address burner = msg.sender;
        _burn(agentId); // ERC721URIStorage._burn also clears tokenURI
        emit Burned(agentId, burner);
    }

    // ============================================================================
    // Enumeration
    // ============================================================================

    /**
     * @notice Get the total number of registered agents
     * @return Total count of registered agents
     */
    function totalSupply() external view returns (uint256) {
        return _allTokenIds.length;
    }

    /**
     * @notice Get all registered agent IDs
     * @return Array of all agent token IDs
     */
    function getAllAgentIds() external view returns (uint256[] memory) {
        return _allTokenIds;
    }

    /**
     * @notice Get agent ID at a specific index
     * @param index The index in the token list
     * @return The agent token ID at the given index
     */
    function agentIdAtIndex(uint256 index) external view returns (uint256) {
        require(index < _allTokenIds.length, "AgentIdentityRegistry: index out of bounds");
        return _allTokenIds[index];
    }
}
