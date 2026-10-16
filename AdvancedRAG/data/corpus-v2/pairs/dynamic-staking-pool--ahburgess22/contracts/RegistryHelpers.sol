// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

/// @title Registry Helpers - Utility Libraries for Pool and Reward Calculations

/// @notice Calculates the base reward using a deterministic formula
library BaseReward {
    function calculateBaseReward() internal view returns (uint256) {
        // Base reward calculation modded to 100 for reward scaling
        return uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, address(this)))) % 100;
    }
}

/// @notice Handles dynamic reward rate updates based on pool activity
library RewardRate {
    function updateRewardRate(uint256 baseReward, uint256 pools, uint256 stakes) internal pure returns (uint256) {
        // Reward rate increases if pools and stakes exist, otherwise defaults to 0
        uint256 activityMultiplier = pools > 1 ? (pools * 2) + (stakes / 10) : 1; // Higher pools and takes increase multiplier
        uint256 baseBonus = baseReward / 50; // Reward tied to base randomness (e.g., 2%)
        uint256 calculatedReward = (baseReward / 10) * activityMultiplier + baseBonus;

        return calculatedReward > 10000 ? 10000 : calculatedReward;
    }
}

/// @notice Manages staking power calculations based on token rarity
library PoolWeight {
    function calculatePoolStakingPower(uint256 rares, uint256 legendaries, uint256 tokens) internal pure returns (uint256) {
        // Weighting rarities: rares count double, legendaries quadruple
        return tokens + (rares * 2) + (legendaries * 4);
    }
}

/// @notice Validates operations using the global staking power
library Validator {
    function getValidationKey(uint256 globalStakingPower) internal view returns (uint256) {
        // Deterministic validation key based on global staking power
        return uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, address(this)))) % globalStakingPower;
    }
}