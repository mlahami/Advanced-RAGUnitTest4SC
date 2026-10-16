# my-nft--nikhil0716

- domain: nft-marketplace (nft)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/nikhil0716/fullstack-blockchain-dapps @ 071e9da35778d954469a1c240a2988e4fcf0f9ae
- license: MIT
- targets: MyNFT.sol
- validation: 6 passing tests, 0 failing; statement coverage MyNFT.sol 100.0 %

## Contract: MyNFT.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Coursework ERC721 with payable mint and IPFS metadata
contract MyNFT is ERC721URIStorage, Ownable, ReentrancyGuard {
    uint256 public nextTokenId;
    uint256 public price; // wei

    event Minted(address indexed to, uint256 indexed tokenId, string tokenURI);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);
    event Withdrawal(address indexed to, uint256 amount);

    constructor(string memory name_, string memory symbol_, uint256 initialPriceWei)
        ERC721(name_, symbol_) 
        Ownable(msg.sender)
    {
        price = initialPriceWei;
    }

    /// @notice Owner can change mint price
    function setPrice(uint256 newPrice) external onlyOwner {
        emit PriceUpdated(price, newPrice);
        price = newPrice;
    }

    /// @notice Payable mint. Stores IPFS tokenURI.
    function safeMint(address to, string memory tokenUri)
        external
        payable
        nonReentrant
        returns (uint256 tokenId)
    {
        require(msg.value >= price, "Insufficient ETH");
        tokenId = ++nextTokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenUri);
        emit Minted(to, tokenId, tokenUri);
    }

    /// @notice Withdraw contract balance to owner
    function withdraw() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        require(bal > 0, "No balance");
        (bool ok, ) = payable(owner()).call{value: bal}("");
        require(ok, "Withdraw failed");
        emit Withdrawal(owner(), bal);
    }

    // Required override (multiple inheritance)
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }
}
```

## Tests: erc721.test.js

```javascript
const { expect, assert } = require("chai");
const { ethers } = require("hardhat");

// >>>>>>> IMPORTANT per spec: tokenURI variable in test <<<<<<<<
const tokenURIs = [
  "ipfs://YOUR_CID/1.json","ipfs://YOUR_CID/2.json","ipfs://YOUR_CID/3.json",
  "ipfs://YOUR_CID/4.json","ipfs://YOUR_CID/5.json","ipfs://YOUR_CID/6.json",
  "ipfs://YOUR_CID/7.json","ipfs://YOUR_CID/8.json","ipfs://YOUR_CID/9.json",
  "ipfs://YOUR_CID/10.json"
];

describe("MyNFT (ERC721)", function () {
  let nft, owner, buyer, other;
  const NAME = "CourseworkNFT";
  const SYMBOL = "CNFT";
  const INITIAL_PRICE = ethers.parseEther("0.05");

  before(async () => {
    [owner, buyer, other] = await ethers.getSigners();
    const NFT = await ethers.getContractFactory("MyNFT");
    nft = await NFT.connect(owner).deploy(NAME, SYMBOL, INITIAL_PRICE);
    await nft.waitForDeployment();
    expect(await nft.name()).to.equal(NAME);
    expect(await nft.symbol()).to.equal(SYMBOL);
  });

  it("reverts mint if sent ETH < price (require + revert)", async () => {
    await expect(
      nft.connect(buyer).safeMint(buyer.address, tokenURIs[0], { value: ethers.parseEther("0.01") })
    ).to.be.revertedWith("Insufficient ETH");
  });

  it("mints when price is met; balanceOf/ownerOf/tokenURI are correct", async () => {
    const tx = await nft.connect(buyer).safeMint(buyer.address, tokenURIs[0], { value: INITIAL_PRICE });
    const receipt = await tx.wait();
    const tokenId = 1n; // first mint
    // balanceOf & ownerOf
    expect(await nft.balanceOf(buyer.address)).to.equal(1);
    expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
    // tokenURI
    expect(await nft.tokenURI(tokenId)).to.equal(tokenURIs[0]);
    // simple block inspection
    assert(receipt.blockNumber > 0, "should have a block number");
  });

  it("approve & getApproved, then transferFrom to other", async () => {
    const tokenId = 1n;
    await nft.connect(buyer).approve(other.address, tokenId);
    expect(await nft.getApproved(tokenId)).to.equal(other.address);

    // transferFrom with approval
    await nft.connect(other).transferFrom(buyer.address, other.address, tokenId);
    expect(await nft.ownerOf(tokenId)).to.equal(other.address);
  });

  it("safeTransferFrom works EOA->EOA", async () => {
    // Mint a second NFT for buyer:
    await nft.connect(buyer).safeMint(buyer.address, tokenURIs[1], { value: INITIAL_PRICE });
    const tokenId = 2n;

    await nft.connect(buyer)["safeTransferFrom(address,address,uint256)"](buyer.address, owner.address, tokenId);
    expect(await nft.ownerOf(tokenId)).to.equal(owner.address);
  });

  it("only owner can setPrice; price update takes effect", async () => {
    await expect(nft.connect(buyer).setPrice(0)).to.be.reverted; // onlyOwner
    const old = await nft.price();
    await nft.connect(owner).setPrice(ethers.parseEther("0.1"));
    const nu = await nft.price();
    expect(nu).to.not.equal(old);
    expect(nu).to.equal(ethers.parseEther("0.1"));
  });

  it("contract collects ETH on mint and owner can withdraw", async () => {
    // Mint one at 0.1 ETH to accumulate balance
    await nft.connect(buyer).safeMint(buyer.address, tokenURIs[2], { value: ethers.parseEther("0.1") });

    const before = await ethers.provider.getBalance(await owner.getAddress());
    const contractBal = await ethers.provider.getBalance(await nft.getAddress());
    expect(contractBal).to.be.gt(0);

    const withdrawTx = await nft.connect(owner).withdraw();
    const rc = await withdrawTx.wait();
    const gasCost = rc.gasUsed * withdrawTx.gasPrice;

    const after = await ethers.provider.getBalance(await owner.getAddress());
    // after ≈ before + contractBal - gas
    expect(after + gasCost).to.equal(before + contractBal);
  });
});
```
