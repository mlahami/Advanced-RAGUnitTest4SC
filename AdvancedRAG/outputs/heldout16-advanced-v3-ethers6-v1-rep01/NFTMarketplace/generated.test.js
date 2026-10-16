const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTMarketplace", function () {
  let marketplace;
  let nft;
  let owner, seller, buyer, royaltyRecipient;
  const PRICE = ethers.parseEther("1");
  const ROYALTY_BPS = 250; // 2.5%
  const TOKEN_ID = 1n;

  beforeEach(async function () {
    [owner, seller, buyer, royaltyRecipient] = await ethers.getSigners();

    // Deploy BenchmarkERC721
    const BenchmarkERC721 = await ethers.getContractFactory("BenchmarkERC721");
    nft = await BenchmarkERC721.deploy("TestNFT", "TNFT");
    await nft.waitForDeployment();

    // Mint NFT to seller
    await nft.mint(seller.address, TOKEN_ID);

    // Deploy NFTMarketplace
    const NFTMarketplace = await ethers.getContractFactory("NFTMarketplace");
    marketplace = await NFTMarketplace.deploy();
    await marketplace.waitForDeployment();
  });

  describe("setRoyalty", function () {
    it("should set royalty correctly", async function () {
      await expect(marketplace.connect(royaltyRecipient).setRoyalty(await nft.getAddress(), ROYALTY_BPS))
        .to.emit(marketplace, "RoyaltySet")
        .withArgs(await nft.getAddress(), royaltyRecipient.address, ROYALTY_BPS);

      const royaltyInfo = await marketplace.royalties(await nft.getAddress());
      expect(royaltyInfo.creator).to.equal(royaltyRecipient.address);
      expect(royaltyInfo.bps).to.equal(ROYALTY_BPS);
    });

    it("should revert when royalty exceeds maximum", async function () {
      await expect(marketplace.setRoyalty(await nft.getAddress(), 1001))
        .to.be.revertedWith("Max 10%");
    });
  });

  describe("list", function () {
    beforeEach(async function () {
      // Approve marketplace to transfer NFT
      await nft.connect(seller).approve(await marketplace.getAddress(), TOKEN_ID);
    });

    it("should list NFT correctly", async function () {
      await expect(marketplace.connect(seller).list(await nft.getAddress(), TOKEN_ID, PRICE))
        .to.emit(marketplace, "Listed")
        .withArgs(await nft.getAddress(), TOKEN_ID, PRICE);

      const listing = await marketplace.listings(await nft.getAddress(), TOKEN_ID);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.price).to.equal(PRICE);
      expect(listing.active).to.be.true;
    });

    it("should revert when caller is not owner", async function () {
      await expect(marketplace.connect(buyer).list(await nft.getAddress(), TOKEN_ID, PRICE))
        .to.be.revertedWith("Not owner");
    });

    it("should revert when marketplace is not approved", async function () {
      // Revoke approval
      await nft.connect(seller).approve(ethers.ZeroAddress, TOKEN_ID);
      await expect(marketplace.connect(seller).list(await nft.getAddress(), TOKEN_ID, PRICE))
        .to.be.revertedWith("Not approved");
    });
  });

  describe("buy", function () {
    beforeEach(async function () {
      // Approve and list NFT
      await nft.connect(seller).approve(await marketplace.getAddress(), TOKEN_ID);
      await marketplace.connect(seller).list(await nft.getAddress(), TOKEN_ID, PRICE);

      // Set royalty
      await marketplace.connect(royaltyRecipient).setRoyalty(await nft.getAddress(), ROYALTY_BPS);
    });

    it("should buy NFT correctly with royalty", async function () {
      const initialSellerBalance = await ethers.provider.getBalance(seller.address);
      const initialRoyaltyBalance = await ethers.provider.getBalance(royaltyRecipient.address);

      const tx = await marketplace.connect(buyer).buy(await nft.getAddress(), TOKEN_ID, { value: PRICE });
      const receipt = await tx.wait();

      // Check event
      await expect(tx)
        .to.emit(marketplace, "Sold")
        .withArgs(await nft.getAddress(), TOKEN_ID, buyer.address, PRICE);

      // Check NFT ownership
      expect(await nft.ownerOf(TOKEN_ID)).to.equal(buyer.address);

      // Check listing is deactivated
      const listing = await marketplace.listings(await nft.getAddress(), TOKEN_ID);
      expect(listing.active).to.be.false;

      // Check balances
      const royaltyAmount = (PRICE * BigInt(ROYALTY_BPS)) / 10000n;
      const sellerProceeds = PRICE - royaltyAmount;

      const finalSellerBalance = await ethers.provider.getBalance(seller.address);
      const finalRoyaltyBalance = await ethers.provider.getBalance(royaltyRecipient.address);

      expect(finalSellerBalance).to.equal(initialSellerBalance + sellerProceeds - receipt.gasUsed * receipt.gasPrice);
      expect(finalRoyaltyBalance).to.equal(initialRoyaltyBalance + royaltyAmount);
    });

    it("should buy NFT correctly without royalty", async function () {
      // Set royalty to 0
      await marketplace.connect(royaltyRecipient).setRoyalty(await nft.getAddress(), 0);

      const initialSellerBalance = await ethers.provider.getBalance(seller.address);

      const tx = await marketplace.connect(buyer).buy(await nft.getAddress(), TOKEN_ID, { value: PRICE });
      const receipt = await tx.wait();

      // Check event
      await expect(tx)
        .to.emit(marketplace, "Sold")
        .withArgs(await nft.getAddress(), TOKEN_ID, buyer.address, PRICE);

      // Check NFT ownership
      expect(await nft.ownerOf(TOKEN_ID)).to.equal(buyer.address);

      // Check listing is deactivated
      const listing = await marketplace.listings(await nft.getAddress(), TOKEN_ID);
      expect(listing.active).to.be.false;

      // Check balances
      const finalSellerBalance = await ethers.provider.getBalance(seller.address);
      expect(finalSellerBalance).to.equal(initialSellerBalance + PRICE - receipt.gasUsed * receipt.gasPrice);
    });

    it("should revert when NFT is not listed", async function () {
      // List and then deactivate
      await marketplace.connect(seller).list(await nft.getAddress(), TOKEN_ID, PRICE);
      await marketplace.listings(await nft.getAddress(), TOKEN_ID).active = false;

      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), TOKEN_ID, { value: PRICE }))
        .to.be.revertedWith("Not listed");
    });

    it("should revert when payment is insufficient", async function () {
      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), TOKEN_ID, { value: PRICE - 1n }))
        .to.be.revertedWith("Insufficient payment");
    });

    it("should handle excess payment with refund", async function () {
      const excessPayment = PRICE + ethers.parseEther("0.1");
      const initialBuyerBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await marketplace.connect(buyer).buy(await nft.getAddress(), TOKEN_ID, { value: excessPayment });
      const receipt = await tx.wait();

      // Check NFT ownership
      expect(await nft.ownerOf(TOKEN_ID)).to.equal(buyer.address);

      // Check buyer balance (approximate due to gas costs)
      const finalBuyerBalance = await ethers.provider.getBalance(buyer.address);
      expect(finalBuyerBalance).to.be.lessThan(initialBuyerBalance - PRICE + ethers.parseEther("0.09"));
    });
  });
});