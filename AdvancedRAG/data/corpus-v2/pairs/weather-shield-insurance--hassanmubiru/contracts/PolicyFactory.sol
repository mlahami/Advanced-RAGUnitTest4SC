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
