# marketplace--ozgurkutlu0

- domain: nft-marketplace (nft-marketplace)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ozgurkutlu0/nftforge @ 2c8f4cb1498a0c4e96d5dbb2de2fcfd7e839ffe7
- license: MIT
- targets: Marketplace.sol, NFTForge.sol
- validation: 12 passing tests, 0 failing; statement coverage Marketplace.sol 100.0 %, NFTForge.sol 75.0 %

## Contract: Marketplace.sol (primary target)

```solidity
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
```

## Contract: NFTForge.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @title NFTForge — open ERC-721 minter
/// @notice Anyone can mint a token by providing a metadata URI (typically `ipfs://<cid>`).
contract NFTForge is ERC721URIStorage {
    uint256 private _nextTokenId;

    event Minted(address indexed to, uint256 indexed tokenId, string tokenURI);

    constructor() ERC721("NFTForge", "FORGE") {}

    /// @notice Mint a new NFT to `to` with metadata at `tokenURI_`.
    /// @dev Returns the new token ID.
    function mint(address to, string calldata tokenURI_) external returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI_);
        emit Minted(to, tokenId, tokenURI_);
    }

    /// @notice Total number of tokens minted (next id == this value).
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }
}
```

## Tests: Marketplace.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Marketplace", function () {
  let nft, market;
  let seller, buyer, stranger;
  const PRICE = ethers.parseEther("1");

  beforeEach(async function () {
    [seller, buyer, stranger] = await ethers.getSigners();

    const NFTForge = await ethers.getContractFactory("NFTForge");
    nft = await NFTForge.deploy();
    await nft.waitForDeployment();

    const Marketplace = await ethers.getContractFactory("Marketplace");
    market = await Marketplace.deploy();
    await market.waitForDeployment();

    await nft.mint(seller.address, "ipfs://item-0");
  });

  async function approveAndList() {
    await nft.connect(seller).approve(await market.getAddress(), 0);
    await market.connect(seller).list(await nft.getAddress(), 0, PRICE);
  }

  describe("list", function () {
    it("stores the listing and emits Listed", async function () {
      await nft.connect(seller).approve(await market.getAddress(), 0);
      await expect(market.connect(seller).list(await nft.getAddress(), 0, PRICE))
        .to.emit(market, "Listed")
        .withArgs(await nft.getAddress(), 0, seller.address, PRICE);

      const l = await market.getListing(await nft.getAddress(), 0);
      expect(l.seller).to.equal(seller.address);
      expect(l.price).to.equal(PRICE);
      expect(l.active).to.equal(true);
    });

    it("reverts when caller is not the owner", async function () {
      await nft.connect(seller).approve(await market.getAddress(), 0);
      await expect(
        market.connect(stranger).list(await nft.getAddress(), 0, PRICE)
      ).to.be.revertedWithCustomError(market, "NotOwner");
    });

    it("reverts when marketplace is not approved", async function () {
      await expect(
        market.connect(seller).list(await nft.getAddress(), 0, PRICE)
      ).to.be.revertedWithCustomError(market, "NotApproved");
    });

    it("reverts on zero price", async function () {
      await nft.connect(seller).approve(await market.getAddress(), 0);
      await expect(
        market.connect(seller).list(await nft.getAddress(), 0, 0)
      ).to.be.revertedWithCustomError(market, "PriceZero");
    });

    it("accepts setApprovalForAll instead of single-token approval", async function () {
      await nft.connect(seller).setApprovalForAll(await market.getAddress(), true);
      await expect(market.connect(seller).list(await nft.getAddress(), 0, PRICE)).to.emit(
        market,
        "Listed"
      );
    });
  });

  describe("cancel", function () {
    it("clears the listing and emits Cancelled", async function () {
      await approveAndList();
      await expect(market.connect(seller).cancel(await nft.getAddress(), 0))
        .to.emit(market, "Cancelled")
        .withArgs(await nft.getAddress(), 0, seller.address);

      const l = await market.getListing(await nft.getAddress(), 0);
      expect(l.active).to.equal(false);
    });

    it("reverts when not listed", async function () {
      await expect(
        market.connect(seller).cancel(await nft.getAddress(), 0)
      ).to.be.revertedWithCustomError(market, "NotListed");
    });

    it("reverts when caller is not the seller", async function () {
      await approveAndList();
      await expect(
        market.connect(stranger).cancel(await nft.getAddress(), 0)
      ).to.be.revertedWithCustomError(market, "NotSeller");
    });
  });

  describe("buy", function () {
    it("transfers NFT, pays seller, clears listing, emits Bought", async function () {
      await approveAndList();

      const sellerBalBefore = await ethers.provider.getBalance(seller.address);

      await expect(
        market.connect(buyer).buy(await nft.getAddress(), 0, { value: PRICE })
      )
        .to.emit(market, "Bought")
        .withArgs(await nft.getAddress(), 0, buyer.address, seller.address, PRICE);

      expect(await nft.ownerOf(0)).to.equal(buyer.address);

      const sellerBalAfter = await ethers.provider.getBalance(seller.address);
      expect(sellerBalAfter - sellerBalBefore).to.equal(PRICE);

      const l = await market.getListing(await nft.getAddress(), 0);
      expect(l.active).to.equal(false);
    });

    it("reverts on wrong price", async function () {
      await approveAndList();
      await expect(
        market.connect(buyer).buy(await nft.getAddress(), 0, { value: PRICE - 1n })
      ).to.be.revertedWithCustomError(market, "WrongPrice");
    });

    it("reverts when not listed", async function () {
      await expect(
        market.connect(buyer).buy(await nft.getAddress(), 0, { value: PRICE })
      ).to.be.revertedWithCustomError(market, "NotListed");
    });

    it("cannot be bought twice", async function () {
      await approveAndList();
      await market.connect(buyer).buy(await nft.getAddress(), 0, { value: PRICE });
      await expect(
        market.connect(stranger).buy(await nft.getAddress(), 0, { value: PRICE })
      ).to.be.revertedWithCustomError(market, "NotListed");
    });
  });
});
```
