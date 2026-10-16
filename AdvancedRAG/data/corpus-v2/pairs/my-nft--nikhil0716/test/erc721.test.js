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
