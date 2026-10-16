const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Marketplace", function () {
  let nft, market;
  let seller, buyer, stranger;
  const PRICE = ethers.parseEther("1");

  beforeEach(async function () {
    [seller, buyer, stranger] = await ethers.getSigners();

    const NFTForge = await ethers.getContractFactory("NFTForge");
    nft = await NFTForge.deploy();
    await nft.waitForDeployment();

    const Marketplace = await ethers.getContractFactory("Marketplace");
    market = await Marketplace.deploy();
    await market.waitForDeployment();

    await nft.mint(seller.address, "ipfs://item-0");
  });

  async function approveAndList() {
    await nft.connect(seller).approve(await market.getAddress(), 0);
    await market.connect(seller).list(await nft.getAddress(), 0, PRICE);
  }

  describe("list", function () {
    it("stores the listing and emits Listed", async function () {
      await nft.connect(seller).approve(await market.getAddress(), 0);
      await expect(market.connect(seller).list(await nft.getAddress(), 0, PRICE))
        .to.emit(market, "Listed")
        .withArgs(await nft.getAddress(), 0, seller.address, PRICE);

      const l = await market.getListing(await nft.getAddress(), 0);
      expect(l.seller).to.equal(seller.address);
      expect(l.price).to.equal(PRICE);
      expect(l.active).to.equal(true);
    });

    it("reverts when caller is not the owner", async function () {
      await nft.connect(seller).approve(await market.getAddress(), 0);
      await expect(
        market.connect(stranger).list(await nft.getAddress(), 0, PRICE)
      ).to.be.revertedWithCustomError(market, "NotOwner");
    });

    it("reverts when marketplace is not approved", async function () {
      await expect(
        market.connect(seller).list(await nft.getAddress(), 0, PRICE)
      ).to.be.revertedWithCustomError(market, "NotApproved");
    });

    it("reverts on zero price", async function () {
      await nft.connect(seller).approve(await market.getAddress(), 0);
      await expect(
        market.connect(seller).list(await nft.getAddress(), 0, 0)
      ).to.be.revertedWithCustomError(market, "PriceZero");
    });

    it("accepts setApprovalForAll instead of single-token approval", async function () {
      await nft.connect(seller).setApprovalForAll(await market.getAddress(), true);
      await expect(market.connect(seller).list(await nft.getAddress(), 0, PRICE)).to.emit(
        market,
        "Listed"
      );
    });
  });

  describe("cancel", function () {
    it("clears the listing and emits Cancelled", async function () {
      await approveAndList();
      await expect(market.connect(seller).cancel(await nft.getAddress(), 0))
        .to.emit(market, "Cancelled")
        .withArgs(await nft.getAddress(), 0, seller.address);

      const l = await market.getListing(await nft.getAddress(), 0);
      expect(l.active).to.equal(false);
    });

    it("reverts when not listed", async function () {
      await expect(
        market.connect(seller).cancel(await nft.getAddress(), 0)
      ).to.be.revertedWithCustomError(market, "NotListed");
    });

    it("reverts when caller is not the seller", async function () {
      await approveAndList();
      await expect(
        market.connect(stranger).cancel(await nft.getAddress(), 0)
      ).to.be.revertedWithCustomError(market, "NotSeller");
    });
  });

  describe("buy", function () {
    it("transfers NFT, pays seller, clears listing, emits Bought", async function () {
      await approveAndList();

      const sellerBalBefore = await ethers.provider.getBalance(seller.address);

      await expect(
        market.connect(buyer).buy(await nft.getAddress(), 0, { value: PRICE })
      )
        .to.emit(market, "Bought")
        .withArgs(await nft.getAddress(), 0, buyer.address, seller.address, PRICE);

      expect(await nft.ownerOf(0)).to.equal(buyer.address);

      const sellerBalAfter = await ethers.provider.getBalance(seller.address);
      expect(sellerBalAfter - sellerBalBefore).to.equal(PRICE);

      const l = await market.getListing(await nft.getAddress(), 0);
      expect(l.active).to.equal(false);
    });

    it("reverts on wrong price", async function () {
      await approveAndList();
      await expect(
        market.connect(buyer).buy(await nft.getAddress(), 0, { value: PRICE - 1n })
      ).to.be.revertedWithCustomError(market, "WrongPrice");
    });

    it("reverts when not listed", async function () {
      await expect(
        market.connect(buyer).buy(await nft.getAddress(), 0, { value: PRICE })
      ).to.be.revertedWithCustomError(market, "NotListed");
    });

    it("cannot be bought twice", async function () {
      await approveAndList();
      await market.connect(buyer).buy(await nft.getAddress(), 0, { value: PRICE });
      await expect(
        market.connect(stranger).buy(await nft.getAddress(), 0, { value: PRICE })
      ).to.be.revertedWithCustomError(market, "NotListed");
    });
  });
});
