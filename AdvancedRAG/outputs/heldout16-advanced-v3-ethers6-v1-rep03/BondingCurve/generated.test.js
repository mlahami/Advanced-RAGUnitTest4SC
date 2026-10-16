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

    // Mint some tokens to seller
    await bondingCurve.connect(buyer).buy(100n, { value: ethers.parseEther("100") });
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
      const initialSupply = await bondingCurve.totalSupply();
      const initialBalance = await bondingCurve.balanceOf(buyer.address);

      const amount = 100n;
      const cost = await bondingCurve.quoteBuy(amount);

      await expect(bondingCurve.connect(buyer).buy(amount, { value: cost }))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(ethers.ZeroAddress, buyer.address, amount)
        .to.emit(bondingCurve, "Buy")
        .withArgs(buyer.address, amount, cost);

      expect(await bondingCurve.totalSupply()).to.equal(initialSupply + amount);
      expect(await bondingCurve.balanceOf(buyer.address)).to.equal(initialBalance + amount);
    });

    it("Should refund excess ETH", async function () {
      const amount = 100n;
      const cost = await bondingCurve.quoteBuy(amount);
      const excess = ethers.parseEther("1");

      const initialBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await bondingCurve.connect(buyer).buy(amount, { value: cost + excess });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(buyer.address);
      expect(finalBalance).to.be.closeTo(
        initialBalance - cost - gasUsed,
        ethers.parseEther("0.001") // small tolerance for gas calculation
      );
    });

    it("Should revert if amount is zero", async function () {
      await expect(bondingCurve.connect(buyer).buy(0n, { value: 0 }))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert if ETH is insufficient", async function () {
      const amount = 100n;
      const cost = await bondingCurve.quoteBuy(amount);

      await expect(bondingCurve.connect(buyer).buy(amount, { value: cost - 1n }))
        .to.be.revertedWith("Insufficient ETH");
    });
  });

  describe("Sell", function () {
    it("Should burn tokens and emit events", async function () {
      const amount = 50n;
      const initialSupply = await bondingCurve.totalSupply();
      const initialBalance = await bondingCurve.balanceOf(buyer.address);

      const netReturn = await bondingCurve.quoteSell(amount);

      await expect(bondingCurve.connect(buyer).sell(amount))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(buyer.address, ethers.ZeroAddress, amount)
        .to.emit(bondingCurve, "Sell")
        .withArgs(buyer.address, amount, netReturn);

      expect(await bondingCurve.totalSupply()).to.equal(initialSupply - amount);
      expect(await bondingCurve.balanceOf(buyer.address)).to.equal(initialBalance - amount);
    });

    it("Should transfer ETH to seller", async function () {
      const amount = 50n;
      const netReturn = await bondingCurve.quoteSell(amount);

      const initialBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await bondingCurve.connect(buyer).sell(amount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(buyer.address);
      expect(finalBalance).to.be.closeTo(
        initialBalance + netReturn - gasUsed,
        ethers.parseEther("0.001") // small tolerance for gas calculation
      );
    });

    it("Should revert if amount is zero", async function () {
      await expect(bondingCurve.connect(buyer).sell(0n))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert if balance is insufficient", async function () {
      const amount = 200n; // More than buyer has
      await expect(bondingCurve.connect(buyer).sell(amount))
        .to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Price Calculations", function () {
    it("Should calculate spot price correctly", async function () {
      const supply = await bondingCurve.totalSupply();
      const expectedPrice = BASE_PRICE + (SLOPE * supply) / ethers.parseEther("1");
      expect(await bondingCurve.spotPrice()).to.equal(expectedPrice);
    });

    it("Should quote buy correctly", async function () {
      const amount = 100n;
      const supply = await bondingCurve.totalSupply();

      // Calculate expected cost using the integral formula
      const term1 = BASE_PRICE * amount;
      const term2 = (SLOPE * (2n * supply * amount + amount * amount)) / (2n * ethers.parseEther("1"));
      const expectedCost = term1 + term2;

      expect(await bondingCurve.quoteBuy(amount)).to.equal(expectedCost);
    });

    it("Should quote sell correctly", async function () {
      const amount = 50n;
      const supply = await bondingCurve.totalSupply();

      // Calculate gross cost
      const grossTerm1 = BASE_PRICE * amount;
      const grossTerm2 = (SLOPE * (2n * (supply - amount) * amount + amount * amount)) / (2n * ethers.parseEther("1"));
      const gross = grossTerm1 + grossTerm2;

      // Calculate net return after fee
      const fee = (gross * SELL_FEE_BPS) / 10_000n;
      const expectedNet = gross - fee;

      expect(await bondingCurve.quoteSell(amount)).to.equal(expectedNet);
    });

    it("Should return 0 for quoteSell if amount exceeds total supply", async function () {
      const amount = (await bondingCurve.totalSupply()) + 1n;
      expect(await bondingCurve.quoteSell(amount)).to.equal(0n);
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to collect fees", async function () {
      // First buy some tokens to create fees
      await bondingCurve.connect(buyer).buy(100n, { value: ethers.parseEther("100") });

      // Then sell some to generate fees
      await bondingCurve.connect(buyer).sell(50n);

      const initialBalance = await ethers.provider.getBalance(owner.address);
      const tx = await bondingCurve.connect(owner).collectFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(owner.address);
      expect(finalBalance).to.be.gt(initialBalance - gasUsed);
    });

    it("Should revert if no fees to collect", async function () {
      await expect(bondingCurve.connect(owner).collectFees())
        .to.be.revertedWith("No fees");
    });

    it("Should revert if non-owner tries to collect fees", async function () {
      await expect(bondingCurve.connect(buyer).collectFees())
        .to.be.revertedWith("Not owner");
    });
  });
});