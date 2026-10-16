# nftmarketplace--donguillotine

- domain: nft-marketplace (nft-marketplace)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/DonGuillotine/nft_marketplace_contract @ 59bce47fc2a9a8191e170ee9e9161894a2d631cd
- license: MIT
- targets: NFTMarketplace.sol
- validation: 19 passing tests, 0 failing; statement coverage NFTMarketplace.sol 91.89 %

## Contract: NFTMarketplace.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract NFTMarketplace is ERC721URIStorage, ERC2981, AccessControl, ReentrancyGuard {
    uint256 private _tokenIds;
    uint256 private _listingIds;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant LISTING_FEE = 0.01 ether;
    uint256 public constant MARKETPLACE_FEE = 250;

    address public marketplaceWallet;

    struct Listing {
        uint256 tokenId;
        address payable seller;
        uint256 price;
        bool active;
    }

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => address) public tokenCreators;

    event NFTMinted(uint256 tokenId, address owner, string tokenURI, uint96 royaltyFee);
    event NFTListed(uint256 listingId, uint256 tokenId, uint256 price, address seller);
    event NFTSold(uint256 listingId, uint256 tokenId, uint256 price, address seller, address buyer);
    event ListingCancelled(uint256 listingId);
    event RoyaltyPaid(uint256 tokenId, address creator, uint256 royaltyAmount);
    event MarketplaceFeePaid(uint256 amount);

    constructor() ERC721("NFTMarketplace", "NFTM") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        marketplaceWallet = msg.sender; 
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721URIStorage, ERC2981, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function mintNFT(address recipient, string memory tokenURI, uint96 royaltyFee) public onlyRole(MINTER_ROLE) returns (uint256) {
        _tokenIds += 1;
        uint256 newTokenId = _tokenIds;

        _safeMint(recipient, newTokenId);
        _setTokenURI(newTokenId, tokenURI);
        _setTokenRoyalty(newTokenId, recipient, royaltyFee);
        tokenCreators[newTokenId] = recipient;

        emit NFTMinted(newTokenId, recipient, tokenURI, royaltyFee);

        return newTokenId;
    }

    function listNFT(uint256 tokenId, uint256 price) public payable {
        require(ownerOf(tokenId) == msg.sender, "You must own the NFT to list it");
        require(msg.value == LISTING_FEE, "Listing fee required");
        require(price > 0, "Price must be greater than zero");

        _listingIds += 1;
        uint256 listingId = _listingIds;

        listings[listingId] = Listing({
            tokenId: tokenId,
            seller: payable(msg.sender),
            price: price,
            active: true
        });

        emit NFTListed(listingId, tokenId, price, msg.sender);
    }

    function buyNFT(uint256 listingId) public payable nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing is not active");
        require(msg.value == listing.price, "Incorrect price");

        listing.active = false;

        uint256 royaltyAmount = 0;
        address creator = tokenCreators[listing.tokenId];
        if (creator != address(0)) {
            (address receiver, uint256 royaltyFee) = royaltyInfo(listing.tokenId, listing.price);
            royaltyAmount = royaltyFee;
            payable(receiver).transfer(royaltyAmount);
            emit RoyaltyPaid(listing.tokenId, receiver, royaltyAmount);
        }

        uint256 marketplaceFee = (listing.price * MARKETPLACE_FEE) / 10000;
        payable(marketplaceWallet).transfer(marketplaceFee);
        emit MarketplaceFeePaid(marketplaceFee);

        uint256 sellerProceeds = listing.price - royaltyAmount - marketplaceFee;
        listing.seller.transfer(sellerProceeds);

        _transfer(listing.seller, msg.sender, listing.tokenId);

        emit NFTSold(listingId, listing.tokenId, listing.price, listing.seller, msg.sender);
    }

    function cancelListing(uint256 listingId) public {
        Listing storage listing = listings[listingId];
        require(listing.seller == msg.sender, "Only the seller can cancel the listing");
        require(listing.active, "Listing is not active");

        listing.active = false;

        emit ListingCancelled(listingId);
    }

    function setMarketplaceWallet(address newWallet) public onlyRole(DEFAULT_ADMIN_ROLE) {
        marketplaceWallet = newWallet;
    }

    function getListingDetails(uint256 listingId) public view returns (Listing memory) {
        return listings[listingId];
    }

    function withdraw() public onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        payable(msg.sender).transfer(balance);
    }
}
```

## Tests: NFTMarketplace.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTMarketplace", function () {
  let NFTMarketplace, nftMarketplace, owner, addr1, addr2, addr3;
  let listingFee, marketplaceFee;

  beforeEach(async function () {
    NFTMarketplace = await ethers.getContractFactory("NFTMarketplace");
    [owner, addr1, addr2, addr3] = await ethers.getSigners();
    nftMarketplace = await NFTMarketplace.deploy();
    await nftMarketplace.waitForDeployment();

    listingFee = await nftMarketplace.LISTING_FEE();
    marketplaceFee = await nftMarketplace.MARKETPLACE_FEE();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await nftMarketplace.hasRole(await nftMarketplace.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
    });

    it("Should grant the MINTER_ROLE to the owner", async function () {
      expect(await nftMarketplace.hasRole(await nftMarketplace.MINTER_ROLE(), owner.address)).to.be.true;
    });
  });

  describe("Minting", function () {
    it("Should allow minting by accounts with MINTER_ROLE", async function () {
      await nftMarketplace.mintNFT(addr1.address, "ipfs://tokenURI", 250);
      expect(await nftMarketplace.ownerOf(1)).to.equal(addr1.address);
    });

    it("Should not allow minting by accounts without MINTER_ROLE", async function () {
        await expect(nftMarketplace.connect(addr1).mintNFT(addr1.address, "ipfs://tokenURI", 250))
          .to.be.revertedWithCustomError(nftMarketplace, "AccessControlUnauthorizedAccount")
          .withArgs(addr1.address, await nftMarketplace.MINTER_ROLE());
      });

    it("Should set correct royalty information", async function () {
      await nftMarketplace.mintNFT(addr1.address, "ipfs://tokenURI", 250);
      const [receiver, royaltyAmount] = await nftMarketplace.royaltyInfo(1, 10000);
      expect(receiver).to.equal(addr1.address);
      expect(royaltyAmount).to.equal(250);
    });
  });

  describe("Listing", function () {
    beforeEach(async function () {
      await nftMarketplace.mintNFT(addr1.address, "ipfs://tokenURI", 250);
    });

    it("Should allow listing by the NFT owner", async function () {
      await nftMarketplace.connect(addr1).listNFT(1, ethers.parseEther("1"), { value: listingFee });
      const listing = await nftMarketplace.getListingDetails(1);
      expect(listing.seller).to.equal(addr1.address);
      expect(listing.price).to.equal(ethers.parseEther("1"));
      expect(listing.active).to.be.true;
    });

    it("Should not allow listing by non-owners", async function () {
      await expect(nftMarketplace.connect(addr2).listNFT(1, ethers.parseEther("1"), { value: listingFee }))
        .to.be.revertedWith("You must own the NFT to list it");
    });

    it("Should require the correct listing fee", async function () {
      await expect(nftMarketplace.connect(addr1).listNFT(1, ethers.parseEther("1"), { value: 0 }))
        .to.be.revertedWith("Listing fee required");
    });

    it("Should not allow listing with zero price", async function () {
      await expect(nftMarketplace.connect(addr1).listNFT(1, 0, { value: listingFee }))
        .to.be.revertedWith("Price must be greater than zero");
    });
  });

  describe("Buying", function () {
    beforeEach(async function () {
      await nftMarketplace.mintNFT(addr1.address, "ipfs://tokenURI", 250);
      await nftMarketplace.connect(addr1).listNFT(1, ethers.parseEther("1"), { value: listingFee });
    });

    it("Should allow buying a listed NFT", async function () {
      await nftMarketplace.connect(addr2).buyNFT(1, { value: ethers.parseEther("1") });
      expect(await nftMarketplace.ownerOf(1)).to.equal(addr2.address);
    });

    it("Should not allow buying an unlisted NFT", async function () {
      await nftMarketplace.connect(addr1).cancelListing(1);
      await expect(nftMarketplace.connect(addr2).buyNFT(1, { value: ethers.parseEther("1") }))
        .to.be.revertedWith("Listing is not active");
    });

    it("Should require the correct price", async function () {
      await expect(nftMarketplace.connect(addr2).buyNFT(1, { value: ethers.parseEther("0.5") }))
        .to.be.revertedWith("Incorrect price");
    });
  });

  describe("Cancelling Listing", function () {
    beforeEach(async function () {
      await nftMarketplace.mintNFT(addr1.address, "ipfs://tokenURI", 250);
      await nftMarketplace.connect(addr1).listNFT(1, ethers.parseEther("1"), { value: listingFee });
    });

    it("Should allow the seller to cancel the listing", async function () {
      await nftMarketplace.connect(addr1).cancelListing(1);
      const listing = await nftMarketplace.getListingDetails(1);
      expect(listing.active).to.be.false;
    });

    it("Should not allow non-sellers to cancel the listing", async function () {
      await expect(nftMarketplace.connect(addr2).cancelListing(1))
        .to.be.revertedWith("Only the seller can cancel the listing");
    });

    it("Should not allow cancelling an inactive listing", async function () {
      await nftMarketplace.connect(addr1).cancelListing(1);
      await expect(nftMarketplace.connect(addr1).cancelListing(1))
        .to.be.revertedWith("Listing is not active");
    });
  });

  describe("Access Control", function () {
    it("Should allow the admin to grant MINTER_ROLE", async function () {
      await nftMarketplace.grantRole(await nftMarketplace.MINTER_ROLE(), addr1.address);
      expect(await nftMarketplace.hasRole(await nftMarketplace.MINTER_ROLE(), addr1.address)).to.be.true;
    });

    it("Should not allow non-admins to grant MINTER_ROLE", async function () {
      await expect(nftMarketplace.connect(addr1).grantRole(await nftMarketplace.MINTER_ROLE(), addr2.address))
        .to.be.reverted;
    });
  });

  describe("Marketplace Wallet", function () {
    it("Should allow the admin to set a new marketplace wallet", async function () {
      await nftMarketplace.setMarketplaceWallet(addr3.address);
      expect(await nftMarketplace.marketplaceWallet()).to.equal(addr3.address);
    });

    it("Should not allow non-admins to set a new marketplace wallet", async function () {
      await expect(nftMarketplace.connect(addr1).setMarketplaceWallet(addr3.address))
        .to.be.reverted;
    });
  });
});
```
