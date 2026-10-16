const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BondingCurve", function () {
  let bondingCurve;
  let owner;
  let buyer;
  let seller;

  const SLOPE = 1000000000000000000n; // 1e18 wei per token^2
  const BASE_PRICE = 1000000000000000000n; // 1e18 wei per token
  const SELL_FEE_BPS = 100n; // 1% fee

  beforeEach(async function () {
    [owner, buyer, seller] = await ethers.getSigners();

    const BondingCurve = await ethers.getContractFactory("BondingCurve");
    bondingCurve = await BondingCurve.deploy(SLOPE, BASE_PRICE, SELL_FEE_BPS);
    await bondingCurve.waitForDeployment();

    // Fund buyer and seller with ETH
    await owner.sendTransaction({
      to: buyer.address,
      value: ethers.parseEther("100")
    });
    await owner.sendTransaction({
      to: seller.address,
      value: ethers.parseEther("100")
    });
  });

  describe("Deployment", function () {
    it("should set the correct parameters", async function () {
      expect(await bondingCurve.slope()).to.equal(SLOPE);
      expect(await bondingCurve.basePrice()).to.equal(BASE_PRICE);
      expect(await bondingCurve.sellFeeBps()).to.equal(SELL_FEE_BPS);
      expect(await bondingCurve.owner()).to.equal(owner.address);
    });

    it("should revert if fee is too high", async function () {
      const BondingCurve = await ethers.getContractFactory("BondingCurve");
      await expect(BondingCurve.deploy(SLOPE, BASE_PRICE, 1001n))
        .to.be.revertedWith("Fee too high");
    });
  });

  describe("Buy", function () {
    it("should allow buying tokens", async function () {
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

    it("should refund excess ETH", async function () {
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

    it("should revert if ETH is insufficient", async function () {
      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);

      await expect(bondingCurve.connect(buyer).buy(tokenAmount, { value: cost - 1n }))
        .to.be.revertedWith("Insufficient ETH");
    });

    it("should revert if amount is zero", async function () {
      await expect(bondingCurve.connect(buyer).buy(0, { value: 0 }))
        .to.be.revertedWith("Zero amount");
    });
  });

  describe("Sell", function () {
    beforeEach(async function () {
      const tokenAmount = 1000n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      await bondingCurve.connect(buyer).buy(tokenAmount, { value: cost });
      await bondingCurve.connect(buyer).transfer(seller.address, tokenAmount);
    });

    it("should allow selling tokens", async function () {
      const tokenAmount = 100n;
      const netReturn = await bondingCurve.quoteSell(tokenAmount);

      const initialBalance = await ethers.provider.getBalance(seller.address);
      const tx = await bondingCurve.connect(seller).sell(tokenAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(seller.address);

      expect(finalBalance).to.equal(initialBalance + netReturn - gasUsed);
      expect(await bondingCurve.balanceOf(seller.address)).to.equal(900n);
      expect(await bondingCurve.totalSupply()).to.equal(900n);
    });

    it("should emit Sell event", async function () {
      const tokenAmount = 100n;
      const netReturn = await bondingCurve.quoteSell(tokenAmount);

      await expect(bondingCurve.connect(seller).sell(tokenAmount))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(seller.address, ethers.ZeroAddress, tokenAmount)
        .and.to.emit(bondingCurve, "Sell")
        .withArgs(seller.address, tokenAmount, netReturn);
    });

    it("should revert if balance is insufficient", async function () {
      await expect(bondingCurve.connect(seller).sell(1001n))
        .to.be.revertedWith("Insufficient balance");
    });

    it("should revert if amount is zero", async function () {
      await expect(bondingCurve.connect(seller).sell(0))
        .to.be.revertedWith("Zero amount");
    });
  });

  describe("Price Calculations", function () {
    it("should calculate spot price correctly", async function () {
      const initialPrice = await bondingCurve.spotPrice();
      expect(initialPrice).to.equal(BASE_PRICE);

      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      await bondingCurve.connect(buyer).buy(tokenAmount, { value: cost });

      const newPrice = await bondingCurve.spotPrice();
      const expectedPrice = BASE_PRICE + (SLOPE * tokenAmount) / 10n**18n;
      expect(newPrice).to.equal(expectedPrice);
    });

    it("should quote buy correctly", async function () {
      const tokenAmount = 100n;
      const quote = await bondingCurve.quoteBuy(tokenAmount);

      // Calculate expected cost using the integral formula
      const term1 = BASE_PRICE * tokenAmount;
      const term2 = (SLOPE * (2n * 0n * tokenAmount + tokenAmount * tokenAmount)) / (2n * 10n**18n);
      const expectedCost = term1 + term2;

      expect(quote).to.equal(expectedCost);
    });

    it("should quote sell correctly", async function () {
      const tokenAmount = 100n;
      const quote = await bondingCurve.quoteSell(tokenAmount);

      // Calculate expected gross cost
      const term1 = BASE_PRICE * tokenAmount;
      const term2 = (SLOPE * (2n * 0n * tokenAmount + tokenAmount * tokenAmount)) / (2n * 10n**18n);
      const grossCost = term1 + term2;

      // Apply fee
      const fee = (grossCost * SELL_FEE_BPS) / 10000n;
      const expectedNet = grossCost - fee;

      expect(quote).to.equal(expectedNet);
    });
  });

  describe("Owner Functions", function () {
    it("should allow owner to collect fees", async function () {
      // Buy tokens to create ETH balance
      const buyAmount = 1000n;
      const buyCost = await bondingCurve.quoteBuy(buyAmount);
      await bondingCurve.connect(buyer).buy(buyAmount, { value: buyCost });

      // Sell tokens to create fees
      const sellAmount = 500n;
      await bondingCurve.connect(buyer).transfer(seller.address, sellAmount);
      await bondingCurve.connect(seller).sell(sellAmount);

      // Calculate expected fees
      const gross = await bondingCurve.quoteBuy(sellAmount);
      const fee = (gross * SELL_FEE_BPS) / 10000n;
      const backing = await bondingCurve.quoteBuy(buyAmount - sellAmount);
      const expectedFees = (await ethers.provider.getBalance(await bondingCurve.getAddress())) - backing;

      // Collect fees
      const initialBalance = await ethers.provider.getBalance(owner.address);
      const tx = await bondingCurve.connect(owner).collectFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(owner.address);

      expect(finalBalance).to.equal(initialBalance + expectedFees - gasUsed);
    });

    it("should revert if no fees to collect", async function () {
      await expect(bondingCurve.connect(owner).collectFees())
        .to.be.revertedWith("No fees");
    });

    it("should revert if non-owner tries to collect fees", async function () {
      await expect(bondingCurve.connect(buyer).collectFees())
        .to.be.revertedWith("Not owner");
    });
  });
});