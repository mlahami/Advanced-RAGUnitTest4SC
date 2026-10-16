const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTMarketplace", function () {
  let marketplace;
  let erc721;
  let owner, seller, buyer, royaltyRecipient;
  const tokenId = 1n;
  const price = ethers.parseEther("1");
  const royaltyBps = 250n; // 2.5%

  beforeEach(async function () {
    [owner, seller, buyer, royaltyRecipient] = await ethers.getSigners();

    // Deploy BenchmarkERC721
    const ERC721 = await ethers.getContractFactory("BenchmarkERC721");
    erc721 = await ERC721.deploy("TestNFT", "TNFT");
    await erc721.waitForDeployment();

    // Mint and approve NFT
    await erc721.mint(seller.address, tokenId);
    await erc721.connect(seller).approve(await erc721.getAddress(), tokenId);

    // Deploy NFTMarketplace
    const Marketplace = await ethers.getContractFactory("NFTMarketplace");
    marketplace = await Marketplace.deploy();
    await marketplace.waitForDeployment();

    // Set royalty
    await marketplace.connect(seller).setRoyalty(await erc721.getAddress(), royaltyBps);
  });

  describe("setRoyalty", function () {
    it("should set royalty correctly", async function () {
      const nftAddress = await erc721.getAddress();
      const tx = await marketplace.connect(seller).setRoyalty(nftAddress, royaltyBps);

      await expect(tx)
        .to.emit(marketplace, "RoyaltySet")
        .withArgs(nftAddress, seller.address, royaltyBps);

      const royaltyInfo = await marketplace.royalties(nftAddress);
      expect(royaltyInfo.creator).to.equal(seller.address);
      expect(royaltyInfo.bps).to.equal(royaltyBps);
    });

    it("should revert when setting royalty above 10%", async function () {
      const nftAddress = await erc721.getAddress();
      await expect(marketplace.connect(seller).setRoyalty(nftAddress, 1001n))
        .to.be.revertedWith("Max 10%");
    });
  });

  describe("list", function () {
    it("should list an NFT correctly", async function () {
      const nftAddress = await erc721.getAddress();
      await erc721.connect(seller).approve(await marketplace.getAddress(), tokenId);

      const tx = await marketplace.connect(seller).list(nftAddress, tokenId, price);

      await expect(tx)
        .to.emit(marketplace, "Listed")
        .withArgs(nftAddress, tokenId, price);

      const listing = await marketplace.listings(nftAddress, tokenId);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.price).to.equal(price);
      expect(listing.active).to.be.true;
    });

    it("should revert when listing NFT not owned by sender", async function () {
      const nftAddress = await erc721.getAddress();
      await expect(marketplace.connect(buyer).list(nftAddress, tokenId, price))
        .to.be.revertedWith("Not owner");
    });

    it("should revert when listing NFT not approved for marketplace", async function () {
      const nftAddress = await erc721.getAddress();
      await expect(marketplace.connect(seller).list(nftAddress, tokenId, price))
        .to.be.revertedWith("Not approved");
    });
  });

  describe("buy", function () {
    beforeEach(async function () {
      const nftAddress = await erc721.getAddress();
      await erc721.connect(seller).approve(await marketplace.getAddress(), tokenId);
      await marketplace.connect(seller).list(nftAddress, tokenId, price);
    });

    it("should allow buying a listed NFT", async function () {
      const nftAddress = await erc721.getAddress();
      const initialSellerBalance = await ethers.provider.getBalance(seller.address);
      const initialBuyerBalance = await ethers.provider.getBalance(buyer.address);
      const initialRoyaltyRecipientBalance = await ethers.provider.getBalance(royaltyRecipient.address);

      const tx = await marketplace.connect(buyer).buy(nftAddress, tokenId, { value: price });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      await expect(tx)
        .to.emit(marketplace, "Sold")
        .withArgs(nftAddress, tokenId, buyer.address, price);

      // Check NFT ownership
      expect(await erc721.ownerOf(tokenId)).to.equal(buyer.address);

      // Check balances
      const finalSellerBalance = await ethers.provider.getBalance(seller.address);
      const finalBuyerBalance = await ethers.provider.getBalance(buyer.address);
      const finalRoyaltyRecipientBalance = await ethers.provider.getBalance(royaltyRecipient.address);

      // Calculate expected amounts
      const royaltyAmount = (price * royaltyBps) / 10000n;
      const sellerProceeds = price - royaltyAmount;

      expect(finalSellerBalance).to.equal(initialSellerBalance + sellerProceeds);
      expect(finalRoyaltyRecipientBalance).to.equal(initialRoyaltyRecipientBalance + royaltyAmount);
      expect(finalBuyerBalance).to.be.lessThan(initialBuyerBalance - price + gasUsed);
    });

    it("should revert when buying with insufficient payment", async function () {
      const nftAddress = await erc721.getAddress();
      await expect(marketplace.connect(buyer).buy(nftAddress, tokenId, { value: price - 1n }))
        .to.be.revertedWith("Insufficient payment");
    });

    it("should revert when buying non-listed NFT", async function () {
      const nftAddress = await erc721.getAddress();
      await expect(marketplace.connect(buyer).buy(nftAddress, 999n, { value: price }))
        .to.be.revertedWith("Not listed");
    });

    it("should refund excess payment", async function () {
      const nftAddress = await erc721.getAddress();
      const excessAmount = ethers.parseEther("0.5");
      const totalPayment = price + excessAmount;

      const initialBuyerBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await marketplace.connect(buyer).buy(nftAddress, tokenId, { value: totalPayment });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBuyerBalance = await ethers.provider.getBalance(buyer.address);

      // The buyer should have their balance reduced by the price plus gas, but with the excess refunded
      expect(finalBuyerBalance).to.be.closeTo(
        initialBuyerBalance - price - gasUsed + excessAmount,
        ethers.parseEther("0.01") // Allow small difference for gas estimation
      );
    });
  });
});