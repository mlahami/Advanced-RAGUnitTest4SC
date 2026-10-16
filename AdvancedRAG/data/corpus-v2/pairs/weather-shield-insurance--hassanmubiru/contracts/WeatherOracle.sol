// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./FlareDataConnector.sol";
import "./IFlareDataConnector.sol";

/**
 * @title WeatherOracle
 * @notice Oracle contract that fetches and validates weather data for the insurance system
 * @dev Acts as a bridge between external weather APIs and on-chain data through FDC
 */
contract WeatherOracle {
    // Flare Data Connector
    FlareDataConnector public flareDataConnector;

    // Owner
    address public owner;

    // Trusted weather data sources
    mapping(bytes32 => bool) public trustedSources;
    
    // Historical weather data for locations
    mapping(bytes32 => WeatherHistory[]) public locationHistory;
    
    // Weather averages for risk assessment
    mapping(bytes32 => WeatherAverages) public locationAverages;

    struct WeatherHistory {
        uint256 timestamp;
        int256 temperature;
        uint256 rainfall;
        uint256 humidity;
        uint256 windSpeed;
        bytes32 sourceHash;
    }

    struct WeatherAverages {
        int256 avgTemperature;
        uint256 avgRainfall;
        uint256 avgHumidity;
        uint256 avgWindSpeed;
        uint256 dataPoints;
        uint256 lastUpdated;
    }

    // Events
    event WeatherDataRecorded(bytes32 indexed locationHash, uint256 timestamp);
    event AveragesUpdated(bytes32 indexed locationHash, uint256 dataPoints);
    event SourceTrusted(bytes32 indexed sourceHash);
    event SourceRevoked(bytes32 indexed sourceHash);

    modifier onlyOwner() {
        require(msg.sender == owner, "WO: not owner");
        _;
    }

    constructor(address _flareDataConnector) {
        require(_flareDataConnector != address(0), "WO: invalid FDC address");
        flareDataConnector = FlareDataConnector(_flareDataConnector);
        owner = msg.sender;
    }

    /**
     * @notice Record weather data for a location
     * @param locationHash Hash of the location
     * @param temperature Temperature in Celsius * 100
     * @param rainfall Rainfall in mm * 100
     * @param humidity Humidity percentage * 100
     * @param windSpeed Wind speed in km/h * 100
     * @param sourceHash Hash of the data source
     */
    function recordWeatherData(
        bytes32 locationHash,
        int256 temperature,
        uint256 rainfall,
        uint256 humidity,
        uint256 windSpeed,
        bytes32 sourceHash
    ) external onlyOwner {
        require(locationHash != bytes32(0), "WO: invalid location");
        
        // Record historical data
        locationHistory[locationHash].push(WeatherHistory({
            timestamp: block.timestamp,
            temperature: temperature,
            rainfall: rainfall,
            humidity: humidity,
            windSpeed: windSpeed,
            sourceHash: sourceHash
        }));

        // Update averages
        _updateAverages(locationHash, temperature, rainfall, humidity, windSpeed);

        emit WeatherDataRecorded(locationHash, block.timestamp);
    }

    /**
     * @notice Update running averages for a location
     */
    function _updateAverages(
        bytes32 locationHash,
        int256 temperature,
        uint256 rainfall,
        uint256 humidity,
        uint256 windSpeed
    ) internal {
        WeatherAverages storage averages = locationAverages[locationHash];
        uint256 n = averages.dataPoints;

        if (n == 0) {
            averages.avgTemperature = temperature;
            averages.avgRainfall = rainfall;
            averages.avgHumidity = humidity;
            averages.avgWindSpeed = windSpeed;
        } else {
            // Calculate new running average
            averages.avgTemperature = (averages.avgTemperature * int256(n) + temperature) / int256(n + 1);
            averages.avgRainfall = (averages.avgRainfall * n + rainfall) / (n + 1);
            averages.avgHumidity = (averages.avgHumidity * n + humidity) / (n + 1);
            averages.avgWindSpeed = (averages.avgWindSpeed * n + windSpeed) / (n + 1);
        }

        averages.dataPoints = n + 1;
        averages.lastUpdated = block.timestamp;

        emit AveragesUpdated(locationHash, n + 1);
    }

    /**
     * @notice Submit weather data to FDC for verification
     * @param requestId The FDC request ID to fulfill
     * @param temperature Temperature value
     * @param rainfall Rainfall amount
     * @param humidity Humidity percentage
     * @param windSpeed Wind speed
     */
    function submitToFDC(
        bytes32 requestId,
        int256 temperature,
        uint256 rainfall,
        uint256 humidity,
        uint256 windSpeed
    ) external onlyOwner {
        flareDataConnector.fulfillWeatherData(
            requestId,
            temperature,
            rainfall,
            humidity,
            windSpeed
        );
    }

    /**
     * @notice Batch submit weather data to FDC
     */
    function batchSubmitToFDC(
        bytes32[] calldata requestIds,
        int256[] calldata temperatures,
        uint256[] calldata rainfalls,
        uint256[] calldata humidities,
        uint256[] calldata windSpeeds
    ) external onlyOwner {
        require(
            requestIds.length == temperatures.length &&
            requestIds.length == rainfalls.length &&
            requestIds.length == humidities.length &&
            requestIds.length == windSpeeds.length,
            "WO: array length mismatch"
        );

        for (uint256 i = 0; i < requestIds.length; i++) {
            flareDataConnector.fulfillWeatherData(
                requestIds[i],
                temperatures[i],
                rainfalls[i],
                humidities[i],
                windSpeeds[i]
            );
        }
    }

    /**
     * @notice Get weather history for a location
     * @param locationHash Hash of the location
     * @param startIndex Start index in history array
     * @param count Number of records to return
     */
    function getWeatherHistory(
        bytes32 locationHash,
        uint256 startIndex,
        uint256 count
    ) external view returns (WeatherHistory[] memory) {
        WeatherHistory[] storage history = locationHistory[locationHash];
        
        if (startIndex >= history.length) {
            return new WeatherHistory[](0);
        }
        
        uint256 endIndex = startIndex + count;
        if (endIndex > history.length) {
            endIndex = history.length;
        }
        
        uint256 resultCount = endIndex - startIndex;
        WeatherHistory[] memory result = new WeatherHistory[](resultCount);
        
        for (uint256 i = 0; i < resultCount; i++) {
            result[i] = history[startIndex + i];
        }
        
        return result;
    }

    /**
     * @notice Get weather history count for a location
     */
    function getWeatherHistoryCount(bytes32 locationHash) external view returns (uint256) {
        return locationHistory[locationHash].length;
    }

    /**
     * @notice Get latest weather data for a location
     */
    function getLatestWeather(bytes32 locationHash) external view returns (WeatherHistory memory) {
        WeatherHistory[] storage history = locationHistory[locationHash];
        require(history.length > 0, "WO: no data for location");
        return history[history.length - 1];
    }

    /**
     * @notice Get weather averages for a location
     */
    function getWeatherAverages(bytes32 locationHash) external view returns (WeatherAverages memory) {
        return locationAverages[locationHash];
    }

    /**
     * @notice Calculate risk score for a location based on historical data
     * @param locationHash Hash of the location
     * @param triggerType Type of weather trigger
     * @param threshold Trigger threshold
     * @return riskScore Risk score from 0-100
     */
    function calculateRiskScore(
        bytes32 locationHash,
        uint8 triggerType,
        int256 threshold
    ) external view returns (uint256 riskScore) {
        WeatherHistory[] storage history = locationHistory[locationHash];
        
        if (history.length == 0) {
            return 50; // Default medium risk for unknown locations
        }

        uint256 triggerCount = 0;
        uint256 sampleSize = history.length > 100 ? 100 : history.length;
        uint256 startIndex = history.length - sampleSize;

        for (uint256 i = startIndex; i < history.length; i++) {
            bool triggered = _checkTrigger(history[i], triggerType, threshold);
            if (triggered) {
                triggerCount++;
            }
        }

        // Risk score as percentage of times condition was triggered
        riskScore = (triggerCount * 100) / sampleSize;
        return riskScore;
    }

    /**
     * @notice Check if weather data triggers a condition
     */
    function _checkTrigger(
        WeatherHistory memory data,
        uint8 triggerType,
        int256 threshold
    ) internal pure returns (bool) {
        if (triggerType == 0) { // RainfallBelow
            return int256(data.rainfall) < threshold;
        } else if (triggerType == 1) { // RainfallAbove
            return int256(data.rainfall) > threshold;
        } else if (triggerType == 2) { // TemperatureBelow
            return data.temperature < threshold;
        } else if (triggerType == 3) { // TemperatureAbove
            return data.temperature > threshold;
        } else if (triggerType == 4) { // WindSpeedAbove
            return int256(data.windSpeed) > threshold;
        }
        return false;
    }

    /**
     * @notice Add trusted data source
     */
    function addTrustedSource(bytes32 sourceHash) external onlyOwner {
        trustedSources[sourceHash] = true;
        emit SourceTrusted(sourceHash);
    }

    /**
     * @notice Remove trusted data source
     */
    function removeTrustedSource(bytes32 sourceHash) external onlyOwner {
        trustedSources[sourceHash] = false;
        emit SourceRevoked(sourceHash);
    }

    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "WO: invalid owner");
        owner = newOwner;
    }

    /**
     * @notice Update FDC address
     */
    function setFlareDataConnector(address _fdc) external onlyOwner {
        require(_fdc != address(0), "WO: invalid FDC address");
        flareDataConnector = FlareDataConnector(_fdc);
    }
}
