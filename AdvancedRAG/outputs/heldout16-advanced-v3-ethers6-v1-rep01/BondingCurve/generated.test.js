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

    // Mint some tokens to seller for testing
    await bondingCurve.connect(buyer).buy(100n, { value: ethers.parseEther("10") });
    await bondingCurve.connect(buyer).buy(100n, { value: ethers.parseEther("10") });
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await bondingCurve.owner()).to.equal(owner.address);
    });

    it("Should set the correct parameters", async function () {
      expect(await bondingCurve.slope()).to.equal(SLOPE);
      expect(await bondingCurve.basePrice()).to.equal(BASE_PRICE);
      expect(await bondingCurve.sellFeeBps()).to.equal(SELL_FEE_BPS);
    });

    it("Should revert with too high fee", async function () {
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
      expect(await bondingCurve.totalSupply()).to.equal(300n); // 100 + 100 + 100
    });

    it("Should refund excess ETH", async function () {
      const tokenAmount = 100n;
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
      await expect(bondingCurve.connect(buyer).buy(0n, { value: 0 }))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert with insufficient ETH", async function () {
      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);

      await expect(bondingCurve.connect(buyer).buy(tokenAmount, { value: cost - 1n }))
        .to.be.revertedWith("Insufficient ETH");
    });
  });

  describe("Sell", function () {
    it("Should burn tokens and emit events", async function () {
      const tokenAmount = 100n;
      const netReturn = await bondingCurve.quoteSell(tokenAmount);

      await expect(bondingCurve.connect(buyer).sell(tokenAmount))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(buyer.address, ethers.ZeroAddress, tokenAmount)
        .and.to.emit(bondingCurve, "Sell")
        .withArgs(buyer.address, tokenAmount, netReturn);

      expect(await bondingCurve.balanceOf(buyer.address)).to.equal(100n); // 200 - 100
      expect(await bondingCurve.totalSupply()).to.equal(100n); // 300 - 200
    });

    it("Should transfer correct ETH amount", async function () {
      const tokenAmount = 100n;
      const netReturn = await bondingCurve.quoteSell(tokenAmount);

      const initialBalance = await ethers.provider.getBalance(buyer.address);
      const tx = await bondingCurve.connect(buyer).sell(tokenAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(buyer.address);

      expect(finalBalance).to.equal(initialBalance + netReturn - gasUsed);
    });

    it("Should revert with zero amount", async function () {
      await expect(bondingCurve.connect(buyer).sell(0n))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert with insufficient balance", async function () {
      await expect(bondingCurve.connect(seller).sell(100n))
        .to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Price Quotes", function () {
    it("Should return correct spot price", async function () {
      const expectedPrice = BASE_PRICE + (SLOPE * 200n) / ethers.parseEther("1");
      expect(await bondingCurve.spotPrice()).to.equal(expectedPrice);
    });

    it("Should return correct buy quote", async function () {
      const tokenAmount = 100n;
      const expectedCost = BASE_PRICE * tokenAmount +
        (SLOPE * (2n * 200n * tokenAmount + tokenAmount * tokenAmount)) / (2n * ethers.parseEther("1"));
      expect(await bondingCurve.quoteBuy(tokenAmount)).to.equal(expectedCost);
    });

    it("Should return correct sell quote", async function () {
      const tokenAmount = 100n;
      const gross = BASE_PRICE * tokenAmount +
        (SLOPE * (2n * 100n * tokenAmount + tokenAmount * tokenAmount)) / (2n * ethers.parseEther("1"));
      const fee = (gross * SELL_FEE_BPS) / 10_000n;
      const expectedNet = gross - fee;
      expect(await bondingCurve.quoteSell(tokenAmount)).to.equal(expectedNet);
    });

    it("Should return zero for sell quote with amount > totalSupply", async function () {
      expect(await bondingCurve.quoteSell(400n)).to.equal(0n);
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to collect fees", async function () {
      // First buy to accumulate some fees
      await bondingCurve.connect(buyer).buy(100n, { value: ethers.parseEther("10") });

      const initialBalance = await ethers.provider.getBalance(owner.address);
      const tx = await bondingCurve.connect(owner).collectFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(owner.address);

      expect(finalBalance).to.be.gt(initialBalance - gasUsed);
    });

    it("Should revert collectFees when no fees", async function () {
      await expect(bondingCurve.connect(owner).collectFees())
        .to.be.revertedWith("No fees");
    });

    it("Should revert owner functions from non-owner", async function () {
      await expect(bondingCurve.connect(buyer).collectFees())
        .to.be.revertedWith("Not owner");
    });
  });
});