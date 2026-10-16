# market-nft--paul-abhirup

- domain: ticketing-events (ticketing-marketplace)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/paul-abhirup/Event-Ticketing-System @ 9c2072176d09b7bf10080b56b2a91ac35e404381
- license: MIT
- targets: MarketNFT.sol, TicketNFT.sol
- validation: 7 passing tests, 0 failing; statement coverage MarketNFT.sol 95.83 %, TicketNFT.sol 50.0 %

## Contract: MarketNFT.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Marketplace is ReentrancyGuard {
    struct Listing {
        uint256 price;
        address seller;
    }

    struct Bid {
        address bidder;
        uint256 amount;
    }

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Bid) public highestBids;
    uint256 public maxResalePrice;
    address public organizer;
    uint256 public royaltyPercentage;
    IERC721 public ticketNFT;

    constructor(
        address _ticketNFT,
        uint256 _maxResalePrice,
        uint256 _royaltyPercentage
    ) {
        require(_ticketNFT != address(0), "Invalid ticket NFT address");
        ticketNFT = IERC721(_ticketNFT);
        maxResalePrice = _maxResalePrice;
        royaltyPercentage = _royaltyPercentage;
        organizer = msg.sender;
    }

    function listTicket(uint256 tokenId, uint256 price) external {
        require(price <= maxResalePrice, "Price exceeds maximum allowed");
        require(ticketNFT.ownerOf(tokenId) == msg.sender, "You do not own this ticket");

        ticketNFT.transferFrom(msg.sender, address(this), tokenId);
        listings[tokenId] = Listing(price, msg.sender);
    }

    function buyTicket(uint256 tokenId) external payable nonReentrant {
        Listing memory listing = listings[tokenId];
        require(msg.value >= listing.price, "Insufficient funds");

        uint256 royalty = (listing.price * royaltyPercentage) / 100;
        uint256 sellerProceeds = listing.price - royalty;

        payable(listing.seller).transfer(sellerProceeds);
        payable(organizer).transfer(royalty);

        ticketNFT.transferFrom(address(this), msg.sender, tokenId);
        delete listings[tokenId];
    }

    function cancelListing(uint256 tokenId) external {
        require(listings[tokenId].seller == msg.sender, "You are not the seller");
        ticketNFT.transferFrom(address(this), msg.sender, tokenId);
        delete listings[tokenId];
    }

    function placeBid(uint256 tokenId) external payable {
        require(msg.value > highestBids[tokenId].amount, "Bid too low");
        if (highestBids[tokenId].amount > 0) {
            payable(highestBids[tokenId].bidder).transfer(highestBids[tokenId].amount);
        }
        highestBids[tokenId] = Bid(msg.sender, msg.value);
    }

    function acceptBid(uint256 tokenId) external nonReentrant {
        require(listings[tokenId].seller == msg.sender, "You are not the seller");
        Bid memory winningBid = highestBids[tokenId];
        require(winningBid.amount > 0, "No bids placed");

        uint256 royalty = (winningBid.amount * royaltyPercentage) / 100;
        uint256 sellerProceeds = winningBid.amount - royalty;

        payable(msg.sender).transfer(sellerProceeds);
        payable(organizer).transfer(royalty);

        ticketNFT.transferFrom(address(this), winningBid.bidder, tokenId);
        delete highestBids[tokenId];
        delete listings[tokenId];
    }
}
```

## Contract: TicketNFT.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TicketNFT is ERC721, Ownable {
    uint256 public nextTokenId;
    string public baseURI; // State variable
    mapping(address => uint256) public ticketsPerWallet;
    uint256 public maxTicketsPerWallet;
    mapping(uint256 => bool) private _isUsed;

    constructor(
        string memory _name, // Token name
        string memory _symbol, // Token symbol
        string memory _uri, // Renamed parameter (was _baseURI)
        uint256 _maxTicketsPerWallet, // Maximum tickets per wallet
        address _initialOwner // Initial owner address
    ) ERC721(_name, _symbol) Ownable(_initialOwner) {
        baseURI = _uri; // Assign the parameter to the state variable
        maxTicketsPerWallet = _maxTicketsPerWallet;
    }

    function mint(address to) external onlyOwner {
        require(ticketsPerWallet[to] < maxTicketsPerWallet, "Max tickets per wallet reached");
        _safeMint(to, nextTokenId);
        nextTokenId++;
        ticketsPerWallet[to]++;
    }

    function setBaseURI(string memory _newBaseURI) external onlyOwner {
        baseURI = _newBaseURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }

    function isUsed(uint256 tokenId) public view returns (bool) {
    // Logic to check if the ticket is used
    return _isUsed[tokenId];
}
}
```

## Tests: Marketplace.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ZeroAddress } = ethers;

describe("Marketplace", function () {
  let TicketNFT, ticketNFT, Marketplace, marketplace, owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    TicketNFT = await ethers.getContractFactory("TicketNFT");
    Marketplace = await ethers.getContractFactory("Marketplace");

    ticketNFT = await TicketNFT.deploy(
      "EventTicket", // Token name
      "TKT", // Token symbol
      "https://example.com/", // Base URI
      5, // Maximum tickets per wallet
      owner.address // Initial owner address
    );
    await ticketNFT.waitForDeployment();

    // Correctly retrieve the deployed contract address
    const ticketNFTAddress = await ticketNFT.getAddress();

    marketplace = await Marketplace.deploy(
      ticketNFTAddress, // Use the retrieved address
      ethers.parseEther("1.0"), // Maximum resale price (1 ETH)
      10 // Royalty percentage (10%)
    );
    await marketplace.waitForDeployment(); // Ensure deployment is complete

    // Get marketplace address for approval
    const marketplaceAddress = await marketplace.getAddress();

    // Set approval for marketplace to handle NFTs
    await ticketNFT.connect(addr1).setApprovalForAll(marketplaceAddress, true);
  });

  it("should allow seller to list a ticket", async function () {
    await ticketNFT.mint(addr1.address);
    const marketplaceAddress = await marketplace.getAddress();
    await ticketNFT.connect(addr1).approve(marketplaceAddress, 0);
    await marketplace.connect(addr1).listTicket(0, ethers.parseEther("0.5"));

    const listing = await marketplace.listings(0);
    expect(listing.price).to.equal(ethers.parseEther("0.5"));
    expect(listing.seller).to.equal(addr1.address);
  });

  it("should not allow listing above max resale price", async function () {
    await ticketNFT.mint(addr1.address);
    const marketplaceAddress = await marketplace.getAddress();
    await ticketNFT.connect(addr1).approve(marketplaceAddress, 0);
    await expect(
      marketplace.connect(addr1).listTicket(0, ethers.parseEther("1.5"))
    ).to.be.revertedWith("Price exceeds maximum allowed");
  });

  it("should allow buyer to purchase a listed ticket", async function () {
    await ticketNFT.mint(addr1.address);
    const marketplaceAddress = await marketplace.getAddress();
    await ticketNFT.connect(addr1).approve(marketplaceAddress, 0);
    await marketplace.connect(addr1).listTicket(0, ethers.parseEther("0.5"));

    await expect(() =>
      marketplace
        .connect(addr2)
        .buyTicket(0, { value: ethers.parseEther("0.5") })
    ).to.changeEtherBalances(
      [addr1, addr2, owner],
      [
        ethers.parseEther("0.45"),
        ethers.parseEther("-0.5"),
        ethers.parseEther("0.05"),
      ]
    );

    expect(await ticketNFT.ownerOf(0)).to.equal(addr2.address);
  });

  it("should enforce correct royalty payments on purchase", async function () {
    await ticketNFT.mint(addr1.address);
    const marketplaceAddress = await marketplace.getAddress();
    await ticketNFT.connect(addr1).approve(marketplaceAddress, 0);
    await marketplace.connect(addr1).listTicket(0, ethers.parseEther("0.5"));

    await expect(() =>
      marketplace
        .connect(addr2)
        .buyTicket(0, { value: ethers.parseEther("0.5") })
    ).to.changeEtherBalances(
      [addr1, addr2, owner],
      [
        ethers.parseEther("0.45"),
        ethers.parseEther("-0.5"),
        ethers.parseEther("0.05"),
      ]
    );
  });

  it("should allow seller to cancel a listing", async function () {
    await ticketNFT.mint(addr1.address);
    const marketplaceAddress = await marketplace.getAddress();
    await ticketNFT.connect(addr1).approve(marketplaceAddress, 0);
    await marketplace.connect(addr1).listTicket(0, ethers.parseEther("0.5"));

    await marketplace.connect(addr1).cancelListing(0);

    const listing = await marketplace.listings(0);
    expect(listing.price).to.equal(0);
    expect(listing.seller).to.equal(ZeroAddress);
  });

  it("should allow users to place bids and store the highest bid", async function () {
    await ticketNFT.mint(addr1.address);
    const marketplaceAddress = await marketplace.getAddress();
    await ticketNFT.connect(addr1).approve(marketplaceAddress, 0);
    await marketplace.connect(addr1).listTicket(0, ethers.parseEther("0.5"));

    await marketplace
      .connect(addr2)
      .placeBid(0, { value: ethers.parseEther("0.6") });

    const highestBid = await marketplace.highestBids(0);
    expect(highestBid.bidder).to.equal(addr2.address);
    expect(highestBid.amount).to.equal(ethers.parseEther("0.6"));
  });

  it("should allow seller to accept the highest bid", async function () {
    await ticketNFT.mint(addr1.address);
    const marketplaceAddress = await marketplace.getAddress();
    await ticketNFT.connect(addr1).approve(marketplaceAddress, 0);
    await marketplace.connect(addr1).listTicket(0, ethers.parseEther("0.5"));

    // Place bid
    await marketplace
      .connect(addr2)
      .placeBid(0, { value: ethers.parseEther("0.6") });

    // Accept bid and verify balance changes
    await expect(() =>
      marketplace.connect(addr1).acceptBid(0)
    ).to.changeEtherBalances(
      [addr1, owner],
      [
        ethers.parseEther("0.54"), // 90% of 0.6 ETH
        ethers.parseEther("0.06"), // 10% of 0.6 ETH
      ]
    );

    // Verify NFT ownership
    expect(await ticketNFT.ownerOf(0)).to.equal(addr2.address);
  });
});
```
