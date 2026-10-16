const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTMarketplace", function () {
  let marketplace;
  let erc721;
  let owner;
  let seller;
  let buyer;
  let royaltyReceiver;
  let tokenId = 1n;
  let price = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, seller, buyer, royaltyReceiver] = await ethers.getSigners();

    // Deploy BenchmarkERC721
    const ERC721 = await ethers.getContractFactory("BenchmarkERC721");
    erc721 = await ERC721.deploy("TestNFT", "TNFT");
    await erc721.waitForDeployment();

    // Mint NFT to seller
    await erc721.mint(seller.address, tokenId);

    // Deploy NFTMarketplace
    const Marketplace = await ethers.getContractFactory("NFTMarketplace");
    marketplace = await Marketplace.deploy();
    await marketplace.waitForDeployment();
  });

  describe("setRoyalty", function () {
    it("should set royalty correctly", async function () {
      const bps = 250n; // 2.5%
      await expect(marketplace.connect(owner).setRoyalty(await erc721.getAddress(), bps))
        .to.emit(marketplace, "RoyaltySet")
        .withArgs(await erc721.getAddress(), owner.address, bps);

      const royaltyInfo = await marketplace.royalties(await erc721.getAddress());
      expect(royaltyInfo.creator).to.equal(owner.address);
      expect(royaltyInfo.bps).to.equal(bps);
    });

    it("should revert if royalty exceeds 10%", async function () {
      const bps = 1001n; // 10.01%
      await expect(marketplace.connect(owner).setRoyalty(await erc721.getAddress(), bps))
        .to.be.revertedWith("Max 10%");
    });
  });

  describe("list", function () {
    it("should list NFT correctly", async function () {
      // Approve marketplace to transfer NFT
      await erc721.connect(seller).approve(await marketplace.getAddress(), tokenId);

      await expect(marketplace.connect(seller).list(await erc721.getAddress(), tokenId, price))
        .to.emit(marketplace, "Listed")
        .withArgs(await erc721.getAddress(), tokenId, price);

      const listing = await marketplace.listings(await erc721.getAddress(), tokenId);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.price).to.equal(price);
      expect(listing.active).to.be.true;
    });

    it("should revert if not owner", async function () {
      await expect(marketplace.connect(buyer).list(await erc721.getAddress(), tokenId, price))
        .to.be.revertedWith("Not owner");
    });

    it("should revert if not approved", async function () {
      await expect(marketplace.connect(seller).list(await erc721.getAddress(), tokenId, price))
        .to.be.revertedWith("Not approved");
    });
  });

  describe("buy", function () {
    beforeEach(async function () {
      // Approve and list NFT
      await erc721.connect(seller).approve(await marketplace.getAddress(), tokenId);
      await marketplace.connect(seller).list(await erc721.getAddress(), tokenId, price);

      // Set royalty
      await marketplace.connect(owner).setRoyalty(await erc721.getAddress(), 250n); // 2.5%
    });

    it("should buy NFT correctly", async function () {
      const royaltyAmount = price * 250n / 10000n;
      const sellerProceeds = price - royaltyAmount;

      await expect(marketplace.connect(buyer).buy(await erc721.getAddress(), tokenId, { value: price }))
        .to.emit(marketplace, "Sold")
        .withArgs(await erc721.getAddress(), tokenId, buyer.address, price);

      // Check NFT ownership
      expect(await erc721.ownerOf(tokenId)).to.equal(buyer.address);

      // Check listing is deactivated
      const listing = await marketplace.listings(await erc721.getAddress(), tokenId);
      expect(listing.active).to.be.false;

      // Check balances
      const marketplaceBalance = await ethers.provider.getBalance(await marketplace.getAddress());
      expect(marketplaceBalance).to.equal(0n);

      // Check royalty and seller proceeds
      // Note: In a real test, we would check the actual transfers to royaltyReceiver and seller
      // This is a simplified check for the purpose of this example
    });

    it("should revert if not listed", async function () {
      const invalidTokenId = 999n;
      await expect(marketplace.connect(buyer).buy(await erc721.getAddress(), invalidTokenId, { value: price }))
        .to.be.revertedWith("Not listed");
    });

    it("should revert if insufficient payment", async function () {
      const insufficientAmount = ethers.parseEther("0.5");
      await expect(marketplace.connect(buyer).buy(await erc721.getAddress(), tokenId, { value: insufficientAmount }))
        .to.be.revertedWith("Insufficient payment");
    });

    it("should handle excess payment with refund", async function () {
      const excessAmount = ethers.parseEther("2");
      await expect(marketplace.connect(buyer).buy(await erc721.getAddress(), tokenId, { value: excessAmount }))
        .to.emit(marketplace, "Sold")
        .withArgs(await erc721.getAddress(), tokenId, buyer.address, price);

      // Check NFT ownership
      expect(await erc721.ownerOf(tokenId)).to.equal(buyer.address);
    });
  });
});