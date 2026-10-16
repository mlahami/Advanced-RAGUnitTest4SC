# marketplace--tejashree-likhar

- domain: nft-marketplace (marketplace)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Tejashree-Likhar/Decentralised-marketplace @ e8f158588fc062ca86907a9ccb29fa799a1e6cec
- license: MIT
- targets: Marketplace.sol
- validation: 12 passing tests, 0 failing; statement coverage Marketplace.sol 94.29 %

## Contract: Marketplace.sol (primary target)

```solidity
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
```

## Tests: Marketplace.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Marketplace", function () {
  let marketplace, seller, buyer, other;

  beforeEach(async function () {
    [seller, buyer, other] = await ethers.getSigners();
    const Marketplace = await ethers.getContractFactory("Marketplace");
    marketplace = await Marketplace.deploy();
    await marketplace.waitForDeployment();
  });

  it("lists an item with correct details", async function () {
    await expect(marketplace.connect(seller).listItem("Bike", "Mountain bike, lightly used", ethers.parseEther("1")))
      .to.emit(marketplace, "ItemListed")
      .withArgs(1n, seller.address, "Bike", ethers.parseEther("1"));

    const item = await marketplace.getItem(1);
    expect(item.title).to.equal("Bike");
    expect(item.seller).to.equal(seller.address);
    expect(item.owner).to.equal(seller.address);
    expect(item.price).to.equal(ethers.parseEther("1"));
    expect(item.active).to.equal(true);
    expect(item.sold).to.equal(false);
  });

  it("rejects listing with zero price or empty title", async function () {
    await expect(marketplace.listItem("Bike", "desc", 0)).to.be.revertedWith(
      "Marketplace: price must be greater than zero"
    );
    await expect(marketplace.listItem("", "desc", 100)).to.be.revertedWith("Marketplace: title required");
  });

  it("lets a buyer purchase an item with exact ETH and transfers ownership + funds", async function () {
    const price = ethers.parseEther("2");
    await marketplace.connect(seller).listItem("Laptop", "16GB RAM", price);

    const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

    await expect(marketplace.connect(buyer).buyItem(1, { value: price }))
      .to.emit(marketplace, "ItemPurchased")
      .withArgs(1n, buyer.address, seller.address, price);

    const item = await marketplace.getItem(1);
    expect(item.owner).to.equal(buyer.address);
    expect(item.sold).to.equal(true);
    expect(item.active).to.equal(false);

    const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
    expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(price);
  });

  it("rejects purchase with incorrect ETH amount", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Phone", "desc", price);
    await expect(
      marketplace.connect(buyer).buyItem(1, { value: ethers.parseEther("0.5") })
    ).to.be.revertedWith("Marketplace: incorrect ETH amount sent");
  });

  it("prevents the seller from buying their own item", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Phone", "desc", price);
    await expect(
      marketplace.connect(seller).buyItem(1, { value: price })
    ).to.be.revertedWith("Marketplace: seller cannot buy own item");
  });

  it("prevents double purchase of the same item", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Phone", "desc", price);
    await marketplace.connect(buyer).buyItem(1, { value: price });
    await expect(
      marketplace.connect(other).buyItem(1, { value: price })
    ).to.be.revertedWith("Marketplace: item not available");
  });

  it("allows only verified buyers to leave a review, once each", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Phone", "desc", price);

    // Non-buyer cannot review
    await expect(
      marketplace.connect(other).leaveReview(1, 5, "Great seller!")
    ).to.be.revertedWith("Marketplace: only verified buyers can review");

    await marketplace.connect(buyer).buyItem(1, { value: price });

    await expect(marketplace.connect(buyer).leaveReview(1, 5, "Great seller!"))
      .to.emit(marketplace, "ReviewSubmitted")
      .withArgs(seller.address, buyer.address, 1n, 5);

    // Can't review the same purchase twice
    await expect(
      marketplace.connect(buyer).leaveReview(1, 4, "Trying again")
    ).to.be.revertedWith("Marketplace: purchase already reviewed");

    const [avg, count] = await marketplace.getSellerRating(seller.address);
    expect(count).to.equal(1n);
    expect(avg).to.equal(500n); // 5.00 stars scaled by 100
  });

  it("rejects out-of-range ratings", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Phone", "desc", price);
    await marketplace.connect(buyer).buyItem(1, { value: price });
    await expect(marketplace.connect(buyer).leaveReview(1, 0, "bad")).to.be.revertedWith(
      "Marketplace: rating must be between 1 and 5"
    );
    await expect(marketplace.connect(buyer).leaveReview(1, 6, "bad")).to.be.revertedWith(
      "Marketplace: rating must be between 1 and 5"
    );
  });

  it("computes correct average rating across multiple reviews", async function () {
    const price = ethers.parseEther("1");

    await marketplace.connect(seller).listItem("Item A", "desc", price);
    await marketplace.connect(buyer).buyItem(1, { value: price });
    await marketplace.connect(buyer).leaveReview(1, 5, "Excellent");

    await marketplace.connect(seller).listItem("Item B", "desc", price);
    await marketplace.connect(other).buyItem(2, { value: price });
    await marketplace.connect(other).leaveReview(2, 3, "It was okay");

    const [avg, count] = await marketplace.getSellerRating(seller.address);
    expect(count).to.equal(2n);
    expect(avg).to.equal(400n); // (5+3)/2 = 4.00 -> 400
  });

  it("supports relisting by the new owner and tracks seller correctly for reviews", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Guitar", "Acoustic", price);
    await marketplace.connect(buyer).buyItem(1, { value: price });

    // Buyer is now owner and relists at a new price
    const newPrice = ethers.parseEther("1.5");
    await expect(marketplace.connect(buyer).relistItem(1, newPrice))
      .to.emit(marketplace, "ItemRelisted")
      .withArgs(1n, buyer.address, newPrice);

    const item = await marketplace.getItem(1);
    expect(item.seller).to.equal(buyer.address);
    expect(item.active).to.equal(true);
    expect(item.sold).to.equal(false);

    // `other` buys from the new seller (buyer)
    await marketplace.connect(other).buyItem(1, { value: newPrice });
    await marketplace.connect(other).leaveReview(1, 4, "Good second-hand seller too");

    const [origSellerAvg, origSellerCount] = await marketplace.getSellerRating(seller.address);
    const [newSellerAvg, newSellerCount] = await marketplace.getSellerRating(buyer.address);

    expect(origSellerCount).to.equal(0n); // original seller never got reviewed here
    expect(newSellerCount).to.equal(1n);
    expect(newSellerAvg).to.equal(400n);
  });

  it("lets the owner delist an active item", async function () {
    await marketplace.connect(seller).listItem("Desk", "desc", ethers.parseEther("1"));
    await expect(marketplace.connect(seller).delistItem(1))
      .to.emit(marketplace, "ItemDelisted")
      .withArgs(1n, seller.address);

    const item = await marketplace.getItem(1);
    expect(item.active).to.equal(false);

    await expect(
      marketplace.connect(buyer).buyItem(1, { value: ethers.parseEther("1") })
    ).to.be.revertedWith("Marketplace: item not available");
  });

  it("tracks all listed item ids", async function () {
    await marketplace.connect(seller).listItem("A", "d", ethers.parseEther("1"));
    await marketplace.connect(seller).listItem("B", "d", ethers.parseEther("1"));
    const ids = await marketplace.getAllItemIds();
    expect(ids.map((i) => i.toString())).to.deep.equal(["1", "2"]);
    expect(await marketplace.getTotalItems()).to.equal(2n);
  });
});
```
