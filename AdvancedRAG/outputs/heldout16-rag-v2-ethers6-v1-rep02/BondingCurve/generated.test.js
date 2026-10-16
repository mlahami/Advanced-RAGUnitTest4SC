const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BondingCurve", function () {
  let bondingCurve;
  let owner;
  let buyer;
  let seller;

  const SLOPE = ethers.parseEther("1"); // 1 wei per token^2
  const BASE_PRICE = ethers.parseEther("1"); // 1 wei per token at zero supply
  const SELL_FEE_BPS = 100n; // 1% fee

  beforeEach(async function () {
    [owner, buyer, seller] = await ethers.getSigners();

    const BondingCurve = await ethers.getContractFactory("BondingCurve");
    bondingCurve = await BondingCurve.deploy(SLOPE, BASE_PRICE, SELL_FEE_BPS);
    await bondingCurve.waitForDeployment();

    // Fund buyer with ETH
    await owner.sendTransaction({
      to: buyer.address,
      value: ethers.parseEther("100")
    });

    // Fund seller with tokens
    const initialBuyAmount = ethers.parseEther("10");
    await bondingCurve.connect(buyer).buy(initialBuyAmount, {
      value: await bondingCurve.quoteBuy(initialBuyAmount)
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
    it("should mint tokens and emit events", async function () {
      const amount = ethers.parseEther("5");
      const cost = await bondingCurve.quoteBuy(amount);

      await expect(bondingCurve.connect(buyer).buy(amount, { value: cost }))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(ethers.ZeroAddress, buyer.address, amount)
        .and.to.emit(bondingCurve, "Buy")
        .withArgs(buyer.address, amount, cost);

      expect(await bondingCurve.balanceOf(buyer.address)).to.equal(ethers.parseEther("15"));
      expect(await bondingCurve.totalSupply()).to.equal(ethers.parseEther("15"));
    });

    it("should refund excess ETH", async function () {
      const amount = ethers.parseEther("5");
      const cost = await bondingCurve.quoteBuy(amount);
      const excess = ethers.parseEther("1");

      const initialBalance = await ethers.provider.getBalance(buyer.address);
      const tx = await bondingCurve.connect(buyer).buy(amount, { value: cost + excess });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(buyer.address);

      expect(finalBalance).to.be.closeTo(
        initialBalance - cost - gasUsed + excess,
        ethers.parseEther("0.001")
      );
    });

    it("should revert if amount is zero", async function () {
      await expect(bondingCurve.connect(buyer).buy(0, { value: 0 }))
        .to.be.revertedWith("Zero amount");
    });

    it("should revert if ETH is insufficient", async function () {
      const amount = ethers.parseEther("5");
      const cost = await bondingCurve.quoteBuy(amount);

      await expect(bondingCurve.connect(buyer).buy(amount, { value: cost - 1n }))
        .to.be.revertedWith("Insufficient ETH");
    });
  });

  describe("Sell", function () {
    it("should burn tokens and emit events", async function () {
      const amount = ethers.parseEther("5");
      const gross = await bondingCurve.quoteBuy(amount);
      const fee = (gross * SELL_FEE_BPS) / 10_000n;
      const net = gross - fee;

      await expect(bondingCurve.connect(buyer).sell(amount))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(buyer.address, ethers.ZeroAddress, amount)
        .and.to.emit(bondingCurve, "Sell")
        .withArgs(buyer.address, amount, net);

      expect(await bondingCurve.balanceOf(buyer.address)).to.equal(ethers.parseEther("5"));
      expect(await bondingCurve.totalSupply()).to.equal(ethers.parseEther("5"));
    });

    it("should transfer ETH to seller", async function () {
      const amount = ethers.parseEther("5");
      const gross = await bondingCurve.quoteBuy(amount);
      const fee = (gross * SELL_FEE_BPS) / 10_000n;
      const net = gross - fee;

      const initialBalance = await ethers.provider.getBalance(buyer.address);
      const tx = await bondingCurve.connect(buyer).sell(amount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(buyer.address);

      expect(finalBalance).to.be.closeTo(
        initialBalance + net - gasUsed,
        ethers.parseEther("0.001")
      );
    });

    it("should revert if amount is zero", async function () {
      await expect(bondingCurve.connect(buyer).sell(0))
        .to.be.revertedWith("Zero amount");
    });

    it("should revert if balance is insufficient", async function () {
      await expect(bondingCurve.connect(seller).sell(1))
        .to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Price Calculations", function () {
    it("should calculate spot price correctly", async function () {
      const supply = await bondingCurve.totalSupply();
      const expectedPrice = BASE_PRICE + (SLOPE * supply) / ethers.parseEther("1");
      expect(await bondingCurve.spotPrice()).to.equal(expectedPrice);
    });

    it("should quote buy correctly", async function () {
      const amount = ethers.parseEther("5");
      const supply = await bondingCurve.totalSupply();
      const expectedCost = BASE_PRICE * amount +
        (SLOPE * (2n * supply * amount + amount * amount)) / (2n * ethers.parseEther("1"));
      expect(await bondingCurve.quoteBuy(amount)).to.equal(expectedCost);
    });

    it("should quote sell correctly", async function () {
      const amount = ethers.parseEther("5");
      const supply = await bondingCurve.totalSupply();
      const gross = BASE_PRICE * amount +
        (SLOPE * (2n * (supply - amount) * amount + amount * amount)) / (2n * ethers.parseEther("1"));
      const fee = (gross * SELL_FEE_BPS) / 10_000n;
      const expectedNet = gross - fee;
      expect(await bondingCurve.quoteSell(amount)).to.equal(expectedNet);
    });

    it("should return 0 for quoteSell if amount exceeds supply", async function () {
      const amount = ethers.parseEther("100");
      expect(await bondingCurve.quoteSell(amount)).to.equal(0);
    });
  });

  describe("Owner Functions", function () {
    it("should allow owner to collect fees", async function () {
      // First perform a buy to accumulate ETH
      const buyAmount = ethers.parseEther("10");
      const buyCost = await bondingCurve.quoteBuy(buyAmount);
      await bondingCurve.connect(buyer).buy(buyAmount, { value: buyCost });

      // Then perform a sell to accumulate fees
      const sellAmount = ethers.parseEther("5");
      await bondingCurve.connect(buyer).sell(sellAmount);

      // Calculate expected fees
      const gross = await bondingCurve.quoteBuy(sellAmount);
      const fee = (gross * SELL_FEE_BPS) / 10_000n;
      const backing = await bondingCurve.quoteBuy(await bondingCurve.totalSupply());
      const expectedFees = (await ethers.provider.getBalance(await bondingCurve.getAddress())) - backing;

      const initialBalance = await ethers.provider.getBalance(owner.address);
      const tx = await bondingCurve.connect(owner).collectFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(owner.address);

      expect(finalBalance).to.be.closeTo(
        initialBalance + expectedFees - gasUsed,
        ethers.parseEther("0.001")
      );
    });

    it("should revert if not owner tries to collect fees", async function () {
      await expect(bondingCurve.connect(buyer).collectFees())
        .to.be.revertedWith("Not owner");
    });

    it("should revert if no fees to collect", async function () {
      await expect(bondingCurve.connect(owner).collectFees())
        .to.be.revertedWith("No fees");
    });
  });
});