// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IRealEstateChain.sol";
import "./IRealEstateChainMarketplace.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title RealEstateChainMarketplace — Marketplace for Real Estate NFTs
/// @notice This contract enables users to list, buy, and unlist RealEstateChain property NFTs.
/// @dev Integrates with a RealEstateChain NFT contract and manages simple fixed-price sales.
contract RealEstateChainMarketplace is IRealEstateChainMarketplace, ReentrancyGuard, Ownable {
    using Address for address payable;

    /// @notice Reference to the NFT contract
    IRealEstateChain public immutable realEstateChain;

    /// @dev Maps tokenId to listing info
    mapping(uint256 => Listing) private _listings;

    /// @dev Constructor for initializing the RealEstateChainMarketplace contract.
    ///       It sets the initial owner of the marketplace and associates it with
    ///       the deployed RealEstateChain NFT contract.
    /// @param initialOwner The address of the account that will be assigned as the owner of the marketplace.
    /// @param realEstateChainAddress The address of the deployed RealEstateChain contract, which is used for interacting with the NFT properties.
    constructor(address initialOwner, address realEstateChainAddress) Ownable(initialOwner) {
        require(realEstateChainAddress != address(0), "Invalid NFT contract address");
        realEstateChain = IRealEstateChain(realEstateChainAddress);
    }

    /// @inheritdoc IRealEstateChainMarketplace
    function listProperty(uint256 tokenId, uint256 price) external override {
        require(price > 0, "Price must be greater than zero");
        require(realEstateChain.ownerOf(tokenId) == msg.sender, "Only the owner can list the property");
        require(!_isListed(tokenId), "Property already listed");

        // Transfer NFT to the marketplace contract (escrow)
        IERC721(address(realEstateChain)).transferFrom(msg.sender, address(this), tokenId);

        _listings[tokenId] = Listing({
            seller: msg.sender,
            price: price
        });

        emit PropertyListed(msg.sender, tokenId, price);
    }

    /// @inheritdoc IRealEstateChainMarketplace
    function cancelListing(uint256 tokenId) external override {
        Listing memory listing = _listings[tokenId];
        require(listing.seller == msg.sender, "Only seller can cancel listing");

        delete _listings[tokenId];

        // Transfer NFT back to the seller
        IERC721(address(realEstateChain)).transferFrom(address(this), msg.sender, tokenId);

        emit PropertyUnlisted(tokenId);
    }

    /// @inheritdoc IRealEstateChainMarketplace
    function buyProperty(uint256 tokenId) external payable override nonReentrant {
        Listing memory listing = _listings[tokenId];
        require(listing.price > 0, "Property not listed");
        require(msg.value >= listing.price, "Insufficient payment");

        delete _listings[tokenId];

        // Transfer payment to the seller
        payable(listing.seller).sendValue(listing.price);

        // Transfer NFT to the buyer
        IERC721(address(realEstateChain)).transferFrom(address(this), msg.sender, tokenId);

        emit PropertySold(msg.sender, tokenId, listing.price);
    }

    /// @inheritdoc IRealEstateChainMarketplace
    function isListed(uint256 tokenId) external view override returns (bool) {
        return _isListed(tokenId);
    }

    /// @inheritdoc IRealEstateChainMarketplace
    function listings(uint256 tokenId) external view override returns (address seller, uint256 price) {
        Listing memory listing = _listings[tokenId];
        return (listing.seller, listing.price);
    }

    /// @dev Internal helper to check listing existence
    function _isListed(uint256 tokenId) internal view returns (bool) {
        return _listings[tokenId].price > 0;
    }
}