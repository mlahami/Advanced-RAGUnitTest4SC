const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BondingCurve", function () {
  let bondingCurve;
  let owner;
  let buyer;
  let seller;

  const SLOPE = ethers.parseEther("0.001"); // 0.001 ETH per token^2
  const BASE_PRICE = ethers.parseEther("0.1"); // 0.1 ETH per token at zero supply
  const SELL_FEE_BPS = 100n; // 1% fee on sells

  beforeEach(async function () {
    [owner, buyer, seller] = await ethers.getSigners();

    const BondingCurve = await ethers.getContractFactory("BondingCurve");
    bondingCurve = await BondingCurve.deploy(SLOPE, BASE_PRICE, SELL_FEE_BPS);
    await bondingCurve.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await bondingCurve.owner()).to.equal(owner.address);
    });

    it("Should set the correct immutable parameters", async function () {
      expect(await bondingCurve.slope()).to.equal(SLOPE);
      expect(await bondingCurve.basePrice()).to.equal(BASE_PRICE);
      expect(await bondingCurve.sellFeeBps()).to.equal(SELL_FEE_BPS);
    });

    it("Should revert if fee is too high", async function () {
      const BondingCurve = await ethers.getContractFactory("BondingCurve");
      await expect(BondingCurve.deploy(SLOPE, BASE_PRICE, 1001n))
        .to.be.revertedWith("Fee too high");
    });
  });

  describe("Buy", function () {
    it("Should mint tokens and emit events", async function () {
      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);

      await expect(bondingCurve.connect(buyer).buy(tokenAmount, { value: cost }))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(ethers.ZeroAddress, buyer.address, tokenAmount)
        .and.to.emit(bondingCurve, "Buy")
        .withArgs(buyer.address, tokenAmount, cost);

      expect(await bondingCurve.balanceOf(buyer.address)).to.equal(tokenAmount);
      expect(await bondingCurve.totalSupply()).to.equal(tokenAmount);
    });

    it("Should refund excess ETH", async function () {
      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      const excess = ethers.parseEther("1");

      const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);
      const tx = await bondingCurve.connect(buyer).buy(tokenAmount, { value: cost + excess });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const buyerBalanceAfter = await ethers.provider.getBalance(buyer.address);

      expect(buyerBalanceAfter).to.equal(buyerBalanceBefore - cost - gasUsed);
    });

    it("Should revert if zero amount", async function () {
      await expect(bondingCurve.connect(buyer).buy(0, { value: 0 }))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert if insufficient ETH", async function () {
      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);

      await expect(bondingCurve.connect(buyer).buy(tokenAmount, { value: cost - 1n }))
        .to.be.revertedWith("Insufficient ETH");
    });
  });

  describe("Sell", function () {
    beforeEach(async function () {
      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      await bondingCurve.connect(seller).buy(tokenAmount, { value: cost });
    });

    it("Should burn tokens and emit events", async function () {
      const tokenAmount = 50n;
      const netReturn = await bondingCurve.quoteSell(tokenAmount);

      await expect(bondingCurve.connect(seller).sell(tokenAmount))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(seller.address, ethers.ZeroAddress, tokenAmount)
        .and.to.emit(bondingCurve, "Sell")
        .withArgs(seller.address, tokenAmount, netReturn);

      expect(await bondingCurve.balanceOf(seller.address)).to.equal(50n);
      expect(await bondingCurve.totalSupply()).to.equal(50n);
    });

    it("Should revert if zero amount", async function () {
      await expect(bondingCurve.connect(seller).sell(0))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert if insufficient balance", async function () {
      await expect(bondingCurve.connect(buyer).sell(1))
        .to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Price Calculations", function () {
    it("Should calculate spot price correctly", async function () {
      const initialPrice = await bondingCurve.spotPrice();
      expect(initialPrice).to.equal(BASE_PRICE);

      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      await bondingCurve.connect(buyer).buy(tokenAmount, { value: cost });

      const newPrice = await bondingCurve.spotPrice();
      const expectedPrice = BASE_PRICE + (SLOPE * tokenAmount) / ethers.parseEther("1");
      expect(newPrice).to.equal(expectedPrice);
    });

    it("Should quote buy correctly", async function () {
      const tokenAmount = 100n;
      const quote = await bondingCurve.quoteBuy(tokenAmount);

      // For small amounts, the integral approximation should be close to the spot price
      const spotPrice = await bondingCurve.spotPrice();
      expect(quote).to.be.closeTo(spotPrice * tokenAmount, ethers.parseEther("0.001"));
    });

    it("Should quote sell correctly", async function () {
      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      await bondingCurve.connect(seller).buy(tokenAmount, { value: cost });

      const quote = await bondingCurve.quoteSell(tokenAmount);
      const gross = await bondingCurve._integrateCost(0n, tokenAmount);
      const expectedQuote = gross - (gross * SELL_FEE_BPS) / 10_000n;
      expect(quote).to.equal(expectedQuote);
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to collect fees", async function () {
      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      await bondingCurve.connect(seller).buy(tokenAmount, { value: cost });

      // Sell some tokens to generate fees
      const sellAmount = 50n;
      await bondingCurve.connect(seller).sell(sellAmount);

      const contractBalanceBefore = await ethers.provider.getBalance(await bondingCurve.getAddress());
      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

      const tx = await bondingCurve.connect(owner).collectFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const contractBalanceAfter = await ethers.provider.getBalance(await bondingCurve.getAddress());
      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

      expect(contractBalanceAfter).to.equal(0n);
      expect(ownerBalanceAfter).to.be.closeTo(
        ownerBalanceBefore + contractBalanceBefore - gasUsed,
        ethers.parseEther("0.001")
      );
    });

    it("Should revert if non-owner tries to collect fees", async function () {
      await expect(bondingCurve.connect(buyer).collectFees())
        .to.be.revertedWith("Not owner");
    });

    it("Should revert if no fees to collect", async function () {
      await expect(bondingCurve.connect(owner).collectFees())
        .to.be.revertedWith("No fees");
    });
  });
});