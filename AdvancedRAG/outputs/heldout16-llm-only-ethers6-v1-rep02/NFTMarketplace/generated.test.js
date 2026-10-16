const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTMarketplace", function () {
  let marketplace;
  let erc721;
  let owner;
  let seller;
  let buyer;
  let royaltyReceiver;
  const tokenId = 1n;
  const price = ethers.parseEther("1");
  const royaltyBps = 250n; // 2.5%

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
      await expect(marketplace.connect(owner).setRoyalty(await erc721.getAddress(), royaltyBps))
        .to.emit(marketplace, "RoyaltySet")
        .withArgs(await erc721.getAddress(), owner.address, royaltyBps);

      const royaltyInfo = await marketplace.royalties(await erc721.getAddress());
      expect(royaltyInfo.creator).to.equal(owner.address);
      expect(royaltyInfo.bps).to.equal(royaltyBps);
    });

    it("should revert if royalty exceeds 10%", async function () {
      await expect(marketplace.connect(owner).setRoyalty(await erc721.getAddress(), 1001n))
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
      // Set royalty
      await marketplace.connect(owner).setRoyalty(await erc721.getAddress(), royaltyBps);

      // Approve and list NFT
      await erc721.connect(seller).approve(await marketplace.getAddress(), tokenId);
      await marketplace.connect(seller).list(await erc721.getAddress(), tokenId, price);
    });

    it("should buy NFT correctly", async function () {
      const initialSellerBalance = await ethers.provider.getBalance(seller.address);
      const initialRoyaltyReceiverBalance = await ethers.provider.getBalance(royaltyReceiver.address);

      const tx = await marketplace.connect(buyer).buy(await erc721.getAddress(), tokenId, { value: price });
      const receipt = await tx.wait();

      // Check event
      await expect(tx)
        .to.emit(marketplace, "Sold")
        .withArgs(await erc721.getAddress(), tokenId, buyer.address, price);

      // Check NFT ownership
      expect(await erc721.ownerOf(tokenId)).to.equal(buyer.address);

      // Check listing is deactivated
      const listing = await marketplace.listings(await erc721.getAddress(), tokenId);
      expect(listing.active).to.be.false;

      // Check payments
      const royaltyAmount = (price * royaltyBps) / 10000n;
      const sellerProceeds = price - royaltyAmount;

      const finalSellerBalance = await ethers.provider.getBalance(seller.address);
      const finalRoyaltyReceiverBalance = await ethers.provider.getBalance(royaltyReceiver.address);

      // Approximate checks due to gas costs
      expect(finalSellerBalance).to.be.closeTo(initialSellerBalance + sellerProceeds, ethers.parseEther("0.01"));
      expect(finalRoyaltyReceiverBalance).to.be.closeTo(initialRoyaltyReceiverBalance + royaltyAmount, ethers.parseEther("0.01"));
    });

    it("should revert if not listed", async function () {
      await expect(marketplace.connect(buyer).buy(await erc721.getAddress(), 999n, { value: price }))
        .to.be.revertedWith("Not listed");
    });

    it("should revert if insufficient payment", async function () {
      await expect(marketplace.connect(buyer).buy(await erc721.getAddress(), tokenId, { value: ethers.parseEther("0.5") }))
        .to.be.revertedWith("Insufficient payment");
    });

    it("should handle excess payment with refund", async function () {
      const excessAmount = ethers.parseEther("0.5");
      const totalPayment = price + excessAmount;

      const initialBuyerBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await marketplace.connect(buyer).buy(await erc721.getAddress(), tokenId, { value: totalPayment });
      const receipt = await tx.wait();

      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBuyerBalance = await ethers.provider.getBalance(buyer.address);

      // Check buyer received refund (approximate due to gas costs)
      expect(finalBuyerBalance).to.be.closeTo(
        initialBuyerBalance - price - gasUsed,
        ethers.parseEther("0.01")
      );
    });
  });
});