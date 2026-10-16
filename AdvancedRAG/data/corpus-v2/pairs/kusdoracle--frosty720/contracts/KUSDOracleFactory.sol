// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./KUSDOracle.sol";

/**
 * @title KUSDOracleFactory
 * @dev Factory contract for deploying and managing KUSD oracles
 */
contract KUSDOracleFactory {
    // --- Auth ---
    mapping(address => uint256) public wards;
    function rely(address usr) external auth { wards[usr] = 1; emit Rely(usr); }
    function deny(address usr) external auth { wards[usr] = 0; emit Deny(usr); }
    modifier auth {
        require(wards[msg.sender] == 1, "KUSDOracleFactory/not-authorized");
        _;
    }

    // --- Data ---
    mapping(bytes32 => address) public oracles;     // asset => oracle address
    mapping(address => bytes32) public oracleAssets; // oracle => asset
    bytes32[] public assetList;                      // List of all assets
    
    // Events
    event OracleDeployed(bytes32 indexed asset, address indexed oracle);
    event OracleUpdated(bytes32 indexed asset, address indexed oldOracle, address indexed newOracle);
    event Rely(address indexed usr);
    event Deny(address indexed usr);

    constructor() {
        wards[msg.sender] = 1;
        emit Rely(msg.sender);
    }

    /**
     * @dev Deploy a new oracle for an asset
     */
    function deployOracle(bytes32 asset) external auth returns (address) {
        require(asset != bytes32(0), "KUSDOracleFactory/invalid-asset");
        require(oracles[asset] == address(0), "KUSDOracleFactory/oracle-exists");
        
        // Deploy new oracle
        KUSDOracle oracle = new KUSDOracle(asset);
        
        // Store mapping
        oracles[asset] = address(oracle);
        oracleAssets[address(oracle)] = asset;
        assetList.push(asset);
        
        // Grant factory auth to oracle for initial setup
        oracle.rely(address(this));
        oracle.rely(msg.sender);
        
        emit OracleDeployed(asset, address(oracle));
        return address(oracle);
    }

    /**
     * @dev Update oracle address for an asset
     */
    function updateOracle(bytes32 asset, address newOracle) external auth {
        require(asset != bytes32(0), "KUSDOracleFactory/invalid-asset");
        require(newOracle != address(0), "KUSDOracleFactory/invalid-oracle");
        
        address oldOracle = oracles[asset];
        require(oldOracle != address(0), "KUSDOracleFactory/oracle-not-exists");
        
        // Update mappings
        oracles[asset] = newOracle;
        oracleAssets[oldOracle] = bytes32(0);
        oracleAssets[newOracle] = asset;
        
        emit OracleUpdated(asset, oldOracle, newOracle);
    }

    /**
     * @dev Get oracle address for an asset
     */
    function getOracle(bytes32 asset) external view returns (address) {
        return oracles[asset];
    }

    /**
     * @dev Get asset for an oracle
     */
    function getAsset(address oracle) external view returns (bytes32) {
        return oracleAssets[oracle];
    }

    /**
     * @dev Get all assets
     */
    function getAllAssets() external view returns (bytes32[] memory) {
        return assetList;
    }

    /**
     * @dev Get oracle count
     */
    function getOracleCount() external view returns (uint256) {
        return assetList.length;
    }

    /**
     * @dev Batch register oracle nodes across multiple oracles
     */
    function batchRegisterNode(
        bytes32[] calldata assets,
        address nodeAddress,
        uint256 stake
    ) external auth {
        require(nodeAddress != address(0), "KUSDOracleFactory/invalid-node");
        
        for (uint256 i = 0; i < assets.length; i++) {
            address oracle = oracles[assets[i]];
            require(oracle != address(0), "KUSDOracleFactory/oracle-not-exists");
            
            KUSDOracle(oracle).registerNode(nodeAddress, stake);
        }
    }

    /**
     * @dev Batch deactivate oracle nodes across multiple oracles
     */
    function batchDeactivateNode(
        bytes32[] calldata assets,
        address nodeAddress,
        string calldata reason
    ) external auth {
        require(nodeAddress != address(0), "KUSDOracleFactory/invalid-node");
        
        for (uint256 i = 0; i < assets.length; i++) {
            address oracle = oracles[assets[i]];
            require(oracle != address(0), "KUSDOracleFactory/oracle-not-exists");
            
            KUSDOracle(oracle).deactivateNode(nodeAddress, reason);
        }
    }

    /**
     * @dev Emergency invalidate prices across all oracles
     */
    function emergencyInvalidateAll() external auth {
        for (uint256 i = 0; i < assetList.length; i++) {
            address oracle = oracles[assetList[i]];
            if (oracle != address(0)) {
                KUSDOracle(oracle).invalidatePrice();
            }
        }
    }

    /**
     * @dev Get price data for all assets
     */
    function getAllPrices() external view returns (
        bytes32[] memory assets,
        uint256[] memory prices,
        uint256[] memory timestamps,
        bool[] memory validities
    ) {
        uint256 length = assetList.length;
        assets = new bytes32[](length);
        prices = new uint256[](length);
        timestamps = new uint256[](length);
        validities = new bool[](length);
        
        for (uint256 i = 0; i < length; i++) {
            assets[i] = assetList[i];
            address oracle = oracles[assetList[i]];
            
            if (oracle != address(0)) {
                (prices[i], timestamps[i], validities[i]) = KUSDOracle(oracle).getPriceData();
            }
        }
    }
}
