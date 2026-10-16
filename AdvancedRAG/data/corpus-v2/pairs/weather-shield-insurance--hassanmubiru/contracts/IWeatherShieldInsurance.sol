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
