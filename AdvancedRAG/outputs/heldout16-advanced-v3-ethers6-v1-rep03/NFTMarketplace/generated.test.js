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
      await expect(marketplace.connect(owner).setRoyalty(await nft.getAddress(), royaltyBps))
        .to.emit(marketplace, "RoyaltySet")
        .withArgs(await nft.getAddress(), owner.address, royaltyBps);

      const royaltyInfo = await marketplace.royalties(await nft.getAddress());
      expect(royaltyInfo.creator).to.equal(owner.address);
      expect(royaltyInfo.bps).to.equal(royaltyBps);
    });

    it("should revert when setting royalty above 10%", async function () {
      await expect(marketplace.connect(owner).setRoyalty(await nft.getAddress(), 1001n))
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

    it("should revert when listing NFT not owned by caller", async function () {
      await expect(marketplace.connect(buyer).list(await nft.getAddress(), tokenId, price))
        .to.be.revertedWith("Not owner");
    });

    it("should revert when listing NFT not approved for marketplace", async function () {
      // Revoke approval
      await nft.connect(seller).approve(ethers.ZeroAddress, tokenId);

      await expect(marketplace.connect(seller).list(await nft.getAddress(), tokenId, price))
        .to.be.revertedWith("Not approved");
    });
  });

  describe("buy", function () {
    beforeEach(async function () {
      // Set royalty
      await marketplace.connect(owner).setRoyalty(await nft.getAddress(), royaltyBps);

      // List NFT
      await marketplace.connect(seller).list(await nft.getAddress(), tokenId, price);
    });

    it("should buy NFT correctly with royalty", async function () {
      const initialSellerBalance = await ethers.provider.getBalance(seller.address);
      const initialRoyaltyRecipientBalance = await ethers.provider.getBalance(owner.address);

      const tx = await marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price });
      const receipt = await tx.wait();

      // Calculate gas cost
      const gasUsed = receipt.gasUsed;
      const gasPrice = receipt.gasPrice;
      const gasCost = gasUsed * gasPrice;

      // Calculate expected amounts
      const royaltyAmount = (price * royaltyBps) / 10000n;
      const sellerProceeds = price - royaltyAmount;

      // Check balances
      const finalSellerBalance = await ethers.provider.getBalance(seller.address);
      const finalRoyaltyRecipientBalance = await ethers.provider.getBalance(owner.address);

      expect(finalSellerBalance).to.equal(initialSellerBalance + sellerProceeds - gasCost);
      expect(finalRoyaltyRecipientBalance).to.equal(initialRoyaltyRecipientBalance + royaltyAmount);

      // Check NFT ownership
      expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);

      // Check listing is no longer active
      const listing = await marketplace.listings(await nft.getAddress(), tokenId);
      expect(listing.active).to.be.false;

      // Check Sold event
      await expect(tx)
        .to.emit(marketplace, "Sold")
        .withArgs(await nft.getAddress(), tokenId, buyer.address, price);
    });

    it("should buy NFT correctly without royalty when bps is 0", async function () {
      // Set royalty to 0
      await marketplace.connect(owner).setRoyalty(await nft.getAddress(), 0n);

      const initialSellerBalance = await ethers.provider.getBalance(seller.address);

      const tx = await marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price });
      const receipt = await tx.wait();

      // Calculate gas cost
      const gasUsed = receipt.gasUsed;
      const gasPrice = receipt.gasPrice;
      const gasCost = gasUsed * gasPrice;

      // Check balances
      const finalSellerBalance = await ethers.provider.getBalance(seller.address);

      expect(finalSellerBalance).to.equal(initialSellerBalance + price - gasCost);

      // Check NFT ownership
      expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
    });

    it("should refund excess payment", async function () {
      const excessPayment = ethers.parseEther("2");
      const initialBuyerBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: excessPayment });
      const receipt = await tx.wait();

      // Calculate gas cost
      const gasUsed = receipt.gasUsed;
      const gasPrice = receipt.gasPrice;
      const gasCost = gasUsed * gasPrice;

      // Check buyer balance
      const finalBuyerBalance = await ethers.provider.getBalance(buyer.address);
      expect(finalBuyerBalance).to.be.closeTo(initialBuyerBalance - price - gasCost, ethers.parseEther("0.001"));
    });

    it("should revert when buying unlisted NFT", async function () {
      // Create a new token that hasn't been listed
      const newTokenId = 2n;
      await nft.mint(seller.address, newTokenId);
      await nft.connect(seller).approve(await marketplace.getAddress(), newTokenId);

      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), newTokenId, { value: price }))
        .to.be.revertedWith("Not listed");
    });

    it("should revert when paying insufficient amount", async function () {
      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price - 1n }))
        .to.be.revertedWith("Insufficient payment");
    });

    it("should revert when royalty transfer fails", async function () {
      // Set royalty to 100% to force a failure (since the recipient is a contract that doesn't accept ETH)
      await marketplace.connect(owner).setRoyalty(await nft.getAddress(), 10000n);

      // Deploy a contract that doesn't accept ETH
      const NonPayableRecipient = await ethers.getContractFactory("BenchmarkTarget");
      const nonPayableRecipient = await NonPayableRecipient.deploy();
      await nonPayableRecipient.waitForDeployment();

      // Set royalty to the non-payable recipient
      await marketplace.connect(nonPayableRecipient).setRoyalty(await nft.getAddress(), 10000n);

      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price }))
        .to.be.revertedWith("Royalty transfer failed");
    });

    it("should revert when seller transfer fails", async function () {
      // Deploy a contract that doesn't accept ETH
      const NonPayableRecipient = await ethers.getContractFactory("BenchmarkTarget");
      const nonPayableRecipient = await NonPayableRecipient.deploy();
      await nonPayableRecipient.waitForDeployment();

      // List NFT with non-payable recipient as seller
      await nft.connect(seller).transferFrom(seller.address, nonPayableRecipient.address, tokenId);
      await nft.connect(nonPayableRecipient).approve(await marketplace.getAddress(), tokenId);
      await marketplace.connect(nonPayableRecipient).list(await nft.getAddress(), tokenId, price);

      await expect(marketplace.connect(buyer).buy(await nft.getAddress(), tokenId, { value: price }))
        .to.be.revertedWith("Seller transfer failed");
    });

    it("should revert when refund fails", async function () {
      // Deploy a contract that doesn't accept ETH
      const NonPayableRecipient = await ethers.getContractFactory("BenchmarkTarget");
      const nonPayableRecipient = await NonPayableRecipient.deploy();
      await nonPayableRecipient.waitForDeployment();

      // Send transaction with excess payment from non-payable recipient
      await expect(marketplace.connect(nonPayableRecipient).buy(await nft.getAddress(), tokenId, { value: ethers.parseEther("2") }))
        .to.be.revertedWith("Refund failed");
    });
  });
});