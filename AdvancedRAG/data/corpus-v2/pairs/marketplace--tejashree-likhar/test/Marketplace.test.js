const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Marketplace", function () {
  let marketplace, seller, buyer, other;

  beforeEach(async function () {
    [seller, buyer, other] = await ethers.getSigners();
    const Marketplace = await ethers.getContractFactory("Marketplace");
    marketplace = await Marketplace.deploy();
    await marketplace.waitForDeployment();
  });

  it("lists an item with correct details", async function () {
    await expect(marketplace.connect(seller).listItem("Bike", "Mountain bike, lightly used", ethers.parseEther("1")))
      .to.emit(marketplace, "ItemListed")
      .withArgs(1n, seller.address, "Bike", ethers.parseEther("1"));

    const item = await marketplace.getItem(1);
    expect(item.title).to.equal("Bike");
    expect(item.seller).to.equal(seller.address);
    expect(item.owner).to.equal(seller.address);
    expect(item.price).to.equal(ethers.parseEther("1"));
    expect(item.active).to.equal(true);
    expect(item.sold).to.equal(false);
  });

  it("rejects listing with zero price or empty title", async function () {
    await expect(marketplace.listItem("Bike", "desc", 0)).to.be.revertedWith(
      "Marketplace: price must be greater than zero"
    );
    await expect(marketplace.listItem("", "desc", 100)).to.be.revertedWith("Marketplace: title required");
  });

  it("lets a buyer purchase an item with exact ETH and transfers ownership + funds", async function () {
    const price = ethers.parseEther("2");
    await marketplace.connect(seller).listItem("Laptop", "16GB RAM", price);

    const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

    await expect(marketplace.connect(buyer).buyItem(1, { value: price }))
      .to.emit(marketplace, "ItemPurchased")
      .withArgs(1n, buyer.address, seller.address, price);

    const item = await marketplace.getItem(1);
    expect(item.owner).to.equal(buyer.address);
    expect(item.sold).to.equal(true);
    expect(item.active).to.equal(false);

    const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
    expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(price);
  });

  it("rejects purchase with incorrect ETH amount", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Phone", "desc", price);
    await expect(
      marketplace.connect(buyer).buyItem(1, { value: ethers.parseEther("0.5") })
    ).to.be.revertedWith("Marketplace: incorrect ETH amount sent");
  });

  it("prevents the seller from buying their own item", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Phone", "desc", price);
    await expect(
      marketplace.connect(seller).buyItem(1, { value: price })
    ).to.be.revertedWith("Marketplace: seller cannot buy own item");
  });

  it("prevents double purchase of the same item", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Phone", "desc", price);
    await marketplace.connect(buyer).buyItem(1, { value: price });
    await expect(
      marketplace.connect(other).buyItem(1, { value: price })
    ).to.be.revertedWith("Marketplace: item not available");
  });

  it("allows only verified buyers to leave a review, once each", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Phone", "desc", price);

    // Non-buyer cannot review
    await expect(
      marketplace.connect(other).leaveReview(1, 5, "Great seller!")
    ).to.be.revertedWith("Marketplace: only verified buyers can review");

    await marketplace.connect(buyer).buyItem(1, { value: price });

    await expect(marketplace.connect(buyer).leaveReview(1, 5, "Great seller!"))
      .to.emit(marketplace, "ReviewSubmitted")
      .withArgs(seller.address, buyer.address, 1n, 5);

    // Can't review the same purchase twice
    await expect(
      marketplace.connect(buyer).leaveReview(1, 4, "Trying again")
    ).to.be.revertedWith("Marketplace: purchase already reviewed");

    const [avg, count] = await marketplace.getSellerRating(seller.address);
    expect(count).to.equal(1n);
    expect(avg).to.equal(500n); // 5.00 stars scaled by 100
  });

  it("rejects out-of-range ratings", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Phone", "desc", price);
    await marketplace.connect(buyer).buyItem(1, { value: price });
    await expect(marketplace.connect(buyer).leaveReview(1, 0, "bad")).to.be.revertedWith(
      "Marketplace: rating must be between 1 and 5"
    );
    await expect(marketplace.connect(buyer).leaveReview(1, 6, "bad")).to.be.revertedWith(
      "Marketplace: rating must be between 1 and 5"
    );
  });

  it("computes correct average rating across multiple reviews", async function () {
    const price = ethers.parseEther("1");

    await marketplace.connect(seller).listItem("Item A", "desc", price);
    await marketplace.connect(buyer).buyItem(1, { value: price });
    await marketplace.connect(buyer).leaveReview(1, 5, "Excellent");

    await marketplace.connect(seller).listItem("Item B", "desc", price);
    await marketplace.connect(other).buyItem(2, { value: price });
    await marketplace.connect(other).leaveReview(2, 3, "It was okay");

    const [avg, count] = await marketplace.getSellerRating(seller.address);
    expect(count).to.equal(2n);
    expect(avg).to.equal(400n); // (5+3)/2 = 4.00 -> 400
  });

  it("supports relisting by the new owner and tracks seller correctly for reviews", async function () {
    const price = ethers.parseEther("1");
    await marketplace.connect(seller).listItem("Guitar", "Acoustic", price);
    await marketplace.connect(buyer).buyItem(1, { value: price });

    // Buyer is now owner and relists at a new price
    const newPrice = ethers.parseEther("1.5");
    await expect(marketplace.connect(buyer).relistItem(1, newPrice))
      .to.emit(marketplace, "ItemRelisted")
      .withArgs(1n, buyer.address, newPrice);

    const item = await marketplace.getItem(1);
    expect(item.seller).to.equal(buyer.address);
    expect(item.active).to.equal(true);
    expect(item.sold).to.equal(false);

    // `other` buys from the new seller (buyer)
    await marketplace.connect(other).buyItem(1, { value: newPrice });
    await marketplace.connect(other).leaveReview(1, 4, "Good second-hand seller too");

    const [origSellerAvg, origSellerCount] = await marketplace.getSellerRating(seller.address);
    const [newSellerAvg, newSellerCount] = await marketplace.getSellerRating(buyer.address);

    expect(origSellerCount).to.equal(0n); // original seller never got reviewed here
    expect(newSellerCount).to.equal(1n);
    expect(newSellerAvg).to.equal(400n);
  });

  it("lets the owner delist an active item", async function () {
    await marketplace.connect(seller).listItem("Desk", "desc", ethers.parseEther("1"));
    await expect(marketplace.connect(seller).delistItem(1))
      .to.emit(marketplace, "ItemDelisted")
      .withArgs(1n, seller.address);

    const item = await marketplace.getItem(1);
    expect(item.active).to.equal(false);

    await expect(
      marketplace.connect(buyer).buyItem(1, { value: ethers.parseEther("1") })
    ).to.be.revertedWith("Marketplace: item not available");
  });

  it("tracks all listed item ids", async function () {
    await marketplace.connect(seller).listItem("A", "d", ethers.parseEther("1"));
    await marketplace.connect(seller).listItem("B", "d", ethers.parseEther("1"));
    const ids = await marketplace.getAllItemIds();
    expect(ids.map((i) => i.toString())).to.deep.equal(["1", "2"]);
    expect(await marketplace.getTotalItems()).to.equal(2n);
  });
});
