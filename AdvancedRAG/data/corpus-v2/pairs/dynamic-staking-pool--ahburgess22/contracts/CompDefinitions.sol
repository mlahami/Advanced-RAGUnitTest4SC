// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

/**
 * @dev A library for defining key data structures used in the staking and NFT ecosystem.
 */
library StakeDefinitions {
    /**
     * @dev Structure representing a staked token.
     * @param tokenId The unique identifier of the staked token.
     * @param stakingTime The timestamp when the token was staked.
     * @param rarity The rarity of the token (e.g., "Common", "Rare", "Legendary").
     * @param level The level of the token, represented as an unsigned 8-bit integer.
     */
    struct Stake {
        uint256 tokenId;
        uint256 stakingTime;
        string rarity;
        uint8 level;
    }
}

library TokenDefinitions {
    /**
     * @dev Structure representing an NFT's attributes.
     * @param rarity The rarity of the NFT (e.g., "Common", "Rare", "Legendary").
     * @param level The level of the NFT, represented as an unsigned 8-bit integer.
     */
    struct NFT {
        string rarity;
        uint8 level;
    }
}