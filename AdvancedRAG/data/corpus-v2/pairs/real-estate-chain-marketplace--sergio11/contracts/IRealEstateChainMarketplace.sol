// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IRealEstateChainMarketplace
/// @notice Interface for the RealEstateChain real estate NFT marketplace
interface IRealEstateChainMarketplace {
    /// @notice Struct representing a property listing
    struct Listing {
        address seller;
        uint256 price;
    }

    /// @notice Emitted when a property is listed for sale
    event PropertyListed(address indexed seller, uint256 indexed tokenId, uint256 price);

    /// @notice Emitted when a property is sold
    event PropertySold(address indexed buyer, uint256 indexed tokenId, uint256 price);

    /// @notice Emitted when a property is unlisted
    event PropertyUnlisted(uint256 indexed tokenId);

    /// @notice List a property (tokenId) for sale at a specified price
    /// @param tokenId The ID of the property to list
    /// @param price The sale price in wei
    function listProperty(uint256 tokenId, uint256 price) external;

    /// @notice Cancel a listing
    /// @param tokenId The ID of the property to unlist
    function cancelListing(uint256 tokenId) external;

    /// @notice Buy a listed property
    /// @param tokenId The ID of the property to purchase
    function buyProperty(uint256 tokenId) external payable;

    /// @notice Returns whether a token is listed for sale
    /// @param tokenId The ID of the token
    /// @return True if listed, false otherwise
    function isListed(uint256 tokenId) external view returns (bool);

    /// @notice Access listing info (optional)
    /// @param tokenId The token ID to fetch the listing for
    /// @return seller The address of the seller
    /// @return price The price in wei
    function listings(uint256 tokenId) external view returns (address seller, uint256 price);
}