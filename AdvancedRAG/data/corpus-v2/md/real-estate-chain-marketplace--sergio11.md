# real-estate-chain-marketplace--sergio11

- domain: nft-marketplace (nft-marketplace)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/sergio11/realestatechain_blockchain @ 765e01cd88ae35c6f205022fb902f30261236fbd
- license: MIT
- targets: RealEstateChainMarketplace.sol, IRealEstateChain.sol, IRealEstateChainMarketplace.sol, RealEstateChain.sol
- validation: 6 passing tests, 0 failing; statement coverage RealEstateChainMarketplace.sol 95.0 %, IRealEstateChain.sol 100.0 %, IRealEstateChainMarketplace.sol 100.0 %, RealEstateChain.sol 37.5 %

## Contract: IRealEstateChain.sol (dependency)

```solidity
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
```

## Contract: IRealEstateChainMarketplace.sol (dependency)

```solidity
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
```

## Contract: RealEstateChain.sol (dependency)

```solidity
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
```

## Contract: RealEstateChainMarketplace.sol (primary target)

```solidity
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
```

## Tests: RealEstateChain.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RealEstateChain and Marketplace", function () {
    
    async function deployFixture() {
        const [owner, seller, buyer, other] = await ethers.getSigners();
      
        const RealEstateChain = await ethers.getContractFactory("RealEstateChain");
        const realEstateChain = await RealEstateChain.deploy(owner);
      
        const Marketplace = await ethers.getContractFactory("RealEstateChainMarketplace");
        const marketplace = await Marketplace.deploy(owner, realEstateChain);
      
        return { owner, seller, buyer, other, realEstateChain, marketplace };
    }

    it("Should set the right owner", async function () {
        const { realEstateChain, owner, marketplace } = await deployFixture();
        expect(await realEstateChain.owner()).to.equal(owner.address);
        expect(await marketplace.owner()).to.equal(owner.address);
    });
    
    it("Should mint a property and assign it to the seller", async () => {
        const { realEstateChain, seller, owner } = await deployFixture();
        const tokenURI = "ipfs://example123";
    
        const tx = await realEstateChain.connect(owner).mintProperty(seller.address, tokenURI);
        await tx.wait();
    
        const balance = await realEstateChain.balanceOf(seller.address);
        const tokenId = 1;
    
        expect(await realEstateChain.ownerOf(tokenId)).to.equal(seller.address);
        expect(await realEstateChain.tokenURI(tokenId)).to.equal(tokenURI);
    });

    it("Should list a property on the marketplace", async () => {
        const { marketplace, realEstateChain, seller, owner } = await deployFixture();
        const tokenURI = "ipfs://example123";
        
        const tx = await realEstateChain.connect(owner).mintProperty(seller.address, tokenURI);
        await tx.wait();
        const tokenId = 1;
        
        const price = ethers.parseEther("1");

        await realEstateChain.connect(seller).approve(marketplace, tokenId);

        // Seller lists the property for sale
        await expect(marketplace.connect(seller).listProperty(tokenId, price))
            .to.emit(marketplace, 'PropertyListed')
            .withArgs(seller.address, tokenId, price);

        const listing = await marketplace.listings(tokenId);
        expect(listing.seller).to.equal(seller.address);
        expect(listing.price.toString()).to.equal(price.toString());
    });

    it("Should allow the buyer to purchase a property", async () => {
        const { marketplace, realEstateChain, seller, buyer, owner } = await deployFixture();
        const tokenURI = "ipfs://example123";
        
        const tx = await realEstateChain.connect(owner).mintProperty(seller.address, tokenURI);
        await tx.wait();
        const tokenId = 1;

        const price = ethers.parseEther("1");

        await realEstateChain.connect(seller).approve(marketplace, tokenId);
        await marketplace.connect(seller).listProperty(tokenId, price);

        // Buyer purchases the property
        await expect(marketplace.connect(buyer).buyProperty(tokenId, { value: price }))
            .to.emit(marketplace, 'PropertySold')
            .withArgs(buyer.address, tokenId, price);

        // Verify ownership has transferred
        expect(await realEstateChain.ownerOf(tokenId)).to.equal(buyer.address);
    });

    it("Should allow the seller to cancel the listing", async () => {
        const { marketplace, realEstateChain, seller, owner } = await deployFixture();
        const tokenURI = "ipfs://example123";
        
        const tx = await realEstateChain.connect(owner).mintProperty(seller.address, tokenURI);
        await tx.wait();
        const tokenId = 1;

        const price = ethers.parseEther("1");

        await realEstateChain.connect(seller).approve(marketplace, tokenId);
        await marketplace.connect(seller).listProperty(tokenId, price);

        // Seller cancels the listing
        await expect(marketplace.connect(seller).cancelListing(tokenId))
            .to.emit(marketplace, 'PropertyUnlisted')
            .withArgs(tokenId);

        const listing = await marketplace.listings(tokenId);
        expect(listing.seller).to.equal('0x0000000000000000000000000000000000000000');
        expect(listing.price.toString()).to.equal("0");
    });

    // Test for property transfer
    it("Should allow a property to be transferred", async () => {
        const { realEstateChain, seller, buyer, owner } = await deployFixture();
        const tokenURI = "ipfs://example123";
        
        const tx = await realEstateChain.connect(owner).mintProperty(seller.address, tokenURI);
        await tx.wait();
        const tokenId = 1;

        // Transfer property to buyer
        await expect(realEstateChain.connect(seller).transferFrom(seller.address, buyer.address, tokenId))
            .to.emit(realEstateChain, 'Transfer')
            .withArgs(seller.address, buyer.address, tokenId);

        expect(await realEstateChain.ownerOf(tokenId)).to.equal(buyer.address);
    });
});
```
