# nftforge--ozgurkutlu0

- domain: nft-marketplace (nft)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ozgurkutlu0/nftforge @ 2c8f4cb1498a0c4e96d5dbb2de2fcfd7e839ffe7
- license: MIT
- targets: NFTForge.sol
- validation: 6 passing tests, 0 failing; statement coverage NFTForge.sol 100.0 %

## Contract: NFTForge.sol (primary target)

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

## Tests: NFTForge.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTForge", function () {
  let nft;
  let owner, alice, bob;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    const NFTForge = await ethers.getContractFactory("NFTForge");
    nft = await NFTForge.deploy();
    await nft.waitForDeployment();
  });

  it("starts with zero minted", async function () {
    expect(await nft.totalMinted()).to.equal(0);
  });

  it("mints to recipient with token URI", async function () {
    const uri = "ipfs://bafybeigtest/metadata.json";
    await nft.mint(alice.address, uri);

    expect(await nft.totalMinted()).to.equal(1);
    expect(await nft.ownerOf(0)).to.equal(alice.address);
    expect(await nft.tokenURI(0)).to.equal(uri);
  });

  it("emits Minted event", async function () {
    const uri = "ipfs://abc";
    await expect(nft.mint(bob.address, uri))
      .to.emit(nft, "Minted")
      .withArgs(bob.address, 0, uri);
  });

  it("auto-increments token ids", async function () {
    await nft.mint(alice.address, "ipfs://a");
    await nft.mint(alice.address, "ipfs://b");
    await nft.mint(bob.address, "ipfs://c");

    expect(await nft.ownerOf(0)).to.equal(alice.address);
    expect(await nft.ownerOf(1)).to.equal(alice.address);
    expect(await nft.ownerOf(2)).to.equal(bob.address);
    expect(await nft.tokenURI(2)).to.equal("ipfs://c");
  });

  it("supports standard ERC-721 transfer", async function () {
    await nft.mint(alice.address, "ipfs://x");
    await nft.connect(alice).transferFrom(alice.address, bob.address, 0);
    expect(await nft.ownerOf(0)).to.equal(bob.address);
  });

  it("reports correct name and symbol", async function () {
    expect(await nft.name()).to.equal("NFTForge");
    expect(await nft.symbol()).to.equal("FORGE");
  });
});
```
