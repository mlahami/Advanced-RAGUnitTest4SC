const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BondingCurve", function () {
  let bondingCurve;
  let owner;
  let buyer;
  let seller;

  const slope = ethers.parseEther("0.0001"); // 0.0001 ETH per token^2
  const basePrice = ethers.parseEther("0.1"); // 0.1 ETH per token at zero supply
  const sellFeeBps = 100n; // 1% fee on sells

  beforeEach(async function () {
    [owner, buyer, seller] = await ethers.getSigners();

    const BondingCurve = await ethers.getContractFactory("BondingCurve");
    bondingCurve = await BondingCurve.deploy(slope, basePrice, sellFeeBps);
    await bondingCurve.waitForDeployment();

    // Mint some tokens to seller
    await bondingCurve.connect(buyer).buy(100n, { value: ethers.parseEther("10") });
  });

  describe("Deployment", function () {
    it("should set the correct parameters", async function () {
      expect(await bondingCurve.name()).to.equal("BondToken");
      expect(await bondingCurve.symbol()).to.equal("BOND");
      expect(await bondingCurve.decimals()).to.equal(18);
      expect(await bondingCurve.slope()).to.equal(slope);
      expect(await bondingCurve.basePrice()).to.equal(basePrice);
      expect(await bondingCurve.sellFeeBps()).to.equal(sellFeeBps);
      expect(await bondingCurve.owner()).to.equal(owner.address);
    });

    it("should revert if fee is too high", async function () {
      const BondingCurve = await ethers.getContractFactory("BondingCurve");
      await expect(BondingCurve.deploy(slope, basePrice, 1001n)).to.be.revertedWith("Fee too high");
    });
  });

  describe("Buy", function () {
    it("should allow buying tokens", async function () {
      const amount = 100n;
      const cost = await bondingCurve.quoteBuy(amount);

      const initialSupply = await bondingCurve.totalSupply();
      const initialBalance = await bondingCurve.balanceOf(buyer.address);

      await expect(bondingCurve.connect(buyer).buy(amount, { value: cost }))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(ethers.ZeroAddress, buyer.address, amount)
        .and.to.emit(bondingCurve, "Buy")
        .withArgs(buyer.address, amount, cost);

      expect(await bondingCurve.totalSupply()).to.equal(initialSupply + amount);
      expect(await bondingCurve.balanceOf(buyer.address)).to.equal(initialBalance + amount);
    });

    it("should refund excess ETH", async function () {
      const amount = 100n;
      const cost = await bondingCurve.quoteBuy(amount);
      const excess = ethers.parseEther("1");

      const initialBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await bondingCurve.connect(buyer).buy(amount, { value: cost + excess });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(buyer.address);
      expect(finalBalance).to.be.closeTo(initialBalance - cost - gasUsed, ethers.parseEther("0.001"));
    });

    it("should revert if amount is zero", async function () {
      await expect(bondingCurve.connect(buyer).buy(0n, { value: 0 })).to.be.revertedWith("Zero amount");
    });

    it("should revert if ETH is insufficient", async function () {
      const amount = 100n;
      const cost = await bondingCurve.quoteBuy(amount);
      await expect(bondingCurve.connect(buyer).buy(amount, { value: cost - 1n })).to.be.revertedWith("Insufficient ETH");
    });
  });

  describe("Sell", function () {
    it("should allow selling tokens", async function () {
      const amount = 50n;
      const netReturn = await bondingCurve.quoteSell(amount);

      const initialSupply = await bondingCurve.totalSupply();
      const initialBalance = await bondingCurve.balanceOf(buyer.address);
      const initialEthBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await bondingCurve.connect(buyer).sell(amount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await bondingCurve.totalSupply()).to.equal(initialSupply - amount);
      expect(await bondingCurve.balanceOf(buyer.address)).to.equal(initialBalance - amount);

      const finalEthBalance = await ethers.provider.getBalance(buyer.address);
      expect(finalEthBalance).to.be.closeTo(initialEthBalance + netReturn - gasUsed, ethers.parseEther("0.001"));
    });

    it("should revert if amount is zero", async function () {
      await expect(bondingCurve.connect(buyer).sell(0n)).to.be.revertedWith("Zero amount");
    });

    it("should revert if balance is insufficient", async function () {
      const amount = 200n; // More than buyer has
      await expect(bondingCurve.connect(buyer).sell(amount)).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Price Quotes", function () {
    it("should return correct spot price", async function () {
      const supply = await bondingCurve.totalSupply();
      const expectedPrice = basePrice + (slope * supply) / ethers.parseEther("1");
      expect(await bondingCurve.spotPrice()).to.equal(expectedPrice);
    });

    it("should return correct buy quote", async function () {
      const amount = 100n;
      const supply = await bondingCurve.totalSupply();
      const expectedCost = basePrice * amount + (slope * (2n * supply * amount + amount * amount)) / (2n * ethers.parseEther("1"));
      expect(await bondingCurve.quoteBuy(amount)).to.equal(expectedCost);
    });

    it("should return correct sell quote", async function () {
      const amount = 50n;
      const supply = await bondingCurve.totalSupply();
      const gross = basePrice * amount + (slope * (2n * (supply - amount) * amount + amount * amount)) / (2n * ethers.parseEther("1"));
      const fee = (gross * sellFeeBps) / 10_000n;
      const expectedNet = gross - fee;
      expect(await bondingCurve.quoteSell(amount)).to.equal(expectedNet);
    });

    it("should return zero for sell quote when amount exceeds supply", async function () {
      const amount = (await bondingCurve.totalSupply()) + 1n;
      expect(await bondingCurve.quoteSell(amount)).to.equal(0n);
    });
  });

  describe("Owner Functions", function () {
    it("should allow owner to collect fees", async function () {
      // First buy some tokens to generate fees
      await bondingCurve.connect(buyer).buy(100n, { value: ethers.parseEther("10") });

      // Then sell some to create fees
      await bondingCurve.connect(buyer).sell(50n);

      const initialBalance = await ethers.provider.getBalance(owner.address);
      const contractBalance = await ethers.provider.getBalance(await bondingCurve.getAddress());
      const backing = await bondingCurve.quoteBuy(await bondingCurve.totalSupply());
      const expectedFees = contractBalance > backing ? contractBalance - backing : 0n;

      if (expectedFees > 0n) {
        const tx = await bondingCurve.collectFees();
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;

        const finalBalance = await ethers.provider.getBalance(owner.address);
        expect(finalBalance).to.be.closeTo(initialBalance + expectedFees - gasUsed, ethers.parseEther("0.001"));
      } else {
        await expect(bondingCurve.collectFees()).to.be.revertedWith("No fees");
      }
    });

    it("should revert if non-owner tries to collect fees", async function () {
      await expect(bondingCurve.connect(buyer).collectFees()).to.be.revertedWith("Not owner");
    });
  });
});