// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "./CompDefinitions.sol";

contract NFT {
    using TokenDefinitions for TokenDefinitions.NFT;

    event LegendaryPull(string message);

    mapping(uint256 => TokenDefinitions.NFT) private tokens;

    /**
     * @dev Creates an NFT with a rarity and level based on the provided tokenId.
     * Emits a `LegendaryPull` event if a Legendary NFT is created.
     * @param tokenId The unique identifier for the NFT.
     */
    function createNFT(uint256 tokenId) external {
        string memory rarity = _determineRarity(tokenId);
        uint8 level = _calculateLevel(tokenId);

        tokens[tokenId] = TokenDefinitions.NFT({
            rarity: rarity,
            level: level
        });
    }

    /**
     * @dev Retrieves the NFT details for a given tokenId.
     * @param tokenId The unique identifier for the NFT.
     * @return The NFT details as a `TokenDefinitions.NFT` struct.
     */
    function getToken(uint256 tokenId) external view returns (TokenDefinitions.NFT memory) {
        return tokens[tokenId];
    }

    /**
     * @dev Determines the rarity of an NFT based on its tokenId.
     * Emits a `LegendaryPull` event if the rarity is Legendary.
     * @param tokenId The unique identifier for the NFT.
     * @return The rarity as a string ("Legendary", "Rare", or "Common").
     */
    function _determineRarity(uint256 tokenId) internal returns (string memory) {
        if (tokenId % 100 < 10) {
            emit LegendaryPull("LEGENDARY NFT PULL!");
            return "Legendary";
        } else if (tokenId % 100 < 40) {
            return "Rare";
        } else {
            return "Common";
        }
    }

    /**
     * @dev Calculates the level of an NFT based on its tokenId.
     * @param tokenId The unique identifier for the NFT.
     * @return The level as an unsigned 8-bit integer.
     */
    function _calculateLevel(uint256 tokenId) internal pure returns (uint8) {
        return uint8(tokenId % 100);
    }
}