// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ICrowdfundingCampaign} from "./ICrowdfundingCampaign.sol";

/**
 * @title MaliciousReentrantToken
 * @notice Attack vector mock simulating a reentrant token (e.g., ERC-777 hook or malicious transfer).
 * @dev INTENTIONAL SECURITY TEST HARNESS:
 * This contract is an intentional exploit simulation used in test suites to verify that
 * CrowdfundingCampaign properly repels reentrancy attacks via ReentrancyGuard and CEI.
 * Static analysis tools (such as Slither) will flag transfer() for reentrancy by design,
 * as it deliberately triggers an external callback to test target contract defenses.
 */
contract MaliciousReentrantToken is ERC20 {
    address public targetCampaign;
    bool public attackActive;
    enum AttackType { Withdraw, Refund }
    AttackType public attackType;

    constructor() ERC20("Malicious Token", "BAD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setAttackConfig(address _campaign, AttackType _type, bool _active) external {
        targetCampaign = _campaign;
        attackType = _type;
        attackActive = _active;
    }

    /**
     * @dev Deliberately attempts reentrancy on targetCampaign when called during campaign transfers.
     */
    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        if (attackActive && msg.sender == targetCampaign) {
            // Attempt to reenter the campaign before the first call finishes
            attackActive = false; // Prevent infinite recursion if guard fails
            if (attackType == AttackType.Withdraw) {
                ICrowdfundingCampaign(targetCampaign).withdrawBeforeThreshold(amount);
            } else if (attackType == AttackType.Refund) {
                ICrowdfundingCampaign(targetCampaign).claimRefund();
            }
        }
        return super.transfer(to, amount);
    }
}
