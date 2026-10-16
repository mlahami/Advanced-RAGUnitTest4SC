// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title IRealEstateChain
/// @notice Interface for the RealEstateChain contract — an ERC721-based NFT system for tokenized real estate
/// @dev This interface defines the core functions required for minting, updating, and querying real estate NFTs in the RealEstateChain platform.
/// The contract implementing this interface must allow minting new properties, updating their metadata, and checking the existence of properties.
interface IRealEstateChain is IERC721 {

    /// @notice Emitted when a new property NFT is successfully minted.
    /// @param to The address that receives the newly minted NFT.
    /// @param tokenId The ID of the newly minted token.
    /// @param tokenURI The URI pointing to the metadata of the property.
    event PropertyMinted(address indexed to, uint256 indexed tokenId, string tokenURI);

    /// @notice Emitted when the metadata URI of an existing property NFT is updated.
    /// @param tokenId The ID of the token whose metadata was updated.
    /// @param newTokenURI The new URI pointing to the updated metadata.
    event PropertyUpdated(uint256 indexed tokenId, string newTokenURI);
    
    /// @notice Mint a new property NFT and assign it to a recipient
    /// @dev Only the contract owner can mint new properties. The `tokenURI` contains metadata about the property (e.g., IPFS link).
    /// @param recipient Address that will receive the minted NFT.
    /// @param tokenURI URI that points to the property metadata (such as an IPFS link or a URL).
    /// @return tokenId The ID of the newly minted token (NFT).
    function mintProperty(address recipient, string memory tokenURI) external returns (uint256);

    /// @notice Update the metadata URI of an existing property NFT
    /// @dev Only the contract owner can update the metadata URI. The `newTokenURI` is the updated IPFS link or URL.
    /// @param tokenId The ID of the token whose metadata is being updated.
    /// @param newTokenURI The new URI that will point to the updated metadata.
    function updatePropertyURI(uint256 tokenId, string memory newTokenURI) external;

    /// @notice Returns the total number of properties (tokens) minted in the RealEstateChain platform
    /// @dev This function counts the number of unique tokens (properties) minted so far.
    /// @return The total number of NFTs minted.
    function totalSupply() external view returns (uint256);

    /// @notice Check if a given property token exists
    /// @dev This function checks whether a property token with the given ID exists on the blockchain.
    /// @param tokenId The token ID of the property to check.
    /// @return True if the token exists, false otherwise.
    function exists(uint256 tokenId) external view returns (bool);
}