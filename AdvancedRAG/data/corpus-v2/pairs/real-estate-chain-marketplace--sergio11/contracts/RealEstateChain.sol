// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IRealEstateChain.sol";

/// @title RealEstateChain — Tokenized Real Estate Platform
/// @notice A contract that allows the minting, management, and metadata updates of tokenized real estate properties as ERC721 NFTs
/// @dev This contract allows the owner to mint new property NFTs, update their metadata, and manage the token's lifecycle.
contract RealEstateChain is ERC721URIStorage, Ownable, IRealEstateChain {
    uint256 private _tokenIds;

    // @dev Initializes the NFT collection with a name and symbol (RealEstateChain Property - DCP) and sets the owner.
    constructor(address initialOwner) ERC721("RealEstateChain Property - DCP", "DCP") Ownable(initialOwner) {}

    /// @inheritdoc IRealEstateChain
    /// @notice Mint a new property NFT and assign it to a recipient address.
    /// @dev The minting process is only allowed by the contract owner.
    /// @param recipient The address that will receive the minted NFT.
    /// @param tokenURI URI pointing to the metadata (e.g., IPFS or HTTP link).
    /// @return tokenId The ID of the newly minted token.
    function mintProperty(address recipient, string memory tokenURI) external onlyOwner returns (uint256 tokenId) {
        // Increment the token counter and generate a new unique token ID.
        _tokenIds++;
        tokenId = _tokenIds;

        // Mint the token and assign it to the recipient.
        _mint(recipient, tokenId);
        _setTokenURI(tokenId, tokenURI);

        // Emit an event to signal the minting of the property.
        emit PropertyMinted(recipient, tokenId, tokenURI);
    }

    /// @inheritdoc IRealEstateChain
    /// @notice Update the metadata URI for an existing property token.
    /// @dev This function can only be called by the owner of the contract.
    /// @param tokenId The ID of the property NFT whose metadata will be updated.
    /// @param newTokenURI The new metadata URI.
    function updatePropertyURI(uint256 tokenId, string memory newTokenURI) external onlyOwner {
        require(this.exists(tokenId), "Token does not exist");

        // Set the new metadata URI for the property.
        _setTokenURI(tokenId, newTokenURI);

        // Emit an event to notify that the metadata was updated.
        emit PropertyUpdated(tokenId, newTokenURI);
    }

    /// @inheritdoc IRealEstateChain
    /// @notice Get the total number of property NFTs minted in the RealEstateChain system.
    /// @dev This function helps track the total supply of tokenized real estate properties.
    /// @return The total number of minted property NFTs.
    function totalSupply() external view returns (uint256) {
        return _tokenIds;
    }

    /// @inheritdoc IRealEstateChain
    /// @notice Check if a specific token (property) exists.
    /// @dev Useful for verifying if a given property has been minted.
    /// @param tokenId The ID of the property to check.
    /// @return True if the token exists, false otherwise.
    function exists(uint256 tokenId) external view returns (bool) {
        // Check if the token exists by verifying that the owner is not the zero address.
        return ownerOf(tokenId) != address(0);
    }
}