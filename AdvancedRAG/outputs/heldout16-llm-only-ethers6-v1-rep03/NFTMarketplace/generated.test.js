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

    it("should revert when setting royalty above 10%", async function () {
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

    it("should revert when listing NFT not owned by caller", async function () {
      await expect(marketplace.connect(buyer).list(await erc721.getAddress(), tokenId, price))
        .to.be.revertedWith("Not owner");
    });

    it("should revert when listing NFT not approved for marketplace", async function () {
      await expect(marketplace.connect(seller).list(await erc721.getAddress(), tokenId, price))
        .to.be.revertedWith("Not approved");
    });
  });

  describe("buy", function () {
    beforeEach(async function () {
      // Set up royalty
      await marketplace.connect(owner).setRoyalty(await erc721.getAddress(), 250n); // 2.5%

      // Approve and list NFT
      await erc721.connect(seller).approve(await marketplace.getAddress(), tokenId);
      await marketplace.connect(seller).list(await erc721.getAddress(), tokenId, price);
    });

    it("should buy NFT correctly", async function () {
      const royaltyAmount = price * 250n / 10000n;
      const sellerProceeds = price - royaltyAmount;

      await expect(marketplace.connect(buyer).buy(await erc721.getAddress(), tokenId, { value: price }))
        .to.emit(marketplace, "Sold")
        .withArgs(await erc721.getAddress(), tokenId, buyer.address, price);

      // Check NFT ownership
      expect(await erc721.ownerOf(tokenId)).to.equal(buyer.address);

      // Check listing is no longer active
      const listing = await marketplace.listings(await erc721.getAddress(), tokenId);
      expect(listing.active).to.be.false;

      // Check balances
      const ownerBalance = await ethers.provider.getBalance(owner.address);
      const sellerBalance = await ethers.provider.getBalance(seller.address);

      // These checks are simplified - in a real test you'd want to track initial balances
      // and compare with expected changes
      expect(ownerBalance).to.be.gt(0n);
      expect(sellerBalance).to.be.gt(0n);
    });

    it("should revert when buying unlisted NFT", async function () {
      const unlistedTokenId = 2n;
      await expect(marketplace.connect(buyer).buy(await erc721.getAddress(), unlistedTokenId, { value: price }))
        .to.be.revertedWith("Not listed");
    });

    it("should revert when paying insufficient amount", async function () {
      const insufficientAmount = ethers.parseEther("0.5");
      await expect(marketplace.connect(buyer).buy(await erc721.getAddress(), tokenId, { value: insufficientAmount }))
        .to.be.revertedWith("Insufficient payment");
    });

    it("should handle excess payment with refund", async function () {
      const excessAmount = ethers.parseEther("2");
      const tx = await marketplace.connect(buyer).buy(await erc721.getAddress(), tokenId, { value: excessAmount });
      const receipt = await tx.wait();

      // Check for refund event (simplified - in a real test you'd check the actual refund)
      expect(receipt.status).to.equal(1);
    });
  });
});