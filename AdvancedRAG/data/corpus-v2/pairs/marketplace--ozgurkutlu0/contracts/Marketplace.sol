// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Marketplace — minimal fixed-price NFT sales
/// @notice Sellers approve this contract, then list. Buyers pay native MATIC and receive the NFT.
contract Marketplace is ReentrancyGuard {
    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    // nft => tokenId => listing
    mapping(address => mapping(uint256 => Listing)) public listings;

    event Listed(address indexed nft, uint256 indexed tokenId, address indexed seller, uint256 price);
    event Cancelled(address indexed nft, uint256 indexed tokenId, address indexed seller);
    event Bought(address indexed nft, uint256 indexed tokenId, address indexed buyer, address seller, uint256 price);

    error NotOwner();
    error NotApproved();
    error PriceZero();
    error NotListed();
    error WrongPrice();
    error NotSeller();
    error PaymentFailed();

    /// @notice List an owned NFT for sale at `price` wei. Requires prior approval to this contract.
    function list(address nft, uint256 tokenId, uint256 price) external {
        if (price == 0) revert PriceZero();
        IERC721 token = IERC721(nft);
        if (token.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (
            token.getApproved(tokenId) != address(this) &&
            !token.isApprovedForAll(msg.sender, address(this))
        ) revert NotApproved();

        listings[nft][tokenId] = Listing({seller: msg.sender, price: price, active: true});
        emit Listed(nft, tokenId, msg.sender, price);
    }

    /// @notice Cancel an active listing. Only callable by the seller.
    function cancel(address nft, uint256 tokenId) external {
        Listing memory l = listings[nft][tokenId];
        if (!l.active) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();

        delete listings[nft][tokenId];
        emit Cancelled(nft, tokenId, msg.sender);
    }

    /// @notice Buy a listed NFT. Pays the seller exactly msg.value, must equal the listing price.
    function buy(address nft, uint256 tokenId) external payable nonReentrant {
        Listing memory l = listings[nft][tokenId];
        if (!l.active) revert NotListed();
        if (msg.value != l.price) revert WrongPrice();

        delete listings[nft][tokenId];

        IERC721(nft).safeTransferFrom(l.seller, msg.sender, tokenId);

        (bool ok, ) = l.seller.call{value: msg.value}("");
        if (!ok) revert PaymentFailed();

        emit Bought(nft, tokenId, msg.sender, l.seller, l.price);
    }

    /// @notice Convenience getter that returns the listing struct.
    function getListing(address nft, uint256 tokenId) external view returns (Listing memory) {
        return listings[nft][tokenId];
    }
}
