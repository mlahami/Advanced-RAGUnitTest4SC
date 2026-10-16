# meta-tales-nft--anubhavick

- domain: nft-marketplace (nft)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Anubhavick/Meta-Tales @ 5cc46b8f8cfb10388a624c599aaa8ade8087f8d2
- license: MIT
- targets: MetaTalesNFT.sol
- validation: 21 passing tests, 0 failing; statement coverage MetaTalesNFT.sol 96.97 %

## Contract: MetaTalesNFT.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

/**
 * @title MetaTalesNFT
 * @dev ERC721 contract for Meta-Tales literary NFTs with royalty support
 * @author Meta-Tales Team
 */
contract MetaTalesNFT is ERC721, ERC721URIStorage, ERC721Burnable, Ownable, IERC2981 {
    // Token ID counter
    uint256 private _tokenIdCounter;

    // Mapping from token ID to royalty info
    mapping(uint256 => RoyaltyInfo) private _tokenRoyalties;

    // Default royalty info
    RoyaltyInfo private _defaultRoyaltyInfo;

    // Royalty info struct
    struct RoyaltyInfo {
        address recipient;
        uint96 royaltyFraction; // In basis points (1/100 of a percent)
    }

    // Events
    event TokenMinted(
        uint256 indexed tokenId,
        address indexed to,
        string uri,
        address royaltyRecipient,
        uint96 royaltyFraction
    );

    event RoyaltySet(
        uint256 indexed tokenId,
        address indexed recipient,
        uint96 royaltyFraction
    );

    // Maximum royalty fraction (10% = 1000 basis points)
    uint96 public constant MAX_ROYALTY_FRACTION = 1000;

    /**
     * @dev Constructor
     * @param _name Token name
     * @param _symbol Token symbol
     * @param _defaultRoyaltyRecipient Default royalty recipient
     * @param _defaultRoyaltyFraction Default royalty fraction in basis points
     * @param _owner Contract owner
     */
    constructor(
        string memory _name,
        string memory _symbol,
        address _defaultRoyaltyRecipient,
        uint96 _defaultRoyaltyFraction,
        address _owner
    ) ERC721(_name, _symbol) Ownable(_owner) {
        require(_defaultRoyaltyFraction <= MAX_ROYALTY_FRACTION, "Royalty too high");
        _defaultRoyaltyInfo = RoyaltyInfo(_defaultRoyaltyRecipient, _defaultRoyaltyFraction);
    }

    /**
     * @dev Check if a token exists
     * @param tokenId Token ID to check
     * @return bool Whether the token exists
     */
    function exists(uint256 tokenId) public view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    /**
     * @dev Mint a new NFT
     * @param to Address to mint to
     * @param uri Metadata URI for the token
     * @param royaltyRecipient Address to receive royalties
     * @param royaltyFraction Royalty fraction in basis points
     * @return tokenId The ID of the newly minted token
     */
    function mintNFT(
        address to,
        string memory uri,
        address royaltyRecipient,
        uint96 royaltyFraction
    ) public returns (uint256) {
        require(royaltyFraction <= MAX_ROYALTY_FRACTION, "Royalty too high");
        require(royaltyRecipient != address(0), "Invalid royalty recipient");

        _tokenIdCounter++;
        uint256 tokenId = _tokenIdCounter;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        // Set royalty info for this token
        _tokenRoyalties[tokenId] = RoyaltyInfo(royaltyRecipient, royaltyFraction);

        emit TokenMinted(tokenId, to, uri, royaltyRecipient, royaltyFraction);
        emit RoyaltySet(tokenId, royaltyRecipient, royaltyFraction);

        return tokenId;
    }

    /**
     * @dev Mint NFT with default royalty
     * @param to Address to mint to
     * @param uri Metadata URI for the token
     * @return tokenId The ID of the newly minted token
     */
    function mintNFTWithDefaultRoyalty(
        address to,
        string memory uri
    ) public returns (uint256) {
        return mintNFT(to, uri, _defaultRoyaltyInfo.recipient, _defaultRoyaltyInfo.royaltyFraction);
    }

    /**
     * @dev Set royalty info for a specific token (only owner or token owner)
     * @param tokenId Token ID
     * @param recipient Royalty recipient
     * @param royaltyFraction Royalty fraction in basis points
     */
    function setTokenRoyalty(
        uint256 tokenId,
        address recipient,
        uint96 royaltyFraction
    ) public {
        require(exists(tokenId), "Token does not exist");
        require(
            owner() == _msgSender() || ownerOf(tokenId) == _msgSender(),
            "Caller is not owner or token owner"
        );
        require(royaltyFraction <= MAX_ROYALTY_FRACTION, "Royalty too high");
        require(recipient != address(0), "Invalid recipient");

        _tokenRoyalties[tokenId] = RoyaltyInfo(recipient, royaltyFraction);
        emit RoyaltySet(tokenId, recipient, royaltyFraction);
    }

    /**
     * @dev Set default royalty info (only owner)
     * @param recipient Default royalty recipient
     * @param royaltyFraction Default royalty fraction in basis points
     */
    function setDefaultRoyalty(address recipient, uint96 royaltyFraction) public onlyOwner {
        require(royaltyFraction <= MAX_ROYALTY_FRACTION, "Royalty too high");
        require(recipient != address(0), "Invalid recipient");

        _defaultRoyaltyInfo = RoyaltyInfo(recipient, royaltyFraction);
    }

    /**
     * @dev Get total number of tokens minted
     * @return Total supply of tokens
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev Get royalty info for a token (EIP-2981)
     * @param tokenId Token ID
     * @param salePrice Sale price of the token
     * @return receiver Royalty recipient
     * @return royaltyAmount Royalty amount
     */
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        public
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        if (!exists(tokenId)) {
            return (_defaultRoyaltyInfo.recipient, 0);
        }

        RoyaltyInfo memory royalty = _tokenRoyalties[tokenId];
        
        // If no specific royalty set for this token, use default
        if (royalty.recipient == address(0)) {
            royalty = _defaultRoyaltyInfo;
        }

        uint256 royaltyValue = (salePrice * royalty.royaltyFraction) / 10000;
        return (royalty.recipient, royaltyValue);
    }

    /**
     * @dev Get royalty info for a token (custom function)
     * @param tokenId Token ID
     * @return recipient Royalty recipient
     * @return royaltyFraction Royalty fraction in basis points
     */
    function getTokenRoyalty(uint256 tokenId)
        public
        view
        returns (address recipient, uint96 royaltyFraction)
    {
        if (!exists(tokenId)) {
            return (_defaultRoyaltyInfo.recipient, _defaultRoyaltyInfo.royaltyFraction);
        }

        RoyaltyInfo memory royalty = _tokenRoyalties[tokenId];
        
        // If no specific royalty set for this token, use default
        if (royalty.recipient == address(0)) {
            royalty = _defaultRoyaltyInfo;
        }

        return (royalty.recipient, royalty.royaltyFraction);
    }

    /**
     * @dev Get default royalty info
     * @return recipient Default royalty recipient
     * @return royaltyFraction Default royalty fraction in basis points
     */
    function getDefaultRoyalty()
        public
        view
        returns (address recipient, uint96 royaltyFraction)
    {
        return (_defaultRoyaltyInfo.recipient, _defaultRoyaltyInfo.royaltyFraction);
    }

    // Required overrides
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, IERC165)
        returns (bool)
    {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }
}
```

## Tests: MetaTalesNFT.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MetaTalesNFT", function () {
  let metaTalesNFT;
  let owner;
  let creator;
  let buyer;
  let royaltyRecipient;

  const NAME = "Meta-Tales Literary NFTs";
  const SYMBOL = "MTALES";
  const DEFAULT_ROYALTY_FRACTION = 250; // 2.5%
  const TOKEN_URI = "ipfs://QmTestTokenURI123";
  const CUSTOM_ROYALTY_FRACTION = 500; // 5%

  beforeEach(async function () {
    [owner, creator, buyer, royaltyRecipient] = await ethers.getSigners();

    const MetaTalesNFT = await ethers.getContractFactory("MetaTalesNFT");
    metaTalesNFT = await MetaTalesNFT.deploy(
      NAME,
      SYMBOL,
      royaltyRecipient.address,
      DEFAULT_ROYALTY_FRACTION,
      owner.address
    );
    await metaTalesNFT.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right name and symbol", async function () {
      expect(await metaTalesNFT.name()).to.equal(NAME);
      expect(await metaTalesNFT.symbol()).to.equal(SYMBOL);
    });

    it("Should set the right owner", async function () {
      expect(await metaTalesNFT.owner()).to.equal(owner.address);
    });

    it("Should set the default royalty info", async function () {
      const [recipient, fraction] = await metaTalesNFT.getDefaultRoyalty();
      expect(recipient).to.equal(royaltyRecipient.address);
      expect(fraction).to.equal(DEFAULT_ROYALTY_FRACTION);
    });
  });

  describe("Minting", function () {
    it("Should mint NFT with custom royalty", async function () {
      const tx = await metaTalesNFT.mintNFT(
        creator.address,
        TOKEN_URI,
        creator.address,
        CUSTOM_ROYALTY_FRACTION
      );

      await expect(tx)
        .to.emit(metaTalesNFT, "TokenMinted")
        .withArgs(1, creator.address, TOKEN_URI, creator.address, CUSTOM_ROYALTY_FRACTION)
        .and.to.emit(metaTalesNFT, "RoyaltySet")
        .withArgs(1, creator.address, CUSTOM_ROYALTY_FRACTION);

      expect(await metaTalesNFT.ownerOf(1)).to.equal(creator.address);
      expect(await metaTalesNFT.tokenURI(1)).to.equal(TOKEN_URI);
      expect(await metaTalesNFT.totalSupply()).to.equal(1);
    });

    it("Should mint NFT with default royalty", async function () {
      const tx = await metaTalesNFT.mintNFTWithDefaultRoyalty(
        creator.address,
        TOKEN_URI
      );

      await expect(tx)
        .to.emit(metaTalesNFT, "TokenMinted")
        .withArgs(1, creator.address, TOKEN_URI, royaltyRecipient.address, DEFAULT_ROYALTY_FRACTION);

      const [recipient, fraction] = await metaTalesNFT.getTokenRoyalty(1);
      expect(recipient).to.equal(royaltyRecipient.address);
      expect(fraction).to.equal(DEFAULT_ROYALTY_FRACTION);
    });

    it("Should reject minting with royalty too high", async function () {
      await expect(
        metaTalesNFT.mintNFT(
          creator.address,
          TOKEN_URI,
          creator.address,
          1001 // > 10%
        )
      ).to.be.revertedWith("Royalty too high");
    });

    it("Should reject minting with invalid royalty recipient", async function () {
      await expect(
        metaTalesNFT.mintNFT(
          creator.address,
          TOKEN_URI,
          ethers.ZeroAddress,
          CUSTOM_ROYALTY_FRACTION
        )
      ).to.be.revertedWith("Invalid royalty recipient");
    });
  });

  describe("Royalty Management", function () {
    beforeEach(async function () {
      await metaTalesNFT.mintNFT(
        creator.address,
        TOKEN_URI,
        creator.address,
        CUSTOM_ROYALTY_FRACTION
      );
    });

    it("Should allow token owner to set royalty", async function () {
      const newRoyaltyFraction = 300; // 3%
      
      await expect(
        metaTalesNFT.connect(creator).setTokenRoyalty(1, buyer.address, newRoyaltyFraction)
      )
        .to.emit(metaTalesNFT, "RoyaltySet")
        .withArgs(1, buyer.address, newRoyaltyFraction);

      const [recipient, fraction] = await metaTalesNFT.getTokenRoyalty(1);
      expect(recipient).to.equal(buyer.address);
      expect(fraction).to.equal(newRoyaltyFraction);
    });

    it("Should allow contract owner to set royalty", async function () {
      const newRoyaltyFraction = 400; // 4%
      
      await expect(
        metaTalesNFT.connect(owner).setTokenRoyalty(1, owner.address, newRoyaltyFraction)
      )
        .to.emit(metaTalesNFT, "RoyaltySet")
        .withArgs(1, owner.address, newRoyaltyFraction);
    });

    it("Should reject unauthorized royalty changes", async function () {
      await expect(
        metaTalesNFT.connect(buyer).setTokenRoyalty(1, buyer.address, 300)
      ).to.be.revertedWith("Caller is not owner or token owner");
    });

    it("Should update default royalty (owner only)", async function () {
      const newRoyaltyFraction = 200; // 2%
      
      await metaTalesNFT.setDefaultRoyalty(owner.address, newRoyaltyFraction);
      
      const [recipient, fraction] = await metaTalesNFT.getDefaultRoyalty();
      expect(recipient).to.equal(owner.address);
      expect(fraction).to.equal(newRoyaltyFraction);
    });

    it("Should reject unauthorized default royalty changes", async function () {
      await expect(
        metaTalesNFT.connect(creator).setDefaultRoyalty(creator.address, 200)
      ).to.be.revertedWithCustomError(metaTalesNFT, "OwnableUnauthorizedAccount");
    });
  });

  describe("EIP-2981 Royalty Info", function () {
    beforeEach(async function () {
      await metaTalesNFT.mintNFT(
        creator.address,
        TOKEN_URI,
        creator.address,
        CUSTOM_ROYALTY_FRACTION
      );
    });

    it("Should return correct royalty info for existing token", async function () {
      const salePrice = ethers.parseEther("1"); // 1 ETH
      const expectedRoyalty = salePrice * BigInt(CUSTOM_ROYALTY_FRACTION) / BigInt(10000);

      const [recipient, royaltyAmount] = await metaTalesNFT.royaltyInfo(1, salePrice);
      
      expect(recipient).to.equal(creator.address);
      expect(royaltyAmount).to.equal(expectedRoyalty);
    });

    it("Should return default royalty for non-existent token", async function () {
      const salePrice = ethers.parseEther("1");
      
      const [recipient, royaltyAmount] = await metaTalesNFT.royaltyInfo(999, salePrice);
      
      expect(recipient).to.equal(royaltyRecipient.address);
      expect(royaltyAmount).to.equal(0); // Non-existent token returns 0 amount
    });

    it("Should calculate royalty correctly for different sale prices", async function () {
      const testPrices = [
        ethers.parseEther("0.1"),
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        ethers.parseEther("100")
      ];

      for (const price of testPrices) {
        const [, royaltyAmount] = await metaTalesNFT.royaltyInfo(1, price);
        const expectedRoyalty = price * BigInt(CUSTOM_ROYALTY_FRACTION) / BigInt(10000);
        expect(royaltyAmount).to.equal(expectedRoyalty);
      }
    });
  });

  describe("Interface Support", function () {
    it("Should support ERC721 interface", async function () {
      expect(await metaTalesNFT.supportsInterface("0x80ac58cd")).to.be.true;
    });

    it("Should support ERC2981 interface", async function () {
      expect(await metaTalesNFT.supportsInterface("0x2a55205a")).to.be.true;
    });

    it("Should support ERC165 interface", async function () {
      expect(await metaTalesNFT.supportsInterface("0x01ffc9a7")).to.be.true;
    });
  });

  describe("Token Management", function () {
    beforeEach(async function () {
      await metaTalesNFT.mintNFT(
        creator.address,
        TOKEN_URI,
        creator.address,
        CUSTOM_ROYALTY_FRACTION
      );
    });

    it("Should allow token burning", async function () {
      await metaTalesNFT.connect(creator).burn(1);
      
      await expect(metaTalesNFT.ownerOf(1)).to.be.revertedWithCustomError(
        metaTalesNFT, "ERC721NonexistentToken"
      );
    });

    it("Should clean up royalty info on burn", async function () {
      await metaTalesNFT.connect(creator).burn(1);
      
      // Token doesn't exist, should return default royalty with 0 amount
      const [recipient, royaltyAmount] = await metaTalesNFT.royaltyInfo(1, ethers.parseEther("1"));
      expect(recipient).to.equal(royaltyRecipient.address);
      expect(royaltyAmount).to.equal(0);
    });

    it("Should track total supply correctly", async function () {
      expect(await metaTalesNFT.totalSupply()).to.equal(1);
      
      await metaTalesNFT.mintNFTWithDefaultRoyalty(buyer.address, "ipfs://test2");
      expect(await metaTalesNFT.totalSupply()).to.equal(2);
      
      await metaTalesNFT.connect(creator).burn(1);
      expect(await metaTalesNFT.totalSupply()).to.equal(2); // Total supply doesn't decrease on burn
    });
  });
});
```
