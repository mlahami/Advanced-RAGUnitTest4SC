// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IFlareDataConnector
 * @notice Interface for Flare Data Connector (FDC) integration
 * @dev This interface allows fetching verified weather data from Flare's decentralized oracle system
 */
interface IFlareDataConnector {
    /**
     * @notice Weather data structure from FDC
     */
    struct WeatherData {
        uint256 timestamp;
        int256 temperature;      // Temperature in Celsius * 100 (for precision)
        uint256 rainfall;        // Rainfall in mm * 100
        uint256 humidity;        // Humidity percentage * 100
        uint256 windSpeed;       // Wind speed in km/h * 100
        bytes32 locationHash;    // Hash of location coordinates
        bool isVerified;         // Whether data has been verified by FDC
    }

    /**
     * @notice Request weather data for a specific location
     * @param locationHash Hash of the location (lat, lon encoded)
     * @param timestamp Unix timestamp for the data request
     * @return requestId Unique identifier for the data request
     */
    function requestWeatherData(bytes32 locationHash, uint256 timestamp) external returns (bytes32 requestId);

    /**
     * @notice Get weather data for a request ID
     * @param requestId The request identifier
     * @return data The weather data structure
     */
    function getWeatherData(bytes32 requestId) external view returns (WeatherData memory data);

    /**
     * @notice Check if weather data is available and verified
     * @param requestId The request identifier
     * @return available Whether data is available
     * @return verified Whether data has been verified
     */
    function isDataAvailable(bytes32 requestId) external view returns (bool available, bool verified);

    /**
     * @notice Get the latest weather data for a location
     * @param locationHash Hash of the location
     * @return data The latest weather data
     */
    function getLatestWeatherData(bytes32 locationHash) external view returns (WeatherData memory data);

    /**
     * @notice Event emitted when weather data is requested
     */
    event WeatherDataRequested(bytes32 indexed requestId, bytes32 indexed locationHash, uint256 timestamp);

    /**
     * @notice Event emitted when weather data is fulfilled
     */
    event WeatherDataFulfilled(bytes32 indexed requestId, bytes32 indexed locationHash, bool verified);
}
