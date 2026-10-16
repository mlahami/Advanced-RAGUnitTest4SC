# weather-shield-insurance--hassanmubiru

- domain: insurance (insurance)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/hassanmubiru/weathershield-defi @ 0133b3ab0d9140e69503899d187e165109ee0d53
- license: MIT
- targets: WeatherShieldInsurance.sol, FlareDataConnector.sol, PolicyFactory.sol, WeatherOracle.sol, IFlareDataConnector.sol, IWeatherShieldInsurance.sol
- validation: 29 passing tests, 0 failing; statement coverage WeatherShieldInsurance.sol 71.17 %, FlareDataConnector.sol 65.0 %, PolicyFactory.sol 78.79 %, WeatherOracle.sol 1.89 %, IFlareDataConnector.sol 100.0 %, IWeatherShieldInsurance.sol 100.0 %

## Contract: FlareDataConnector.sol (dependency)

```solidity
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
```

## Contract: IFlareDataConnector.sol (dependency)

```solidity
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
```

## Contract: IWeatherShieldInsurance.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IWeatherShieldInsurance
 * @notice Interface for the WeatherShield Insurance contract
 */
interface IWeatherShieldInsurance {
    /**
     * @notice Policy status enum
     */
    enum PolicyStatus {
        Active,
        Expired,
        ClaimPaid,
        Cancelled
    }

    /**
     * @notice Weather trigger type
     */
    enum TriggerType {
        RainfallBelow,      // Drought condition
        RainfallAbove,      // Flood condition
        TemperatureBelow,   // Frost condition
        TemperatureAbove,   // Heat wave condition
        WindSpeedAbove      // Storm condition
    }

    /**
     * @notice Insurance policy structure
     */
    struct Policy {
        uint256 policyId;
        address policyholder;
        bytes32 locationHash;
        TriggerType triggerType;
        int256 triggerThreshold;    // Threshold value * 100 for precision
        uint256 premium;
        uint256 coverageAmount;
        uint256 startTime;
        uint256 endTime;
        PolicyStatus status;
        string cropType;
        uint256 farmSize;           // In hectares * 100
    }

    /**
     * @notice Claim structure
     */
    struct Claim {
        uint256 claimId;
        uint256 policyId;
        uint256 timestamp;
        int256 actualValue;
        uint256 payoutAmount;
        bool processed;
        bytes32 weatherDataRequestId;
    }

    // Events
    event PolicyCreated(uint256 indexed policyId, address indexed policyholder, bytes32 locationHash);
    event PolicyCancelled(uint256 indexed policyId, address indexed policyholder);
    event ClaimInitiated(uint256 indexed claimId, uint256 indexed policyId, address indexed policyholder);
    event ClaimProcessed(uint256 indexed claimId, uint256 indexed policyId, uint256 payoutAmount);
    event PremiumDeposited(uint256 indexed policyId, uint256 amount);
    
    // Core functions
    function createPolicy(
        bytes32 locationHash,
        TriggerType triggerType,
        int256 triggerThreshold,
        uint256 coverageAmount,
        uint256 duration,
        string calldata cropType,
        uint256 farmSize
    ) external payable returns (uint256 policyId);

    function cancelPolicy(uint256 policyId) external;
    function initiateClaim(uint256 policyId) external returns (uint256 claimId);
    function processClaim(uint256 claimId) external;
    function getPolicy(uint256 policyId) external view returns (Policy memory);
    function getClaim(uint256 claimId) external view returns (Claim memory);
    function getPoliciesByHolder(address holder) external view returns (uint256[] memory);
}
```

## Contract: PolicyFactory.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./WeatherShieldInsurance.sol";
import "./IWeatherShieldInsurance.sol";

/**
 * @title PolicyFactory
 * @notice Factory contract for creating and managing multiple insurance policies
 * @dev Allows batch operations and policy template management
 */
contract PolicyFactory is Ownable {
    // Main insurance contract
    WeatherShieldInsurance public insuranceContract;

    // Policy templates for quick policy creation
    struct PolicyTemplate {
        string name;
        IWeatherShieldInsurance.TriggerType triggerType;
        int256 triggerThreshold;
        uint256 coverageMultiplier;  // Multiplier for farm size (in basis points)
        uint256 duration;
        bool isActive;
    }

    // Template storage
    mapping(uint256 => PolicyTemplate) public templates;
    uint256 public templateCount;

    // Events
    event TemplateCreated(uint256 indexed templateId, string name);
    event TemplateUpdated(uint256 indexed templateId);
    event TemplateDeactivated(uint256 indexed templateId);
    event BatchPoliciesCreated(address indexed creator, uint256[] policyIds);

    constructor(address _insuranceContract) Ownable(msg.sender) {
        require(_insuranceContract != address(0), "PF: invalid insurance contract");
        insuranceContract = WeatherShieldInsurance(payable(_insuranceContract));
        
        // Initialize default templates
        _initializeDefaultTemplates();
    }

    /**
     * @notice Initialize default policy templates
     */
    function _initializeDefaultTemplates() internal {
        // Drought Protection Template
        _createTemplate(
            "Drought Protection",
            IWeatherShieldInsurance.TriggerType.RainfallBelow,
            5000,  // 50mm rainfall threshold
            10000, // 100% coverage of base amount
            90 days
        );

        // Flood Protection Template
        _createTemplate(
            "Flood Protection",
            IWeatherShieldInsurance.TriggerType.RainfallAbove,
            20000, // 200mm rainfall threshold
            12000, // 120% coverage of base amount
            90 days
        );

        // Frost Protection Template
        _createTemplate(
            "Frost Protection",
            IWeatherShieldInsurance.TriggerType.TemperatureBelow,
            0,     // 0°C threshold
            8000,  // 80% coverage of base amount
            30 days
        );

        // Heat Wave Protection Template
        _createTemplate(
            "Heat Wave Protection",
            IWeatherShieldInsurance.TriggerType.TemperatureAbove,
            4000,  // 40°C threshold
            10000, // 100% coverage of base amount
            60 days
        );

        // Storm Protection Template
        _createTemplate(
            "Storm Protection",
            IWeatherShieldInsurance.TriggerType.WindSpeedAbove,
            8000,  // 80 km/h wind speed threshold
            15000, // 150% coverage of base amount
            180 days
        );
    }

    /**
     * @notice Create a new policy template
     */
    function _createTemplate(
        string memory name,
        IWeatherShieldInsurance.TriggerType triggerType,
        int256 triggerThreshold,
        uint256 coverageMultiplier,
        uint256 duration
    ) internal returns (uint256 templateId) {
        templateCount++;
        templateId = templateCount;
        
        templates[templateId] = PolicyTemplate({
            name: name,
            triggerType: triggerType,
            triggerThreshold: triggerThreshold,
            coverageMultiplier: coverageMultiplier,
            duration: duration,
            isActive: true
        });

        emit TemplateCreated(templateId, name);
        return templateId;
    }

    /**
     * @notice Create a new policy template (admin only)
     */
    function createTemplate(
        string calldata name,
        IWeatherShieldInsurance.TriggerType triggerType,
        int256 triggerThreshold,
        uint256 coverageMultiplier,
        uint256 duration
    ) external onlyOwner returns (uint256) {
        return _createTemplate(name, triggerType, triggerThreshold, coverageMultiplier, duration);
    }

    /**
     * @notice Update an existing template
     */
    function updateTemplate(
        uint256 templateId,
        int256 triggerThreshold,
        uint256 coverageMultiplier,
        uint256 duration
    ) external onlyOwner {
        require(templateId <= templateCount && templateId > 0, "PF: invalid template");
        
        PolicyTemplate storage template = templates[templateId];
        template.triggerThreshold = triggerThreshold;
        template.coverageMultiplier = coverageMultiplier;
        template.duration = duration;

        emit TemplateUpdated(templateId);
    }

    /**
     * @notice Deactivate a template
     */
    function deactivateTemplate(uint256 templateId) external onlyOwner {
        require(templateId <= templateCount && templateId > 0, "PF: invalid template");
        templates[templateId].isActive = false;
        emit TemplateDeactivated(templateId);
    }

    /**
     * @notice Create a policy using a template
     * @param templateId The template to use
     * @param locationHash Farm location hash
     * @param baseCoverage Base coverage amount
     * @param cropType Type of crop
     * @param farmSize Farm size in hectares * 100
     */
    function createPolicyFromTemplate(
        uint256 templateId,
        bytes32 locationHash,
        uint256 baseCoverage,
        string calldata cropType,
        uint256 farmSize
    ) external payable returns (uint256 policyId) {
        require(templateId <= templateCount && templateId > 0, "PF: invalid template");
        PolicyTemplate storage template = templates[templateId];
        require(template.isActive, "PF: template not active");

        // Calculate coverage based on template multiplier
        uint256 coverageAmount = (baseCoverage * template.coverageMultiplier) / 10000;

        policyId = insuranceContract.createPolicy{value: msg.value}(
            locationHash,
            template.triggerType,
            template.triggerThreshold,
            coverageAmount,
            template.duration,
            cropType,
            farmSize
        );

        return policyId;
    }

    /**
     * @notice Get all active templates
     */
    function getActiveTemplates() external view returns (PolicyTemplate[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 1; i <= templateCount; i++) {
            if (templates[i].isActive) {
                activeCount++;
            }
        }

        PolicyTemplate[] memory activeTemplates = new PolicyTemplate[](activeCount);
        uint256 index = 0;
        for (uint256 i = 1; i <= templateCount; i++) {
            if (templates[i].isActive) {
                activeTemplates[index] = templates[i];
                index++;
            }
        }

        return activeTemplates;
    }

    /**
     * @notice Update insurance contract address
     */
    function setInsuranceContract(address _insuranceContract) external onlyOwner {
        require(_insuranceContract != address(0), "PF: invalid address");
        insuranceContract = WeatherShieldInsurance(payable(_insuranceContract));
    }

    /**
     * @notice Estimate premium for a template-based policy
     */
    function estimatePremium(
        uint256 templateId,
        uint256 baseCoverage
    ) external view returns (uint256) {
        require(templateId <= templateCount && templateId > 0, "PF: invalid template");
        PolicyTemplate storage template = templates[templateId];
        uint256 coverageAmount = (baseCoverage * template.coverageMultiplier) / 10000;
        return insuranceContract.calculatePremium(
            coverageAmount,
            template.duration,
            template.triggerType
        );
    }
}
```

## Contract: WeatherOracle.sol (dependency)

```solidity
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
```

## Contract: WeatherShieldInsurance.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IWeatherShieldInsurance.sol";
import "./IFlareDataConnector.sol";

/**
 * @title WeatherShieldInsurance
 * @notice Decentralized parametric insurance contract for farmers
 * @dev Uses Flare Data Connector (FDC) for verified weather data
 */
contract WeatherShieldInsurance is IWeatherShieldInsurance, ReentrancyGuard, Pausable, Ownable {
    // Flare Data Connector interface
    IFlareDataConnector public flareDataConnector;

    // Policy storage
    mapping(uint256 => Policy) private policies;
    mapping(address => uint256[]) private holderPolicies;
    uint256 private policyCounter;

    // Claim storage
    mapping(uint256 => Claim) private claims;
    mapping(uint256 => uint256[]) private policyClaims;
    uint256 private claimCounter;

    // Premium configuration
    uint256 public basePremiumRate = 500;      // 5% of coverage (in basis points)
    uint256 public minCoverageAmount = 0.01 ether;
    uint256 public maxCoverageAmount = 100 ether;
    uint256 public minPolicyDuration = 7 days;
    uint256 public maxPolicyDuration = 365 days;

    // Treasury
    address public treasury;
    uint256 public treasuryBalance;
    uint256 public totalPremiumsCollected;
    uint256 public totalClaimsPaid;

    // Events
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event FDCUpdated(address indexed oldFDC, address indexed newFDC);
    event PremiumRateUpdated(uint256 oldRate, uint256 newRate);
    event TreasuryFunded(address indexed funder, uint256 amount);
    event TreasuryWithdrawn(address indexed recipient, uint256 amount);

    constructor(address _flareDataConnector, address _treasury) Ownable(msg.sender) {
        require(_flareDataConnector != address(0), "WS: invalid FDC address");
        require(_treasury != address(0), "WS: invalid treasury address");
        
        flareDataConnector = IFlareDataConnector(_flareDataConnector);
        treasury = _treasury;
    }

    /**
     * @notice Create a new insurance policy
     * @param locationHash Hash of the farm location
     * @param triggerType Type of weather trigger
     * @param triggerThreshold Threshold value for triggering claim
     * @param coverageAmount Amount to be paid on claim
     * @param duration Policy duration in seconds
     * @param cropType Type of crop being insured
     * @param farmSize Size of farm in hectares * 100
     * @return policyId The created policy ID
     */
    function createPolicy(
        bytes32 locationHash,
        TriggerType triggerType,
        int256 triggerThreshold,
        uint256 coverageAmount,
        uint256 duration,
        string calldata cropType,
        uint256 farmSize
    ) external payable nonReentrant whenNotPaused returns (uint256 policyId) {
        require(locationHash != bytes32(0), "WS: invalid location");
        require(coverageAmount >= minCoverageAmount, "WS: coverage too low");
        require(coverageAmount <= maxCoverageAmount, "WS: coverage too high");
        require(duration >= minPolicyDuration, "WS: duration too short");
        require(duration <= maxPolicyDuration, "WS: duration too long");
        require(bytes(cropType).length > 0, "WS: crop type required");
        require(farmSize > 0, "WS: invalid farm size");

        // Calculate premium based on coverage and risk factors
        uint256 premium = calculatePremium(coverageAmount, duration, triggerType);
        require(msg.value >= premium, "WS: insufficient premium");

        policyCounter++;
        policyId = policyCounter;

        policies[policyId] = Policy({
            policyId: policyId,
            policyholder: msg.sender,
            locationHash: locationHash,
            triggerType: triggerType,
            triggerThreshold: triggerThreshold,
            premium: premium,
            coverageAmount: coverageAmount,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            status: PolicyStatus.Active,
            cropType: cropType,
            farmSize: farmSize
        });

        holderPolicies[msg.sender].push(policyId);
        treasuryBalance += premium;
        totalPremiumsCollected += premium;

        // Refund excess payment
        if (msg.value > premium) {
            (bool success, ) = payable(msg.sender).call{value: msg.value - premium}("");
            require(success, "WS: refund failed");
        }

        emit PolicyCreated(policyId, msg.sender, locationHash);
        emit PremiumDeposited(policyId, premium);

        return policyId;
    }

    /**
     * @notice Cancel an active policy
     * @param policyId The policy ID to cancel
     */
    function cancelPolicy(uint256 policyId) external nonReentrant {
        Policy storage policy = policies[policyId];
        require(policy.policyholder == msg.sender, "WS: not policyholder");
        require(policy.status == PolicyStatus.Active, "WS: policy not active");
        require(block.timestamp < policy.endTime, "WS: policy expired");

        // Calculate refund based on remaining duration
        uint256 totalDuration = policy.endTime - policy.startTime;
        uint256 elapsedDuration = block.timestamp - policy.startTime;
        uint256 refundAmount = (policy.premium * (totalDuration - elapsedDuration)) / totalDuration;

        // Apply cancellation fee (10%)
        uint256 cancellationFee = refundAmount / 10;
        refundAmount -= cancellationFee;

        policy.status = PolicyStatus.Cancelled;
        treasuryBalance -= refundAmount;

        (bool success, ) = payable(msg.sender).call{value: refundAmount}("");
        require(success, "WS: refund failed");

        emit PolicyCancelled(policyId, msg.sender);
    }

    /**
     * @notice Initiate a claim for a policy
     * @param policyId The policy ID to claim against
     * @return claimId The created claim ID
     */
    function initiateClaim(uint256 policyId) external nonReentrant whenNotPaused returns (uint256 claimId) {
        Policy storage policy = policies[policyId];
        require(policy.policyholder == msg.sender, "WS: not policyholder");
        require(policy.status == PolicyStatus.Active, "WS: policy not active");
        require(block.timestamp >= policy.startTime, "WS: policy not started");
        require(block.timestamp <= policy.endTime, "WS: policy expired");

        // Request weather data from FDC
        bytes32 weatherRequestId = flareDataConnector.requestWeatherData(
            policy.locationHash,
            block.timestamp
        );

        claimCounter++;
        claimId = claimCounter;

        claims[claimId] = Claim({
            claimId: claimId,
            policyId: policyId,
            timestamp: block.timestamp,
            actualValue: 0,
            payoutAmount: 0,
            processed: false,
            weatherDataRequestId: weatherRequestId
        });

        policyClaims[policyId].push(claimId);

        emit ClaimInitiated(claimId, policyId, msg.sender);
        return claimId;
    }

    /**
     * @notice Process a claim after weather data is available
     * @param claimId The claim ID to process
     */
    function processClaim(uint256 claimId) external nonReentrant whenNotPaused {
        Claim storage claim = claims[claimId];
        require(!claim.processed, "WS: claim already processed");

        Policy storage policy = policies[claim.policyId];
        require(policy.status == PolicyStatus.Active, "WS: policy not active");

        // Get weather data from FDC
        (bool available, bool verified) = flareDataConnector.isDataAvailable(claim.weatherDataRequestId);
        require(available && verified, "WS: weather data not ready");

        IFlareDataConnector.WeatherData memory weatherData = flareDataConnector.getWeatherData(
            claim.weatherDataRequestId
        );

        // Evaluate trigger condition
        bool triggerMet = evaluateTrigger(policy, weatherData);

        if (triggerMet) {
            // Calculate payout
            uint256 payoutAmount = policy.coverageAmount;
            require(treasuryBalance >= payoutAmount, "WS: insufficient treasury");

            claim.payoutAmount = payoutAmount;
            claim.actualValue = getRelevantWeatherValue(policy.triggerType, weatherData);
            claim.processed = true;
            policy.status = PolicyStatus.ClaimPaid;
            
            treasuryBalance -= payoutAmount;
            totalClaimsPaid += payoutAmount;

            // Transfer payout to policyholder
            (bool success, ) = payable(policy.policyholder).call{value: payoutAmount}("");
            require(success, "WS: payout failed");

            emit ClaimProcessed(claimId, policy.policyId, payoutAmount);
        } else {
            claim.actualValue = getRelevantWeatherValue(policy.triggerType, weatherData);
            claim.processed = true;
            claim.payoutAmount = 0;

            emit ClaimProcessed(claimId, policy.policyId, 0);
        }
    }

    /**
     * @notice Evaluate if the trigger condition is met
     * @param policy The insurance policy
     * @param weatherData The weather data from FDC
     * @return Whether the trigger condition is met
     */
    function evaluateTrigger(
        Policy storage policy,
        IFlareDataConnector.WeatherData memory weatherData
    ) internal view returns (bool) {
        if (policy.triggerType == TriggerType.RainfallBelow) {
            return int256(weatherData.rainfall) < policy.triggerThreshold;
        } else if (policy.triggerType == TriggerType.RainfallAbove) {
            return int256(weatherData.rainfall) > policy.triggerThreshold;
        } else if (policy.triggerType == TriggerType.TemperatureBelow) {
            return weatherData.temperature < policy.triggerThreshold;
        } else if (policy.triggerType == TriggerType.TemperatureAbove) {
            return weatherData.temperature > policy.triggerThreshold;
        } else if (policy.triggerType == TriggerType.WindSpeedAbove) {
            return int256(weatherData.windSpeed) > policy.triggerThreshold;
        }
        return false;
    }

    /**
     * @notice Get the relevant weather value for a trigger type
     */
    function getRelevantWeatherValue(
        TriggerType triggerType,
        IFlareDataConnector.WeatherData memory weatherData
    ) internal pure returns (int256) {
        if (triggerType == TriggerType.RainfallBelow || triggerType == TriggerType.RainfallAbove) {
            return int256(weatherData.rainfall);
        } else if (triggerType == TriggerType.TemperatureBelow || triggerType == TriggerType.TemperatureAbove) {
            return weatherData.temperature;
        } else if (triggerType == TriggerType.WindSpeedAbove) {
            return int256(weatherData.windSpeed);
        }
        return 0;
    }

    /**
     * @notice Calculate premium for a policy
     * @param coverageAmount The coverage amount
     * @param duration Policy duration
     * @param triggerType Type of weather trigger
     * @return premium The calculated premium
     */
    function calculatePremium(
        uint256 coverageAmount,
        uint256 duration,
        TriggerType triggerType
    ) public view returns (uint256 premium) {
        // Base premium calculation
        premium = (coverageAmount * basePremiumRate) / 10000;
        
        // Adjust for duration (longer = higher premium)
        uint256 durationMultiplier = (duration * 100) / 365 days;
        premium = (premium * durationMultiplier) / 100;
        
        // Adjust for risk type
        uint256 riskMultiplier = getRiskMultiplier(triggerType);
        premium = (premium * riskMultiplier) / 100;
        
        // Minimum premium
        if (premium < 0.001 ether) {
            premium = 0.001 ether;
        }
        
        return premium;
    }

    /**
     * @notice Get risk multiplier for different trigger types
     */
    function getRiskMultiplier(TriggerType triggerType) internal pure returns (uint256) {
        if (triggerType == TriggerType.RainfallBelow) {
            return 120; // 1.2x - Drought risk
        } else if (triggerType == TriggerType.RainfallAbove) {
            return 150; // 1.5x - Flood risk
        } else if (triggerType == TriggerType.TemperatureBelow) {
            return 110; // 1.1x - Frost risk
        } else if (triggerType == TriggerType.TemperatureAbove) {
            return 130; // 1.3x - Heat wave risk
        } else if (triggerType == TriggerType.WindSpeedAbove) {
            return 140; // 1.4x - Storm risk
        }
        return 100;
    }

    // View functions
    
    function getPolicy(uint256 policyId) external view override returns (Policy memory) {
        return policies[policyId];
    }

    function getClaim(uint256 claimId) external view override returns (Claim memory) {
        return claims[claimId];
    }

    function getPoliciesByHolder(address holder) external view override returns (uint256[] memory) {
        return holderPolicies[holder];
    }

    function getClaimsByPolicy(uint256 policyId) external view returns (uint256[] memory) {
        return policyClaims[policyId];
    }

    function getPolicyCount() external view returns (uint256) {
        return policyCounter;
    }

    function getClaimCount() external view returns (uint256) {
        return claimCounter;
    }

    // Admin functions

    function setFlareDataConnector(address _fdc) external onlyOwner {
        require(_fdc != address(0), "WS: invalid FDC address");
        address oldFDC = address(flareDataConnector);
        flareDataConnector = IFlareDataConnector(_fdc);
        emit FDCUpdated(oldFDC, _fdc);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "WS: invalid treasury");
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    function setBasePremiumRate(uint256 _rate) external onlyOwner {
        require(_rate > 0 && _rate <= 5000, "WS: invalid rate"); // Max 50%
        uint256 oldRate = basePremiumRate;
        basePremiumRate = _rate;
        emit PremiumRateUpdated(oldRate, _rate);
    }

    function setCoverageLimits(uint256 _min, uint256 _max) external onlyOwner {
        require(_min < _max, "WS: invalid limits");
        minCoverageAmount = _min;
        maxCoverageAmount = _max;
    }

    function setDurationLimits(uint256 _min, uint256 _max) external onlyOwner {
        require(_min < _max, "WS: invalid limits");
        minPolicyDuration = _min;
        maxPolicyDuration = _max;
    }

    function fundTreasury() external payable onlyOwner {
        require(msg.value > 0, "WS: zero amount");
        treasuryBalance += msg.value;
        emit TreasuryFunded(msg.sender, msg.value);
    }

    function withdrawFromTreasury(uint256 amount) external onlyOwner {
        require(amount <= treasuryBalance, "WS: insufficient balance");
        treasuryBalance -= amount;
        (bool success, ) = payable(treasury).call{value: amount}("");
        require(success, "WS: withdrawal failed");
        emit TreasuryWithdrawn(treasury, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Receive function to accept funds
    receive() external payable {
        treasuryBalance += msg.value;
        emit TreasuryFunded(msg.sender, msg.value);
    }
}
```

## Tests: WeatherShield.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("WeatherShieldInsurance", function () {
  let flareDataConnector;
  let weatherShieldInsurance;
  let weatherOracle;
  let owner;
  let farmer1;
  let farmer2;
  let treasury;

  const TRIGGER_TYPES = {
    RainfallBelow: 0,
    RainfallAbove: 1,
    TemperatureBelow: 2,
    TemperatureAbove: 3,
    WindSpeedAbove: 4,
  };

  const POLICY_STATUS = {
    Active: 0,
    Expired: 1,
    ClaimPaid: 2,
    Cancelled: 3,
  };

  // Test location hash
  let testLocationHash;

  beforeEach(async function () {
    [owner, farmer1, farmer2, treasury] = await ethers.getSigners();

    // Deploy FlareDataConnector
    const FlareDataConnector = await ethers.getContractFactory("FlareDataConnector");
    flareDataConnector = await FlareDataConnector.deploy();
    await flareDataConnector.waitForDeployment();

    // Deploy WeatherShieldInsurance
    const WeatherShieldInsurance = await ethers.getContractFactory("WeatherShieldInsurance");
    weatherShieldInsurance = await WeatherShieldInsurance.deploy(
      await flareDataConnector.getAddress(),
      treasury.address
    );
    await weatherShieldInsurance.waitForDeployment();

    // Deploy WeatherOracle
    const WeatherOracle = await ethers.getContractFactory("WeatherOracle");
    weatherOracle = await WeatherOracle.deploy(await flareDataConnector.getAddress());
    await weatherOracle.waitForDeployment();

    // Authorize oracle as FDC provider
    await flareDataConnector.authorizeProvider(await weatherOracle.getAddress());

    // Create test location hash
    testLocationHash = await flareDataConnector.createLocationHash(41900000, -93100000);

    // Fund treasury
    await weatherShieldInsurance.fundTreasury({ value: ethers.parseEther("10") });
  });

  describe("Deployment", function () {
    it("Should set the correct FDC address", async function () {
      expect(await weatherShieldInsurance.flareDataConnector()).to.equal(
        await flareDataConnector.getAddress()
      );
    });

    it("Should set the correct treasury address", async function () {
      expect(await weatherShieldInsurance.treasury()).to.equal(treasury.address);
    });

    it("Should set the correct owner", async function () {
      expect(await weatherShieldInsurance.owner()).to.equal(owner.address);
    });

    it("Should have funded treasury", async function () {
      expect(await weatherShieldInsurance.treasuryBalance()).to.equal(ethers.parseEther("10"));
    });
  });

  describe("Policy Creation", function () {
    it("Should create a policy with correct parameters", async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 30 * 24 * 60 * 60; // 30 days
      const premium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );

      await expect(
        weatherShieldInsurance.connect(farmer1).createPolicy(
          testLocationHash,
          TRIGGER_TYPES.RainfallBelow,
          5000, // 50mm threshold
          coverageAmount,
          duration,
          "Corn",
          50000, // 500 hectares
          { value: premium }
        )
      )
        .to.emit(weatherShieldInsurance, "PolicyCreated")
        .withArgs(1, farmer1.address, testLocationHash);

      const policy = await weatherShieldInsurance.getPolicy(1);
      expect(policy.policyholder).to.equal(farmer1.address);
      expect(policy.locationHash).to.equal(testLocationHash);
      expect(policy.triggerType).to.equal(TRIGGER_TYPES.RainfallBelow);
      expect(policy.triggerThreshold).to.equal(5000);
      expect(policy.coverageAmount).to.equal(coverageAmount);
      expect(policy.status).to.equal(POLICY_STATUS.Active);
      expect(policy.cropType).to.equal("Corn");
      expect(policy.farmSize).to.equal(50000);
    });

    it("Should reject insufficient premium", async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 30 * 24 * 60 * 60;

      await expect(
        weatherShieldInsurance.connect(farmer1).createPolicy(
          testLocationHash,
          TRIGGER_TYPES.RainfallBelow,
          5000,
          coverageAmount,
          duration,
          "Corn",
          50000,
          { value: ethers.parseEther("0.0001") } // Too low
        )
      ).to.be.revertedWith("WS: insufficient premium");
    });

    it("Should reject coverage below minimum", async function () {
      await expect(
        weatherShieldInsurance.connect(farmer1).createPolicy(
          testLocationHash,
          TRIGGER_TYPES.RainfallBelow,
          5000,
          ethers.parseEther("0.001"), // Below min
          30 * 24 * 60 * 60,
          "Corn",
          50000,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWith("WS: coverage too low");
    });

    it("Should reject duration below minimum", async function () {
      await expect(
        weatherShieldInsurance.connect(farmer1).createPolicy(
          testLocationHash,
          TRIGGER_TYPES.RainfallBelow,
          5000,
          ethers.parseEther("0.1"),
          1 * 24 * 60 * 60, // 1 day - too short
          "Corn",
          50000,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWith("WS: duration too short");
    });

    it("Should refund excess premium", async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 30 * 24 * 60 * 60;
      const premium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );
      const excess = ethers.parseEther("0.5");
      const totalSent = premium + excess;

      const balanceBefore = await ethers.provider.getBalance(farmer1.address);

      const tx = await weatherShieldInsurance.connect(farmer1).createPolicy(
        testLocationHash,
        TRIGGER_TYPES.RainfallBelow,
        5000,
        coverageAmount,
        duration,
        "Corn",
        50000,
        { value: totalSent }
      );

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(farmer1.address);

      // Balance should decrease by premium + gas, not by total sent
      expect(balanceBefore - balanceAfter - gasUsed).to.be.closeTo(premium, ethers.parseEther("0.001"));
    });
  });

  describe("Policy Cancellation", function () {
    beforeEach(async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 30 * 24 * 60 * 60;
      const premium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );

      await weatherShieldInsurance.connect(farmer1).createPolicy(
        testLocationHash,
        TRIGGER_TYPES.RainfallBelow,
        5000,
        coverageAmount,
        duration,
        "Corn",
        50000,
        { value: premium }
      );
    });

    it("Should allow policyholder to cancel", async function () {
      await expect(weatherShieldInsurance.connect(farmer1).cancelPolicy(1))
        .to.emit(weatherShieldInsurance, "PolicyCancelled")
        .withArgs(1, farmer1.address);

      const policy = await weatherShieldInsurance.getPolicy(1);
      expect(policy.status).to.equal(POLICY_STATUS.Cancelled);
    });

    it("Should not allow non-policyholder to cancel", async function () {
      await expect(
        weatherShieldInsurance.connect(farmer2).cancelPolicy(1)
      ).to.be.revertedWith("WS: not policyholder");
    });

    it("Should provide partial refund on cancellation", async function () {
      const balanceBefore = await ethers.provider.getBalance(farmer1.address);

      // Move time forward by 10 days
      await time.increase(10 * 24 * 60 * 60);

      const tx = await weatherShieldInsurance.connect(farmer1).cancelPolicy(1);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(farmer1.address);

      // Should have received some refund (minus gas)
      expect(balanceAfter + gasUsed).to.be.gt(balanceBefore);
    });
  });

  describe("Claim Processing", function () {
    let policyId;

    beforeEach(async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 30 * 24 * 60 * 60;
      const premium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );

      const tx = await weatherShieldInsurance.connect(farmer1).createPolicy(
        testLocationHash,
        TRIGGER_TYPES.RainfallBelow,
        5000, // 50mm threshold
        coverageAmount,
        duration,
        "Corn",
        50000,
        { value: premium }
      );

      const receipt = await tx.wait();
      policyId = 1;
    });

    it("Should initiate a claim", async function () {
      await expect(weatherShieldInsurance.connect(farmer1).initiateClaim(policyId))
        .to.emit(weatherShieldInsurance, "ClaimInitiated")
        .withArgs(1, policyId, farmer1.address);

      const claim = await weatherShieldInsurance.getClaim(1);
      expect(claim.policyId).to.equal(policyId);
      expect(claim.processed).to.equal(false);
    });

    it("Should process claim and payout when trigger met", async function () {
      // Initiate claim
      await weatherShieldInsurance.connect(farmer1).initiateClaim(policyId);
      const claim = await weatherShieldInsurance.getClaim(1);

      // Fulfill weather data with rainfall below threshold (drought)
      await flareDataConnector.fulfillWeatherData(
        claim.weatherDataRequestId,
        2500, // 25°C
        3000, // 30mm - below 50mm threshold
        6500, // 65% humidity
        1500  // 15 km/h wind
      );

      const balanceBefore = await ethers.provider.getBalance(farmer1.address);

      // Process claim
      const tx = await weatherShieldInsurance.processClaim(1);
      const receipt = await tx.wait();

      const balanceAfter = await ethers.provider.getBalance(farmer1.address);

      // Farmer should have received payout
      expect(balanceAfter).to.be.gt(balanceBefore);

      // Check claim status
      const processedClaim = await weatherShieldInsurance.getClaim(1);
      expect(processedClaim.processed).to.equal(true);
      expect(processedClaim.payoutAmount).to.equal(ethers.parseEther("1"));

      // Check policy status
      const policy = await weatherShieldInsurance.getPolicy(policyId);
      expect(policy.status).to.equal(POLICY_STATUS.ClaimPaid);
    });

    it("Should not payout when trigger not met", async function () {
      // Initiate claim
      await weatherShieldInsurance.connect(farmer1).initiateClaim(policyId);
      const claim = await weatherShieldInsurance.getClaim(1);

      // Fulfill weather data with rainfall above threshold (no drought)
      await flareDataConnector.fulfillWeatherData(
        claim.weatherDataRequestId,
        2500, // 25°C
        8000, // 80mm - above 50mm threshold
        6500,
        1500
      );

      // Process claim
      await weatherShieldInsurance.processClaim(1);

      // Check claim - no payout
      const processedClaim = await weatherShieldInsurance.getClaim(1);
      expect(processedClaim.processed).to.equal(true);
      expect(processedClaim.payoutAmount).to.equal(0);

      // Policy should still be active
      const policy = await weatherShieldInsurance.getPolicy(policyId);
      expect(policy.status).to.equal(POLICY_STATUS.Active);
    });

    it("Should not allow claim on non-active policy", async function () {
      // Cancel policy first
      await weatherShieldInsurance.connect(farmer1).cancelPolicy(policyId);

      await expect(
        weatherShieldInsurance.connect(farmer1).initiateClaim(policyId)
      ).to.be.revertedWith("WS: policy not active");
    });

    it("Should not allow non-policyholder to initiate claim", async function () {
      await expect(
        weatherShieldInsurance.connect(farmer2).initiateClaim(policyId)
      ).to.be.revertedWith("WS: not policyholder");
    });
  });

  describe("Premium Calculation", function () {
    it("Should calculate correct base premium", async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 365 * 24 * 60 * 60; // 1 year

      const premium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );

      // Base rate is 5%, drought multiplier is 1.2x, duration multiplier is 1x for 1 year
      // Expected: 1 ETH * 0.05 * 1.2 = 0.06 ETH
      expect(premium).to.be.closeTo(ethers.parseEther("0.06"), ethers.parseEther("0.01"));
    });

    it("Should apply higher multiplier for flood risk", async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 365 * 24 * 60 * 60;

      const droughtPremium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );

      const floodPremium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallAbove
      );

      // Flood (1.5x) should be higher than drought (1.2x)
      expect(floodPremium).to.be.gt(droughtPremium);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set premium rate", async function () {
      await weatherShieldInsurance.setBasePremiumRate(1000); // 10%
      expect(await weatherShieldInsurance.basePremiumRate()).to.equal(1000);
    });

    it("Should allow owner to pause/unpause", async function () {
      await weatherShieldInsurance.pause();
      
      await expect(
        weatherShieldInsurance.connect(farmer1).createPolicy(
          testLocationHash,
          TRIGGER_TYPES.RainfallBelow,
          5000,
          ethers.parseEther("1"),
          30 * 24 * 60 * 60,
          "Corn",
          50000,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.reverted;

      await weatherShieldInsurance.unpause();

      // Should work now
      const premium = await weatherShieldInsurance.calculatePremium(
        ethers.parseEther("1"),
        30 * 24 * 60 * 60,
        TRIGGER_TYPES.RainfallBelow
      );
      
      await weatherShieldInsurance.connect(farmer1).createPolicy(
        testLocationHash,
        TRIGGER_TYPES.RainfallBelow,
        5000,
        ethers.parseEther("1"),
        30 * 24 * 60 * 60,
        "Corn",
        50000,
        { value: premium }
      );
    });

    it("Should allow owner to withdraw from treasury", async function () {
      const treasuryBalanceBefore = await ethers.provider.getBalance(treasury.address);
      
      await weatherShieldInsurance.withdrawFromTreasury(ethers.parseEther("5"));
      
      const treasuryBalanceAfter = await ethers.provider.getBalance(treasury.address);
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(ethers.parseEther("5"));
    });
  });
});

describe("FlareDataConnector", function () {
  let flareDataConnector;
  let owner;
  let provider;
  let user;

  beforeEach(async function () {
    [owner, provider, user] = await ethers.getSigners();

    const FlareDataConnector = await ethers.getContractFactory("FlareDataConnector");
    flareDataConnector = await FlareDataConnector.deploy();
    await flareDataConnector.waitForDeployment();
  });

  describe("Weather Data Requests", function () {
    it("Should create location hash correctly", async function () {
      const hash = await flareDataConnector.createLocationHash(41900000, -93100000);
      expect(hash).to.not.equal(ethers.ZeroHash);
    });

    it("Should request weather data", async function () {
      const locationHash = await flareDataConnector.createLocationHash(41900000, -93100000);
      const timestamp = Math.floor(Date.now() / 1000);

      await expect(flareDataConnector.requestWeatherData(locationHash, timestamp))
        .to.emit(flareDataConnector, "WeatherDataRequested");
    });

    it("Should fulfill weather data by authorized provider", async function () {
      await flareDataConnector.authorizeProvider(provider.address);

      const locationHash = await flareDataConnector.createLocationHash(41900000, -93100000);
      const timestamp = Math.floor(Date.now() / 1000);

      const tx = await flareDataConnector.requestWeatherData(locationHash, timestamp);
      const receipt = await tx.wait();
      
      // Get requestId from event
      const event = receipt.logs.find(log => {
        try {
          return flareDataConnector.interface.parseLog(log)?.name === "WeatherDataRequested";
        } catch {
          return false;
        }
      });
      const parsedEvent = flareDataConnector.interface.parseLog(event);
      const requestId = parsedEvent.args[0];

      // Fulfill data
      await expect(
        flareDataConnector.connect(provider).fulfillWeatherData(
          requestId,
          2500, // 25°C
          8000, // 80mm
          6500, // 65%
          1500  // 15 km/h
        )
      ).to.emit(flareDataConnector, "WeatherDataFulfilled");

      // Verify data
      const data = await flareDataConnector.getWeatherData(requestId);
      expect(data.temperature).to.equal(2500);
      expect(data.rainfall).to.equal(8000);
      expect(data.isVerified).to.equal(true);
    });

    it("Should reject unauthorized provider", async function () {
      const locationHash = await flareDataConnector.createLocationHash(41900000, -93100000);
      const timestamp = Math.floor(Date.now() / 1000);

      const tx = await flareDataConnector.requestWeatherData(locationHash, timestamp);
      const receipt = await tx.wait();
      
      const event = receipt.logs.find(log => {
        try {
          return flareDataConnector.interface.parseLog(log)?.name === "WeatherDataRequested";
        } catch {
          return false;
        }
      });
      const parsedEvent = flareDataConnector.interface.parseLog(event);
      const requestId = parsedEvent.args[0];

      await expect(
        flareDataConnector.connect(user).fulfillWeatherData(requestId, 2500, 8000, 6500, 1500)
      ).to.be.revertedWith("FDC: not authorized provider");
    });
  });
});

describe("PolicyFactory", function () {
  let flareDataConnector;
  let weatherShieldInsurance;
  let policyFactory;
  let owner;
  let farmer;
  let treasury;
  let testLocationHash;

  beforeEach(async function () {
    [owner, farmer, treasury] = await ethers.getSigners();

    const FlareDataConnector = await ethers.getContractFactory("FlareDataConnector");
    flareDataConnector = await FlareDataConnector.deploy();
    await flareDataConnector.waitForDeployment();

    const WeatherShieldInsurance = await ethers.getContractFactory("WeatherShieldInsurance");
    weatherShieldInsurance = await WeatherShieldInsurance.deploy(
      await flareDataConnector.getAddress(),
      treasury.address
    );
    await weatherShieldInsurance.waitForDeployment();

    const PolicyFactory = await ethers.getContractFactory("PolicyFactory");
    policyFactory = await PolicyFactory.deploy(await weatherShieldInsurance.getAddress());
    await policyFactory.waitForDeployment();

    testLocationHash = await flareDataConnector.createLocationHash(41900000, -93100000);

    // Fund treasury
    await weatherShieldInsurance.fundTreasury({ value: ethers.parseEther("10") });
  });

  describe("Templates", function () {
    it("Should have default templates", async function () {
      expect(await policyFactory.templateCount()).to.equal(5);
    });

    it("Should get active templates", async function () {
      const templates = await policyFactory.getActiveTemplates();
      expect(templates.length).to.equal(5);
    });

    it("Should create policy from template", async function () {
      const baseCoverage = ethers.parseEther("1");
      const premium = await policyFactory.estimatePremium(1, baseCoverage);

      await policyFactory.connect(farmer).createPolicyFromTemplate(
        1, // Drought protection template
        testLocationHash,
        baseCoverage,
        "Wheat",
        30000,
        { value: premium }
      );

      const policyCount = await weatherShieldInsurance.getPolicyCount();
      expect(policyCount).to.equal(1);
    });
  });
});
```
