const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const DURATION = 3600; // 1 hour
const TOKEN_URI = "ipfs://gembid/ruby.json";

// GemInput builder with sensible defaults.
function input(o = {}) {
  return {
    startingPrice: o.startingPrice ?? ethers.parseEther("1"),
    duration: o.duration ?? DURATION,
    buyNowPrice: o.buyNowPrice ?? 0n,
    royaltyBps: o.royaltyBps ?? 0,
    caratHundredths: o.caratHundredths ?? 150, // 1.50 ct
    cut: o.cut ?? 4, // Ideal
    color: o.color ?? 0, // D
    clarity: o.clarity ?? 2, // VVS1
    uri: o.uri ?? TOKEN_URI,
  };
}

describe("GemAuction v2", function () {
  async function deployFixture() {
    const [seller, alice, bob, carol] = await ethers.getSigners();
    const auction = await ethers.deployContract("GemAuction");
    return { auction, seller, alice, bob, carol };
  }

  async function withGemFixture() {
    const base = await deployFixture();
    await base.auction.connect(base.seller).createGem(input());
    return { ...base, gemId: 1n };
  }

  describe("ERC-721 / ERC-2981 interfaces", function () {
    it("exposes NFT name/symbol and supports ERC-2981", async function () {
      const { auction } = await loadFixture(deployFixture);
      expect(await auction.name()).to.equal("GemBid Gem");
      expect(await auction.symbol()).to.equal("GEM");
      expect(await auction.supportsInterface("0x2a55205a")).to.equal(true); // ERC-2981
      expect(await auction.supportsInterface("0x80ac58cd")).to.equal(true); // ERC-721
    });
  });

  describe("createGem", function () {
    it("assigns ids, mints into escrow, stores traits & royalty", async function () {
      const { auction, seller } = await loadFixture(deployFixture);
      expect(await auction.connect(seller).createGem.staticCall(input())).to.equal(1n);

      await auction.connect(seller).createGem(input({ royaltyBps: 500 }));
      const now = await time.latest();

      const gem = await auction.gems(1);
      expect(gem.seller).to.equal(seller.address);
      expect(gem.startingPrice).to.equal(ethers.parseEther("1"));
      expect(gem.buyNowPrice).to.equal(0n);
      expect(gem.endTime).to.equal(BigInt(now) + BigInt(DURATION));
      expect(gem.settled).to.equal(false);

      // NFT minted into escrow.
      expect(await auction.ownerOf(1)).to.equal(await auction.getAddress());
      expect(await auction.tokenURI(1)).to.equal(TOKEN_URI);

      // Traits stored on-chain.
      const t = await auction.traits(1);
      expect(t.caratHundredths).to.equal(150);
      expect(t.cut).to.equal(4);
      expect(t.color).to.equal(0);
      expect(t.clarity).to.equal(2);

      // ERC-2981 royalty: 5% of 1 ETH = 0.05 ETH, to the seller.
      const [receiver, amount] = await auction.royaltyInfo(1, ethers.parseEther("1"));
      expect(receiver).to.equal(seller.address);
      expect(amount).to.equal(ethers.parseEther("0.05"));
    });

    it("reverts on zero starting price / duration", async function () {
      const { auction, seller } = await loadFixture(deployFixture);
      await expect(auction.connect(seller).createGem(input({ startingPrice: 0 }))).to.be.revertedWithCustomError(
        auction,
        "InvalidStartingPrice"
      );
      await expect(auction.connect(seller).createGem(input({ duration: 0 }))).to.be.revertedWithCustomError(
        auction,
        "InvalidDuration"
      );
    });

    it("reverts when buyNowPrice <= startingPrice", async function () {
      const { auction, seller } = await loadFixture(deployFixture);
      await expect(
        auction.connect(seller).createGem(input({ startingPrice: ethers.parseEther("1"), buyNowPrice: ethers.parseEther("1") }))
      ).to.be.revertedWithCustomError(auction, "InvalidBuyNowPrice");
    });

    it("reverts when royalty exceeds the cap", async function () {
      const { auction, seller } = await loadFixture(deployFixture);
      await expect(auction.connect(seller).createGem(input({ royaltyBps: 1001 }))).to.be.revertedWithCustomError(
        auction,
        "RoyaltyTooHigh"
      );
    });
  });

  describe("placeBid + anti-snipe", function () {
    it("escrows a valid bid and rejects low / seller / closed bids", async function () {
      const { auction, seller, alice, bob } = await loadFixture(withGemFixture);

      await expect(auction.connect(alice).placeBid(1, { value: ethers.parseEther("0.5") })).to.be.revertedWithCustomError(
        auction,
        "BidNotHighEnough"
      );
      await expect(auction.connect(seller).placeBid(1, { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
        auction,
        "SellerCannotBid"
      );

      await auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") });
      await expect(auction.connect(bob).placeBid(1, { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
        auction,
        "BidNotHighEnough"
      );

      // outbid → previous bidder credited
      await auction.connect(bob).placeBid(1, { value: ethers.parseEther("1.5") });
      expect(await auction.pendingReturns(alice.address)).to.equal(ethers.parseEther("1"));
    });

    it("does NOT extend the deadline for an early bid", async function () {
      const { auction, alice } = await loadFixture(withGemFixture);
      const before = (await auction.gems(1)).endTime;
      await auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") });
      expect((await auction.gems(1)).endTime).to.equal(before);
    });

    it("extends the deadline for a bid inside the anti-snipe window", async function () {
      const { auction, alice } = await loadFixture(withGemFixture);
      const before = (await auction.gems(1)).endTime;
      // Move to 100s before the end (< 5-minute window).
      await time.increaseTo(Number(before) - 100);

      await expect(auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") })).to.emit(
        auction,
        "AuctionExtended"
      );
      expect((await auction.gems(1)).endTime).to.be.greaterThan(before);
    });

    it("rejects bids after the deadline", async function () {
      const { auction, alice } = await loadFixture(withGemFixture);
      await time.increase(DURATION + 1);
      await expect(auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
        auction,
        "BiddingClosed"
      );
    });
  });

  describe("buyNow", function () {
    async function withBuyNow() {
      const base = await deployFixture();
      await base.auction.connect(base.seller).createGem(
        input({ startingPrice: ethers.parseEther("1"), buyNowPrice: ethers.parseEther("5") })
      );
      return base;
    }

    it("instantly settles: pays seller, transfers NFT, marks sold", async function () {
      const { auction, seller, alice } = await withBuyNow();
      const price = ethers.parseEther("5");

      const tx = await auction.connect(alice).buyNow(1, { value: price });
      await expect(tx).to.emit(auction, "AuctionSettled").withArgs(1n, alice.address, price);
      await expect(tx).to.changeEtherBalances([alice, auction], [-price, price]);

      expect((await auction.gems(1)).settled).to.equal(true);
      expect(await auction.ownerOf(1)).to.equal(alice.address);
      expect(await auction.pendingReturns(seller.address)).to.equal(price);
    });

    it("refunds the current highest bidder on Buy Now", async function () {
      const { auction, alice, bob } = await withBuyNow();
      await auction.connect(alice).placeBid(1, { value: ethers.parseEther("2") });
      await auction.connect(bob).buyNow(1, { value: ethers.parseEther("5") });
      expect(await auction.pendingReturns(alice.address)).to.equal(ethers.parseEther("2"));
      expect(await auction.ownerOf(1)).to.equal(bob.address);
    });

    it("reverts on wrong payment, when disabled, for the seller, or once past price", async function () {
      const { auction, seller, alice, bob } = await withBuyNow();

      await expect(auction.connect(alice).buyNow(1, { value: ethers.parseEther("4") })).to.be.revertedWithCustomError(
        auction,
        "IncorrectPayment"
      );
      await expect(auction.connect(seller).buyNow(1, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "SellerCannotBid"
      );

      // A gem without a Buy Now price.
      await auction.connect(seller).createGem(input()); // gemId 2, buyNow disabled
      await expect(auction.connect(alice).buyNow(2, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "BuyNowUnavailable"
      );

      // Once a bid meets/exceeds Buy Now, it's no longer available.
      await auction.connect(bob).placeBid(1, { value: ethers.parseEther("5") });
      await expect(auction.connect(alice).buyNow(1, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "BuyNowUnavailable"
      );
    });

    it("reverts for a non-existent gem, after the deadline, and once settled", async function () {
      const { auction, seller, alice } = await withBuyNow();

      await expect(auction.connect(alice).buyNow(99, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "GemDoesNotExist"
      );

      // Settle via Buy Now, then Buy Now again → AlreadySettled.
      await auction.connect(alice).buyNow(1, { value: ethers.parseEther("5") });
      await expect(auction.connect(alice).buyNow(1, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "AlreadySettled"
      );

      // A fresh gem (gemId 2), past its deadline → BiddingClosed.
      await auction.connect(seller).createGem(input({ buyNowPrice: ethers.parseEther("5"), duration: 100 }));
      await time.increase(101);
      await expect(auction.connect(alice).buyNow(2, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "BiddingClosed"
      );
    });
  });

  describe("withdraw", function () {
    it("lets an outbid bidder pull funds; reverts when nothing owed", async function () {
      const { auction, alice, bob, carol } = await loadFixture(withGemFixture);
      await auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") });
      await auction.connect(bob).placeBid(1, { value: ethers.parseEther("1.5") });

      await expect(auction.connect(alice).withdraw()).to.changeEtherBalances(
        [alice, auction],
        [ethers.parseEther("1"), ethers.parseEther("-1")]
      );
      await expect(auction.connect(carol).withdraw()).to.be.revertedWithCustomError(auction, "NothingToWithdraw");
    });
  });

  describe("endAuction", function () {
    it("reverts early / non-existent / twice", async function () {
      const { auction, seller } = await loadFixture(withGemFixture);
      await expect(auction.connect(seller).endAuction(1)).to.be.revertedWithCustomError(auction, "TooEarlyToSettle");
      await expect(auction.connect(seller).endAuction(99)).to.be.revertedWithCustomError(auction, "GemDoesNotExist");
      await time.increase(DURATION + 1);
      await auction.connect(seller).endAuction(1);
      await expect(auction.connect(seller).endAuction(1)).to.be.revertedWithCustomError(auction, "AlreadySettled");
    });

    it("transfers the NFT to the winner and credits the seller", async function () {
      const { auction, seller, alice } = await loadFixture(withGemFixture);
      const bid = ethers.parseEther("2");
      await auction.connect(alice).placeBid(1, { value: bid });
      await time.increase(DURATION + 1);

      await expect(auction.connect(alice).endAuction(1)).to.emit(auction, "AuctionSettled").withArgs(1n, alice.address, bid);
      expect(await auction.ownerOf(1)).to.equal(alice.address);
      expect(await auction.pendingReturns(seller.address)).to.equal(bid);
    });

    it("returns the NFT to the seller when there were no bids", async function () {
      const { auction, seller } = await loadFixture(withGemFixture);
      await time.increase(DURATION + 1);
      await auction.connect(seller).endAuction(1);
      expect(await auction.ownerOf(1)).to.equal(seller.address);
    });
  });

  describe("security: pull-payment isolates a rejecting bidder", function () {
    it("a rejecting bidder's own withdraw reverts; the auction is unharmed", async function () {
      const { auction, seller, bob } = await loadFixture(withGemFixture);
      const rejector = await ethers.deployContract("BidRejector", [await auction.getAddress()]);
      await rejector.bid(1, { value: ethers.parseEther("1") });
      await auction.connect(bob).placeBid(1, { value: ethers.parseEther("1.5") });

      await expect(rejector.withdraw()).to.be.revertedWithCustomError(auction, "TransferFailed");

      await time.increase(DURATION + 1);
      await auction.connect(seller).endAuction(1);
      expect(await auction.ownerOf(1)).to.equal(bob.address);
    });
  });

  describe("invariant: solvency", function () {
    it("balance == sum(pendingReturns) + live highestBid; drains to 0 after settle+withdraws", async function () {
      const { auction, seller, alice, bob, carol } = await loadFixture(withGemFixture);
      await auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") });
      await auction.connect(bob).placeBid(1, { value: ethers.parseEther("1.5") });
      await auction.connect(carol).placeBid(1, { value: ethers.parseEther("2") });

      const bal = await ethers.provider.getBalance(await auction.getAddress());
      const owed =
        (await auction.pendingReturns(alice.address)) +
        (await auction.pendingReturns(bob.address)) +
        (await auction.pendingReturns(carol.address)) +
        (await auction.pendingReturns(seller.address));
      const [highestBid] = await auction.getHighestBid(1);
      expect(bal).to.equal(owed + highestBid);

      await time.increase(DURATION + 1);
      await auction.connect(seller).endAuction(1);
      await auction.connect(alice).withdraw();
      await auction.connect(bob).withdraw();
      await auction.connect(seller).withdraw();
      expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(0n);
    });
  });
});
