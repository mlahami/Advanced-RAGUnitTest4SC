// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Decentralised Peer-to-Peer Marketplace
/// @notice Allows trustless listing, ETH-based purchases, on-chain ownership
///         transfer, and a tamper-proof on-chain reviews/ratings system.
/// @dev No central authority holds funds or controls listings — all state
///      transitions and payments happen atomically inside the contract.
contract Marketplace {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Item {
        uint256 id;
        address payable seller;   // current seller / listing owner
        address owner;            // current owner of the item (buyer after sale)
        string title;
        string description;
        uint256 price;            // price in wei
        bool sold;                // true once purchased and not yet relisted
        bool active;              // true while available to buy
    }

    struct Review {
        address reviewer;
        uint256 itemId;
        uint8 rating;             // 1-5
        string comment;
        uint256 timestamp;
    }

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    uint256 private nextItemId = 1;
    uint256[] private itemIds;

    mapping(uint256 => Item) public items;

    // seller => array of reviews received
    mapping(address => Review[]) private sellerReviews;
    // seller => running sum of ratings (for O(1) average calculation)
    mapping(address => uint256) private ratingSum;

    // itemId => buyer => seller they purchased that listing from
    // (kept distinct from item.seller because an item can be relisted/resold
    //  by a new owner, changing the seller for future buyers)
    mapping(uint256 => mapping(address => address)) private purchasedFrom;
    // itemId => buyer => already left a review for that specific purchase
    mapping(uint256 => mapping(address => bool)) private hasReviewed;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ItemListed(uint256 indexed itemId, address indexed seller, string title, uint256 price);
    event ItemPurchased(uint256 indexed itemId, address indexed buyer, address indexed seller, uint256 price);
    event ItemRelisted(uint256 indexed itemId, address indexed seller, uint256 newPrice);
    event ItemDelisted(uint256 indexed itemId, address indexed seller);
    event ReviewSubmitted(address indexed seller, address indexed reviewer, uint256 indexed itemId, uint8 rating);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier itemExists(uint256 _itemId) {
        require(_itemId > 0 && _itemId < nextItemId, "Marketplace: item does not exist");
        _;
    }

    // ---------------------------------------------------------------------
    // Listing
    // ---------------------------------------------------------------------

    /// @notice List a new item for sale.
    function listItem(
        string calldata _title,
        string calldata _description,
        uint256 _price
    ) external returns (uint256 itemId) {
        require(bytes(_title).length > 0, "Marketplace: title required");
        require(_price > 0, "Marketplace: price must be greater than zero");

        itemId = nextItemId++;
        items[itemId] = Item({
            id: itemId,
            seller: payable(msg.sender),
            owner: msg.sender,
            title: _title,
            description: _description,
            price: _price,
            sold: false,
            active: true
        });
        itemIds.push(itemId);

        emit ItemListed(itemId, msg.sender, _title, _price);
    }

    /// @notice Owner can take a listing off the market without selling it.
    function delistItem(uint256 _itemId) external itemExists(_itemId) {
        Item storage item = items[_itemId];
        require(msg.sender == item.owner, "Marketplace: caller is not the owner");
        require(item.active, "Marketplace: item already inactive");

        item.active = false;
        emit ItemDelisted(_itemId, msg.sender);
    }

    /// @notice Current owner relists a previously purchased item for resale,
    ///         transferring "seller" status to themselves at a new price.
    function relistItem(uint256 _itemId, uint256 _newPrice) external itemExists(_itemId) {
        Item storage item = items[_itemId];
        require(msg.sender == item.owner, "Marketplace: caller is not the owner");
        require(_newPrice > 0, "Marketplace: price must be greater than zero");

        item.seller = payable(msg.sender);
        item.price = _newPrice;
        item.sold = false;
        item.active = true;

        emit ItemRelisted(_itemId, msg.sender, _newPrice);
    }

    // ---------------------------------------------------------------------
    // Buying — trustless ETH transfer + ownership transfer
    // ---------------------------------------------------------------------

    /// @notice Buy a listed item by sending exact ETH. Ownership and funds
    ///         move atomically — no escrow, no intermediary.
    function buyItem(uint256 _itemId) external payable itemExists(_itemId) {
        Item storage item = items[_itemId];
        require(item.active, "Marketplace: item not available");
        require(!item.sold, "Marketplace: item already sold");
        require(msg.sender != item.seller, "Marketplace: seller cannot buy own item");
        require(msg.value == item.price, "Marketplace: incorrect ETH amount sent");

        address payable seller = item.seller;

        item.sold = true;
        item.active = false;
        item.owner = msg.sender;

        purchasedFrom[_itemId][msg.sender] = seller;

        // Effects are applied before the external call (checks-effects-interactions).
        (bool sent, ) = seller.call{value: msg.value}("");
        require(sent, "Marketplace: ETH transfer to seller failed");

        emit ItemPurchased(_itemId, msg.sender, seller, item.price);
    }

    // ---------------------------------------------------------------------
    // Reviews & ratings — enforced on-chain, tied to verified purchases
    // ---------------------------------------------------------------------

    /// @notice Leave a 1-5 star review for the seller of an item you actually
    ///         bought. Reverts for anyone who never purchased that listing,
    ///         and a given purchase can only be reviewed once.
    function leaveReview(uint256 _itemId, uint8 _rating, string calldata _comment) external itemExists(_itemId) {
        address seller = purchasedFrom[_itemId][msg.sender];
        require(seller != address(0), "Marketplace: only verified buyers can review");
        require(!hasReviewed[_itemId][msg.sender], "Marketplace: purchase already reviewed");
        require(_rating >= 1 && _rating <= 5, "Marketplace: rating must be between 1 and 5");

        hasReviewed[_itemId][msg.sender] = true;

        sellerReviews[seller].push(Review({
            reviewer: msg.sender,
            itemId: _itemId,
            rating: _rating,
            comment: _comment,
            timestamp: block.timestamp
        }));
        ratingSum[seller] += _rating;

        emit ReviewSubmitted(seller, msg.sender, _itemId, _rating);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getItem(uint256 _itemId) external view itemExists(_itemId) returns (Item memory) {
        return items[_itemId];
    }

    function getAllItemIds() external view returns (uint256[] memory) {
        return itemIds;
    }

    function getTotalItems() external view returns (uint256) {
        return itemIds.length;
    }

    function getSellerReviews(address _seller) external view returns (Review[] memory) {
        return sellerReviews[_seller];
    }

    /// @notice Average rating scaled by 100 (e.g. 437 == 4.37 stars) to avoid
    ///         floating point, plus the raw review count.
    function getSellerRating(address _seller) external view returns (uint256 averageScaledBy100, uint256 reviewCount) {
        reviewCount = sellerReviews[_seller].length;
        if (reviewCount == 0) {
            return (0, 0);
        }
        averageScaledBy100 = (ratingSum[_seller] * 100) / reviewCount;
    }

    function canReview(uint256 _itemId, address _buyer) external view returns (bool) {
        return purchasedFrom[_itemId][_buyer] != address(0) && !hasReviewed[_itemId][_buyer];
    }
}
