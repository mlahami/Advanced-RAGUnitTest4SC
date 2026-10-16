// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IFlareDataConnector.sol";

/**
 * @title FlareDataConnector
 * @notice Mock implementation of Flare Data Connector for development and testing
 * @dev In production, this would integrate with actual Flare FDC infrastructure
 */
contract FlareDataConnector is IFlareDataConnector {
    // Mapping from request ID to weather data
    mapping(bytes32 => WeatherData) private weatherDataStorage;
    
    // Mapping from location hash to latest data request ID
    mapping(bytes32 => bytes32) private latestRequestByLocation;
    
    // Request counter for generating unique IDs
    uint256 private requestCounter;
    
    // Authorized data providers (oracles)
    mapping(address => bool) public authorizedProviders;
    
    // Owner for admin functions
    address public owner;
    
    // Events
    event ProviderAuthorized(address indexed provider);
    event ProviderRevoked(address indexed provider);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "FDC: caller is not owner");
        _;
    }

    modifier onlyAuthorizedProvider() {
        require(authorizedProviders[msg.sender] || msg.sender == owner, "FDC: not authorized provider");
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedProviders[msg.sender] = true;
    }

    /**
     * @notice Request weather data for a specific location
     * @param locationHash Hash of the location coordinates
     * @param timestamp Unix timestamp for the data request
     * @return requestId Unique identifier for the request
     */
    function requestWeatherData(bytes32 locationHash, uint256 timestamp) external override returns (bytes32 requestId) {
        requestCounter++;
        requestId = keccak256(abi.encodePacked(locationHash, timestamp, requestCounter, block.timestamp));
        
        // Initialize empty weather data for the request
        weatherDataStorage[requestId] = WeatherData({
            timestamp: timestamp,
            temperature: 0,
            rainfall: 0,
            humidity: 0,
            windSpeed: 0,
            locationHash: locationHash,
            isVerified: false
        });
        
        emit WeatherDataRequested(requestId, locationHash, timestamp);
        return requestId;
    }

    /**
     * @notice Fulfill weather data request (called by authorized oracle/provider)
     * @param requestId The request identifier to fulfill
     * @param temperature Temperature value (Celsius * 100)
     * @param rainfall Rainfall amount (mm * 100)
     * @param humidity Humidity percentage (* 100)
     * @param windSpeed Wind speed (km/h * 100)
     */
    function fulfillWeatherData(
        bytes32 requestId,
        int256 temperature,
        uint256 rainfall,
        uint256 humidity,
        uint256 windSpeed
    ) external onlyAuthorizedProvider {
        WeatherData storage data = weatherDataStorage[requestId];
        require(data.locationHash != bytes32(0), "FDC: request does not exist");
        require(!data.isVerified, "FDC: already fulfilled");
        
        data.temperature = temperature;
        data.rainfall = rainfall;
        data.humidity = humidity;
        data.windSpeed = windSpeed;
        data.isVerified = true;
        
        // Update latest data for location
        latestRequestByLocation[data.locationHash] = requestId;
        
        emit WeatherDataFulfilled(requestId, data.locationHash, true);
    }

    /**
     * @notice Get weather data for a request ID
     * @param requestId The request identifier
     * @return data The weather data structure
     */
    function getWeatherData(bytes32 requestId) external view override returns (WeatherData memory data) {
        return weatherDataStorage[requestId];
    }

    /**
     * @notice Check if weather data is available and verified
     * @param requestId The request identifier
     * @return available Whether data exists
     * @return verified Whether data has been verified
     */
    function isDataAvailable(bytes32 requestId) external view override returns (bool available, bool verified) {
        WeatherData storage data = weatherDataStorage[requestId];
        available = data.locationHash != bytes32(0);
        verified = data.isVerified;
    }

    /**
     * @notice Get the latest weather data for a location
     * @param locationHash Hash of the location
     * @return data The latest weather data
     */
    function getLatestWeatherData(bytes32 locationHash) external view override returns (WeatherData memory data) {
        bytes32 latestRequestId = latestRequestByLocation[locationHash];
        require(latestRequestId != bytes32(0), "FDC: no data for location");
        return weatherDataStorage[latestRequestId];
    }

    /**
     * @notice Authorize a new data provider
     * @param provider Address of the provider to authorize
     */
    function authorizeProvider(address provider) external onlyOwner {
        require(provider != address(0), "FDC: invalid provider address");
        authorizedProviders[provider] = true;
        emit ProviderAuthorized(provider);
    }

    /**
     * @notice Revoke a data provider's authorization
     * @param provider Address of the provider to revoke
     */
    function revokeProvider(address provider) external onlyOwner {
        authorizedProviders[provider] = false;
        emit ProviderRevoked(provider);
    }

    /**
     * @notice Transfer ownership
     * @param newOwner Address of the new owner
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "FDC: invalid new owner");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /**
     * @notice Helper function to create location hash from coordinates
     * @param latitude Latitude * 1000000 (for precision)
     * @param longitude Longitude * 1000000 (for precision)
     * @return Hash of the location
     */
    function createLocationHash(int256 latitude, int256 longitude) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(latitude, longitude));
    }
}
