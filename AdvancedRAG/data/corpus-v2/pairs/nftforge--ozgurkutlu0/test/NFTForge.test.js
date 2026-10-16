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
