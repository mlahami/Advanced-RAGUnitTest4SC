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
