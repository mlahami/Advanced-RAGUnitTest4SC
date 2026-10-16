# regen-nft--sodofi

- domain: nft-marketplace (nft)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/sodofi/celo-nft-mcp @ 4612a7374095cdf50b20787c82f7b7b517db8052
- license: MIT
- targets: RegenNFT.sol
- validation: 17 passing tests, 0 failing; statement coverage RegenNFT.sol 100.0 %

## Contract: RegenNFT.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RegenNFT
 * @dev A regenerative NFT contract for environmental and social impact projects
 */
contract RegenNFT is ERC721, ERC721URIStorage, Ownable {
    uint256 private _tokenIdCounter;
    
    // Base URI for metadata
    string private _baseTokenURI;
    
    // Mapping from token ID to impact data
    mapping(uint256 => string) public impactData;
    
    // Events
    event NFTMinted(address indexed to, uint256 indexed tokenId, string tokenURI);
    event ImpactDataUpdated(uint256 indexed tokenId, string impactData);
    event BaseURIUpdated(string newBaseURI);

    constructor(
        string memory name,
        string memory symbol,
        string memory baseTokenURI
    ) ERC721(name, symbol) Ownable(msg.sender) {
        _baseTokenURI = baseTokenURI;
    }

    /**
     * @dev Mint a new Regen NFT
     * @param to Address to mint the NFT to
     * @param uri Metadata URI for the NFT
     * @param _impactData Impact data associated with this NFT
     */
    function mintNFT(
        address to,
        string memory uri,
        string memory _impactData
    ) public onlyOwner returns (uint256) {
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        
        if (bytes(_impactData).length > 0) {
            impactData[tokenId] = _impactData;
            emit ImpactDataUpdated(tokenId, _impactData);
        }
        
        emit NFTMinted(to, tokenId, uri);
        return tokenId;
    }

    /**
     * @dev Batch mint multiple NFTs
     * @param to Address to mint the NFTs to
     * @param tokenURIs Array of metadata URIs
     * @param _impactDataArray Array of impact data
     */
    function batchMintNFT(
        address to,
        string[] memory tokenURIs,
        string[] memory _impactDataArray
    ) public onlyOwner {
        require(tokenURIs.length == _impactDataArray.length, "Arrays length mismatch");
        
        for (uint256 i = 0; i < tokenURIs.length; i++) {
            mintNFT(to, tokenURIs[i], _impactDataArray[i]);
        }
    }

    /**
     * @dev Update impact data for a token
     * @param tokenId Token ID to update
     * @param _impactData New impact data
     */
    function updateImpactData(uint256 tokenId, string memory _impactData) public onlyOwner {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        impactData[tokenId] = _impactData;
        emit ImpactDataUpdated(tokenId, _impactData);
    }

    /**
     * @dev Set the base URI for token metadata
     * @param baseTokenURI New base URI
     */
    function setBaseURI(string memory baseTokenURI) public onlyOwner {
        _baseTokenURI = baseTokenURI;
        emit BaseURIUpdated(baseTokenURI);
    }

    /**
     * @dev Get the total number of tokens minted
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev Get impact data for a token
     * @param tokenId Token ID to query
     */
    function getImpactData(uint256 tokenId) public view returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return impactData[tokenId];
    }

    // Override functions required by Solidity
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

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
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

## Tests: RegenNFT.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RegenNFT", function () {
  let regenNFT;
  let owner;
  let addr1;
  let addr2;

  const NFT_NAME = "Regen NFT";
  const NFT_SYMBOL = "REGEN";
  const BASE_URI = "https://api.regennft.com/metadata/";

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const RegenNFTFactory = await ethers.getContractFactory("RegenNFT");
    regenNFT = await RegenNFTFactory.deploy(NFT_NAME, NFT_SYMBOL, BASE_URI);
    await regenNFT.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right name and symbol", async function () {
      expect(await regenNFT.name()).to.equal(NFT_NAME);
      expect(await regenNFT.symbol()).to.equal(NFT_SYMBOL);
    });

    it("Should set the right owner", async function () {
      expect(await regenNFT.owner()).to.equal(owner.address);
    });

    it("Should start with zero total supply", async function () {
      expect(await regenNFT.totalSupply()).to.equal(0);
    });
  });

  describe("Minting", function () {
    it("Should mint NFT to specified address", async function () {
      const tokenURI = "token1.json";
      const impactData = "Carbon offset: 10 tons CO2";

      await expect(regenNFT.mintNFT(addr1.address, tokenURI, impactData))
        .to.emit(regenNFT, "NFTMinted")
        .withArgs(addr1.address, 0, tokenURI);

      expect(await regenNFT.balanceOf(addr1.address)).to.equal(1);
      expect(await regenNFT.ownerOf(0)).to.equal(addr1.address);
      expect(await regenNFT.totalSupply()).to.equal(1);
    });

    it("Should set token URI correctly", async function () {
      const tokenURI = "token1.json";
      const impactData = "Carbon offset: 10 tons CO2";

      await regenNFT.mintNFT(addr1.address, tokenURI, impactData);
      expect(await regenNFT.tokenURI(0)).to.equal(BASE_URI + tokenURI);
    });

    it("Should store impact data correctly", async function () {
      const tokenURI = "token1.json";
      const impactData = "Carbon offset: 10 tons CO2";

      await regenNFT.mintNFT(addr1.address, tokenURI, impactData);
      expect(await regenNFT.getImpactData(0)).to.equal(impactData);
    });

    it("Should only allow owner to mint", async function () {
      const tokenURI = "token1.json";
      const impactData = "Carbon offset: 10 tons CO2";

      await expect(
        regenNFT.connect(addr1).mintNFT(addr2.address, tokenURI, impactData)
      ).to.be.revertedWithCustomError(regenNFT, "OwnableUnauthorizedAccount");
    });

    it("Should batch mint multiple NFTs", async function () {
      const tokenURIs = ["token1.json", "token2.json", "token3.json"];
      const impactDataArray = [
        "Carbon offset: 10 tons CO2",
        "Reforestation: 100 trees planted",
        "Ocean cleanup: 50kg plastic removed"
      ];

      await regenNFT.batchMintNFT(addr1.address, tokenURIs, impactDataArray);

      expect(await regenNFT.balanceOf(addr1.address)).to.equal(3);
      expect(await regenNFT.totalSupply()).to.equal(3);

      for (let i = 0; i < tokenURIs.length; i++) {
        expect(await regenNFT.ownerOf(i)).to.equal(addr1.address);
        expect(await regenNFT.getImpactData(i)).to.equal(impactDataArray[i]);
      }
    });

    it("Should revert batch mint with mismatched arrays", async function () {
      const tokenURIs = ["token1.json", "token2.json"];
      const impactDataArray = ["Carbon offset: 10 tons CO2"];

      await expect(
        regenNFT.batchMintNFT(addr1.address, tokenURIs, impactDataArray)
      ).to.be.revertedWith("Arrays length mismatch");
    });
  });

  describe("Impact Data Management", function () {
    beforeEach(async function () {
      await regenNFT.mintNFT(addr1.address, "token1.json", "Initial impact data");
    });

    it("Should update impact data", async function () {
      const newImpactData = "Updated: Carbon offset: 20 tons CO2";

      await expect(regenNFT.updateImpactData(0, newImpactData))
        .to.emit(regenNFT, "ImpactDataUpdated")
        .withArgs(0, newImpactData);

      expect(await regenNFT.getImpactData(0)).to.equal(newImpactData);
    });

    it("Should only allow owner to update impact data", async function () {
      const newImpactData = "Updated impact data";

      await expect(
        regenNFT.connect(addr1).updateImpactData(0, newImpactData)
      ).to.be.revertedWithCustomError(regenNFT, "OwnableUnauthorizedAccount");
    });

    it("Should revert when updating non-existent token", async function () {
      await expect(
        regenNFT.updateImpactData(999, "Some data")
      ).to.be.revertedWith("Token does not exist");
    });
  });

  describe("Base URI Management", function () {
    it("Should update base URI", async function () {
      const newBaseURI = "https://new-api.regennft.com/metadata/";

      await expect(regenNFT.setBaseURI(newBaseURI))
        .to.emit(regenNFT, "BaseURIUpdated")
        .withArgs(newBaseURI);

      // Mint a token to test the new base URI
      await regenNFT.mintNFT(addr1.address, "token1.json", "Impact data");
      expect(await regenNFT.tokenURI(0)).to.equal(newBaseURI + "token1.json");
    });

    it("Should only allow owner to update base URI", async function () {
      const newBaseURI = "https://new-api.regennft.com/metadata/";

      await expect(
        regenNFT.connect(addr1).setBaseURI(newBaseURI)
      ).to.be.revertedWithCustomError(regenNFT, "OwnableUnauthorizedAccount");
    });
  });

  describe("Token Queries", function () {
    beforeEach(async function () {
      await regenNFT.mintNFT(addr1.address, "token1.json", "Impact data 1");
      await regenNFT.mintNFT(addr2.address, "token2.json", "Impact data 2");
    });

    it("Should return correct total supply", async function () {
      expect(await regenNFT.totalSupply()).to.equal(2);
    });

    it("Should revert when querying impact data for non-existent token", async function () {
      await expect(regenNFT.getImpactData(999)).to.be.revertedWith("Token does not exist");
    });

    it("Should support ERC721 interface", async function () {
      const ERC721_INTERFACE_ID = "0x80ac58cd";
      expect(await regenNFT.supportsInterface(ERC721_INTERFACE_ID)).to.be.true;
    });
  });
});
```
