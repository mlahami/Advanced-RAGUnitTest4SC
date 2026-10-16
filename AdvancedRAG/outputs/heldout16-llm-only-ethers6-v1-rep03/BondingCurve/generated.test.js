const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BondingCurve", function () {
  let bondingCurve;
  let owner;
  let buyer;
  let seller;

  const slope = ethers.parseEther("1"); // 1 wei per token^2
  const basePrice = ethers.parseEther("1"); // 1 wei per token at zero supply
  const sellFeeBps = 100n; // 1% fee

  beforeEach(async function () {
    [owner, buyer, seller] = await ethers.getSigners();

    const BondingCurve = await ethers.getContractFactory("BondingCurve");
    bondingCurve = await BondingCurve.deploy(slope, basePrice, sellFeeBps);
    await bondingCurve.waitForDeployment();

    // Fund seller with some tokens
    const initialBuyAmount = ethers.parseEther("10");
    await bondingCurve.connect(buyer).buy(10n, { value: initialBuyAmount });
    await bondingCurve.connect(buyer).transfer(seller.address, 5n);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await bondingCurve.owner()).to.equal(owner.address);
    });

    it("Should set the correct parameters", async function () {
      expect(await bondingCurve.slope()).to.equal(slope);
      expect(await bondingCurve.basePrice()).to.equal(basePrice);
      expect(await bondingCurve.sellFeeBps()).to.equal(sellFeeBps);
    });

    it("Should revert with too high fee", async function () {
      const BondingCurve = await ethers.getContractFactory("BondingCurve");
      await expect(BondingCurve.deploy(slope, basePrice, 1001n)).to.be.revertedWith("Fee too high");
    });
  });

  describe("Buy", function () {
    it("Should mint tokens and emit events", async function () {
      const tokenAmount = 5n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);

      await expect(bondingCurve.connect(buyer).buy(tokenAmount, { value: cost }))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(ethers.ZeroAddress, buyer.address, tokenAmount)
        .and.to.emit(bondingCurve, "Buy")
        .withArgs(buyer.address, tokenAmount, cost);

      expect(await bondingCurve.balanceOf(buyer.address)).to.equal(15n); // 10 initial + 5 bought
      expect(await bondingCurve.totalSupply()).to.equal(15n);
    });

    it("Should refund excess ETH", async function () {
      const tokenAmount = 5n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      const excess = ethers.parseEther("1");

      const initialBalance = await ethers.provider.getBalance(buyer.address);
      const tx = await bondingCurve.connect(buyer).buy(tokenAmount, { value: cost + excess });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(buyer.address);

      expect(finalBalance).to.equal(initialBalance - cost - gasUsed + excess);
    });

    it("Should revert with zero amount", async function () {
      await expect(bondingCurve.connect(buyer).buy(0n)).to.be.revertedWith("Zero amount");
    });

    it("Should revert with insufficient ETH", async function () {
      const tokenAmount = 5n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      await expect(bondingCurve.connect(buyer).buy(tokenAmount, { value: cost - 1n })).to.be.revertedWith("Insufficient ETH");
    });
  });

  describe("Sell", function () {
    it("Should burn tokens and emit events", async function () {
      const tokenAmount = 3n;
      const ethReturned = await bondingCurve.quoteSell(tokenAmount);

      await expect(bondingCurve.connect(seller).sell(tokenAmount))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(seller.address, ethers.ZeroAddress, tokenAmount)
        .and.to.emit(bondingCurve, "Sell")
        .withArgs(seller.address, tokenAmount, ethReturned);

      expect(await bondingCurve.balanceOf(seller.address)).to.equal(2n); // 5 initial - 3 sold
      expect(await bondingCurve.totalSupply()).to.equal(12n); // 15 initial - 3 sold
    });

    it("Should transfer ETH to seller", async function () {
      const tokenAmount = 3n;
      const ethReturned = await bondingCurve.quoteSell(tokenAmount);

      const initialBalance = await ethers.provider.getBalance(seller.address);
      const tx = await bondingCurve.connect(seller).sell(tokenAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(seller.address);

      expect(finalBalance).to.equal(initialBalance + ethReturned - gasUsed);
    });

    it("Should revert with zero amount", async function () {
      await expect(bondingCurve.connect(seller).sell(0n)).to.be.revertedWith("Zero amount");
    });

    it("Should revert with insufficient balance", async function () {
      await expect(bondingCurve.connect(seller).sell(10n)).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Price Quotes", function () {
    it("Should return correct spot price", async function () {
      const initialPrice = await bondingCurve.spotPrice();
      expect(initialPrice).to.equal(basePrice);

      // Buy some tokens to increase supply
      await bondingCurve.connect(buyer).buy(5n, { value: await bondingCurve.quoteBuy(5n) });

      const newPrice = await bondingCurve.spotPrice();
      const expectedPrice = basePrice + (slope * 10n) / ethers.parseEther("1"); // 10 tokens bought
      expect(newPrice).to.equal(expectedPrice);
    });

    it("Should return correct buy quote", async function () {
      const amount = 5n;
      const quote = await bondingCurve.quoteBuy(amount);
      const expectedQuote = basePrice * amount + (slope * (2n * 10n * amount + amount * amount)) / (2n * ethers.parseEther("1"));
      expect(quote).to.equal(expectedQuote);
    });

    it("Should return correct sell quote", async function () {
      const amount = 3n;
      const gross = await bondingCurve.quoteBuy(amount);
      const fee = (gross * sellFeeBps) / 10_000n;
      const net = gross - fee;

      const quote = await bondingCurve.quoteSell(amount);
      expect(quote).to.equal(net);
    });

    it("Should return zero for sell quote exceeding supply", async function () {
      const quote = await bondingCurve.quoteSell(100n);
      expect(quote).to.equal(0n);
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to collect fees", async function () {
      // Buy and sell to generate fees
      const buyAmount = 5n;
      const buyCost = await bondingCurve.quoteBuy(buyAmount);
      await bondingCurve.connect(buyer).buy(buyAmount, { value: buyCost });

      const sellAmount = 3n;
      await bondingCurve.connect(buyer).sell(sellAmount);

      const initialBalance = await ethers.provider.getBalance(owner.address);
      const tx = await bondingCurve.connect(owner).collectFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(owner.address);

      expect(finalBalance).to.be.gt(initialBalance - gasUsed);
    });

    it("Should revert if not owner", async function () {
      await expect(bondingCurve.connect(buyer).collectFees()).to.be.revertedWith("Not owner");
    });

    it("Should revert if no fees", async function () {
      await expect(bondingCurve.connect(owner).collectFees()).to.be.revertedWith("No fees");
    });
  });
});