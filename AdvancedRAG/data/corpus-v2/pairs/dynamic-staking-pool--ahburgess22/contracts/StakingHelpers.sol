// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "./CompDefinitions.sol";

library Rewards {
    /// @notice Calculates rewards based on staking duration.
    /// @param stakedDuration Time (in seconds) for which the token was staked.
    /// @return reward Calculated reward.
    function calculateReward(uint256 stakedDuration) internal pure returns (uint256) {
        uint256 reward = (stakedDuration / 60) * 10; // Reward: +10 RewardToken per minute
        return reward > 500 ? 500 : reward;       // Cap rewards at 500
    }

    /// @notice Computes level-based reward coefficient.
    /// @param level NFT's level.
    /// @return Coefficient based on level.
    function levelCoefficient(uint256 level) internal pure returns (uint256) {
        return (1 + (100 - level) / 10); // 10% increase per level decrement
    }

    /// @notice Computes rarity-based reward multiplier.
    /// @param rarity Rarity of the NFT ("Legendary", "Rare", or "Common").
    /// @return Multiplier based on rarity.
    function rarityCoefficient(string memory rarity) internal pure returns (uint256) {
        if (compareStrings(rarity, "Legendary")) {
            return 3;
        } else if (compareStrings(rarity, "Rare")) {
            return 2;
        } else {
            return 1; // Default for "Common"
        }
    }

    /// @notice Compares two strings for equality.
    /// @param tokenRarity First string.
    /// @param rarity Second string.
    /// @return True if strings are equal, false otherwise.
    function compareStrings(string memory tokenRarity, string memory rarity) internal pure returns (bool) {
        return keccak256(abi.encodePacked(tokenRarity)) == keccak256(abi.encodePacked(rarity));
    }
}

library StakeUtils {
    /// @notice Checks if a token is staked by the user.
    /// @param userStakes List of staked tokens.
    /// @param tokenId Token ID to check.
    /// @return True if token is staked, false otherwise.
    function isStakedByUser(StakeDefinitions.Stake[] memory userStakes, uint256 tokenId) internal pure returns (bool) {
        for (uint256 i = 0; i < userStakes.length; i++) {
            if (userStakes[i].tokenId == tokenId) {
                return true;
            }
        }
        return false;
    }

    /// @notice Finds the index of a token in the user's stakes.
    /// @param ownerStakes List of staked tokens.
    /// @param tokenId Token ID to find.
    /// @return Index of the token.
    function findStakedIndex(StakeDefinitions.Stake[] memory ownerStakes, uint256 tokenId) internal pure returns (uint256) {
        for (uint256 i = 0; i < ownerStakes.length; i++) {
            if (ownerStakes[i].tokenId == tokenId) {
                return i;
            }
        }
        revert("DST: Token not found.");
    }
}

library TokenSupplyTracker {
    struct SupplyTracker {
        uint256 totalSupply;
    }

    /// @notice Increments the total token supply.
    /// @param tracker Storage reference to the supply tracker.
    function increment(SupplyTracker storage tracker) internal {
        tracker.totalSupply++;
    }

    /// @notice Gets the current total token supply.
    /// @param tracker Storage reference to the supply tracker.
    /// @return Total supply value.
    function get(SupplyTracker storage tracker) internal view returns (uint256) {
        return tracker.totalSupply;
    }
}

