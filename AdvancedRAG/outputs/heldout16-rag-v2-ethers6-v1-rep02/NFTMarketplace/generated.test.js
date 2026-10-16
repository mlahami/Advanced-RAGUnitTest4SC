const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTMarketplace", function () {
  let marketplace;
  let nft;
  let owner, seller, buyer, royaltyRecipient;
  const tokenId = 1n;
  const price = ethers.parseEther("1");
  const royaltyBps = 250n; // 2.5%

  beforeEach(async function () {
    [owner, seller, buyer, royaltyRecipient] = await ethers.getSigners();

    // Deploy BenchmarkERC721
    const BenchmarkERC721 = await ethers.getContractFactory("BenchmarkERC721");
    nft = await BenchmarkERC721.deploy("TestNFT", "TNFT");
    await nft.waitForDeployment();

    // Mint and approve NFT for marketplace
    await nft.mint(seller.address, tokenId);
    await nft.connect(seller).approve(await marketplace.getAddress(), tokenId);

    // Deploy NFTMarketplace
    const NFTMarketplace = await ethers.getContractFactory("NFTMarketplace");
    marketplace = await NFTMarketplace.deploy();
    await marketplace.waitForDeployment();
  });

  describe("setRoyalty", function () {
    it("should set royalty correctly", async function () {
      await expect(marketplace.connect(seller).setRoyalty(await nft.getAddress(), royaltyBps))
        .to.emit(marketplace, "RoyaltySet")
        .withArgs(await nft.getAddress(), seller.address, royaltyBps);

      const royaltyInfo = await marketplace.royalties(await nft.getAddress());
      expect(royaltyInfo.creator).to.equal(seller.address);
      expect(royaltyInfo.bps).to.equal(royaltyBps);
    });

    it("should revert when setting royalty above 10%", async function () {
      await expect(marketplace.connect(seller).setRoyalty(await nft.getAddress(), 1001n))
        .to.be.revertedWith("Max 10%");
    });
  });

  describe("list", function () {
    it("should list an NFT correctly", async function () {
      await expect(marketplace.connect(seller).list(await nft.getAddress(), tokenId, price))
        .to.emit(marketplace, "Listed")
        .withArgs(await nft.getAddress(), tokenId, price);

      const listing = await marketplace.listings(await nft.getAddress(), tokenId);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.price).to.equal(price);
      expect(listing.active).to.be.true;
    });

    it("should revert when listing NFT not owned by sender", async function () {
      await expect(marketplace.connect(buyer).list(await nft.getAddress(), tokenId, price))
        .to.be.revertedWith("Not owner");
    });

    it("should revert when listing NFT not approved for marketplace", async function () {
      const newTokenId = 2n;
      await nft.mint(seller.address, newTokenId);
      await expect(marketplace.connect(seller).list(await nft.getAddress(), newTokenId, price))
        .to.be.revertedWith("Not approved");
    });
  });

  describe("buy", function () {
    beforeEach(async function () {
      await marketplace.connect(seller).list(await nft.getAddress(), tokenId, price);
      await marketplace.connect(seller).setRoyalty(await nft.getAddress(), royaltyBps);
    });

    it("should allow buying a listed NFT", async function () {
      const initialSellerBalance = await ethers.provider.getBalance(seller.address);
      const initialRoyaltyRecipientBalance = await ethers.provider.getBalance(royaltyRecipient.address);

      const tx = await marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price });
      const receipt = await tx.wait();

      // Check event
      await expect(tx)
        .to.emit(marketplace, "Sold")
        .withArgs(await nft.getAddress(), tokenId, buyer.address, price);

      // Check NFT ownership
      expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);

      // Check listing is no longer active
      const listing = await marketplace.listings(await nft.getAddress(), tokenId);
      expect(listing.active).to.be.false;

      // Check payments
      const royaltyAmount = (price * royaltyBps) / 10000n;
      const sellerProceeds = price - royaltyAmount;

      const finalSellerBalance = await ethers.provider.getBalance(seller.address);
      const finalRoyaltyRecipientBalance = await ethers.provider.getBalance(royaltyRecipient.address);

      expect(finalSellerBalance).to.be.greaterThan(initialSellerBalance + sellerProceeds);
      expect(finalRoyaltyRecipientBalance).to.be.greaterThan(initialRoyaltyRecipientBalance + royaltyAmount);

      // Check gas costs
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      expect(finalSellerBalance).to.be.closeTo(initialSellerBalance + sellerProceeds - gasUsed, ethers.parseEther("0.01"));
    });

    it("should revert when buying unlisted NFT", async function () {
      const newTokenId = 2n;
      await nft.mint(seller.address, newTokenId);
      await nft.connect(seller).approve(await marketplace.getAddress(), newTokenId);
      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), newTokenId, { value: price }))
        .to.be.revertedWith("Not listed");
    });

    it("should revert when buying with insufficient payment", async function () {
      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price - 1n }))
        .to.be.revertedWith("Insufficient payment");
    });

    it("should handle excess payment with refund", async function () {
      const excessAmount = ethers.parseEther("0.5");
      const totalPayment = price + excessAmount;

      const initialBuyerBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: totalPayment });
      const receipt = await tx.wait();

      const finalBuyerBalance = await ethers.provider.getBalance(buyer.address);
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      // Buyer should have approximately the same balance minus gas costs
      expect(finalBuyerBalance).to.be.closeTo(initialBuyerBalance - gasUsed, ethers.parseEther("0.01"));
    });

    it("should revert when royalty transfer fails", async function () {
      // Deploy a contract that will revert on receive
      const RevertReceiver = await ethers.getContractFactory("BenchmarkTarget");
      const revertReceiver = await RevertReceiver.deploy();
      await revertReceiver.waitForDeployment();

      // Set royalty to the revert receiver
      await marketplace.connect(seller).setRoyalty(await nft.getAddress(), royaltyBps);
      await marketplace.connect(revertReceiver).setRoyalty(await nft.getAddress(), royaltyBps);

      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price }))
        .to.be.revertedWith("Royalty transfer failed");
    });

    it("should revert when seller transfer fails", async function () {
      // Deploy a contract that will revert on receive
      const RevertReceiver = await ethers.getContractFactory("BenchmarkTarget");
      const revertReceiver = await RevertReceiver.deploy();
      await revertReceiver.waitForDeployment();

      // List NFT with revert receiver as seller
      await nft.connect(seller).transferFrom(seller.address, revertReceiver.address, tokenId);
      await nft.connect(revertReceiver).approve(await marketplace.getAddress(), tokenId);
      await marketplace.connect(revertReceiver).list(await nft.getAddress(), tokenId, price);

      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price }))
        .to.be.revertedWith("Seller transfer failed");
    });
  });
});