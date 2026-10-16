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

    // Mint NFT to seller
    await nft.mint(seller.address, tokenId);

    // Deploy NFTMarketplace
    const NFTMarketplace = await ethers.getContractFactory("NFTMarketplace");
    marketplace = await NFTMarketplace.deploy();
    await marketplace.waitForDeployment();

    // Approve marketplace to transfer NFT
    await nft.connect(seller).approve(await marketplace.getAddress(), tokenId);
  });

  describe("setRoyalty", function () {
    it("should set royalty correctly", async function () {
      await expect(marketplace.connect(royaltyRecipient).setRoyalty(await nft.getAddress(), royaltyBps))
        .to.emit(marketplace, "RoyaltySet")
        .withArgs(await nft.getAddress(), royaltyRecipient.address, royaltyBps);

      const royaltyInfo = await marketplace.royalties(await nft.getAddress());
      expect(royaltyInfo.creator).to.equal(royaltyRecipient.address);
      expect(royaltyInfo.bps).to.equal(royaltyBps);
    });

    it("should revert when royalty exceeds maximum", async function () {
      await expect(marketplace.connect(royaltyRecipient).setRoyalty(await nft.getAddress(), 1001n))
        .to.be.revertedWith("Max 10%");
    });
  });

  describe("list", function () {
    it("should list NFT correctly", async function () {
      await expect(marketplace.connect(seller).list(await nft.getAddress(), tokenId, price))
        .to.emit(marketplace, "Listed")
        .withArgs(await nft.getAddress(), tokenId, price);

      const listing = await marketplace.listings(await nft.getAddress(), tokenId);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.price).to.equal(price);
      expect(listing.active).to.be.true;
    });

    it("should revert when not owner", async function () {
      await expect(marketplace.connect(buyer).list(await nft.getAddress(), tokenId, price))
        .to.be.revertedWith("Not owner");
    });

    it("should revert when not approved", async function () {
      // Revoke approval
      await nft.connect(seller).approve(ethers.ZeroAddress, tokenId);
      await expect(marketplace.connect(seller).list(await nft.getAddress(), tokenId, price))
        .to.be.revertedWith("Not approved");
    });
  });

  describe("buy", function () {
    beforeEach(async function () {
      // Set royalty
      await marketplace.connect(royaltyRecipient).setRoyalty(await nft.getAddress(), royaltyBps);
      // List NFT
      await marketplace.connect(seller).list(await nft.getAddress(), tokenId, price);
    });

    it("should buy NFT correctly with royalty", async function () {
      const initialSellerBalance = await ethers.provider.getBalance(seller.address);
      const initialRoyaltyBalance = await ethers.provider.getBalance(royaltyRecipient.address);

      const tx = await marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price });
      const receipt = await tx.wait();

      // Calculate gas cost
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      // Verify balances
      const finalSellerBalance = await ethers.provider.getBalance(seller.address);
      const finalRoyaltyBalance = await ethers.provider.getBalance(royaltyRecipient.address);

      // Calculate expected amounts
      const royaltyAmount = (price * royaltyBps) / 10000n;
      const sellerProceeds = price - royaltyAmount;

      expect(finalSellerBalance).to.equal(initialSellerBalance + sellerProceeds - gasUsed);
      expect(finalRoyaltyBalance).to.equal(initialRoyaltyBalance + royaltyAmount);

      // Verify NFT ownership
      expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);

      // Verify listing is deactivated
      const listing = await marketplace.listings(await nft.getAddress(), tokenId);
      expect(listing.active).to.be.false;

      // Verify Sold event
      await expect(tx)
        .to.emit(marketplace, "Sold")
        .withArgs(await nft.getAddress(), tokenId, buyer.address, price);
    });

    it("should handle excess payment correctly", async function () {
      const excessAmount = ethers.parseEther("0.1");
      const totalPayment = price + excessAmount;

      const initialBuyerBalance = await ethers.provider.getBalance(buyer.address);
      const initialSellerBalance = await ethers.provider.getBalance(seller.address);

      const tx = await marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: totalPayment });
      const receipt = await tx.wait();

      // Calculate gas cost
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      // Verify balances
      const finalBuyerBalance = await ethers.provider.getBalance(buyer.address);
      const finalSellerBalance = await ethers.provider.getBalance(seller.address);

      // Calculate expected amounts
      const royaltyAmount = (price * royaltyBps) / 10000n;
      const sellerProceeds = price - royaltyAmount;

      expect(finalSellerBalance).to.equal(initialSellerBalance + sellerProceeds);
      expect(finalBuyerBalance).to.be.lessThan(initialBuyerBalance - price - gasUsed);
    });

    it("should revert when not listed", async function () {
      // Deactivate listing
      await marketplace.connect(seller).list(await nft.getAddress(), tokenId, price);
      await marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price });

      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price }))
        .to.be.revertedWith("Not listed");
    });

    it("should revert when insufficient payment", async function () {
      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price - 1n }))
        .to.be.revertedWith("Insufficient payment");
    });

    it("should revert when royalty transfer fails", async function () {
      // Deploy a contract that will revert on receive
      const FailingContract = await ethers.getContractFactory("BenchmarkTarget");
      const failingContract = await FailingContract.deploy();
      await failingContract.waitForDeployment();

      // Set royalty to failing contract
      await marketplace.connect(failingContract).setRoyalty(await nft.getAddress(), royaltyBps);

      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price }))
        .to.be.revertedWith("Royalty transfer failed");
    });

    it("should revert when seller transfer fails", async function () {
      // Deploy a contract that will revert on receive
      const FailingContract = await ethers.getContractFactory("BenchmarkTarget");
      const failingContract = await FailingContract.deploy();
      await failingContract.waitForDeployment();

      // List NFT with failing contract as seller
      await nft.connect(seller).transferFrom(seller.address, failingContract.address, tokenId);
      await nft.connect(failingContract).approve(await marketplace.getAddress(), tokenId);
      await marketplace.connect(failingContract).list(await nft.getAddress(), tokenId, price);

      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price }))
        .to.be.revertedWith("Seller transfer failed");
    });

    it("should revert when refund fails", async function () {
      // Deploy a contract that will revert on receive
      const FailingContract = await ethers.getContractFactory("BenchmarkTarget");
      const failingContract = await FailingContract.deploy();
      await failingContract.waitForDeployment();

      // Buy with excess payment from failing contract
      await expect(marketplace.connect(failingContract).buy(await nft.getAddress(), tokenId, { value: price + ethers.parseEther("0.1") }))
        .to.be.revertedWith("Refund failed");
    });
  });
});