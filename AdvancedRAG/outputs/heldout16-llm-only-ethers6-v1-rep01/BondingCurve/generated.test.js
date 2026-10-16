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

    // Mint some tokens to seller
    await bondingCurve.connect(buyer).buy(100n, { value: ethers.parseEther("100") });
    await bondingCurve.connect(buyer).sell(50n);
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

    it("Should revert with zero amount", async function () {
      await expect(bondingCurve.connect(buyer).buy(0n, { value: 0n })).to.be.revertedWith("Zero amount");
    });

    it("Should revert with insufficient ETH", async function () {
      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      await expect(bondingCurve.connect(buyer).buy(tokenAmount, { value: cost - 1n })).to.be.revertedWith("Insufficient ETH");
    });

    it("Should refund excess ETH", async function () {
      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      const excess = ethers.parseEther("1");

      const tx = await bondingCurve.connect(buyer).buy(tokenAmount, { value: cost + excess });
      await expect(tx).to.changeEtherBalances(
        [buyer, bondingCurve],
        [-cost, cost]
      );
    });
  });

  describe("Sell", function () {
    it("Should burn tokens and emit events", async function () {
      const tokenAmount = 50n;
      const ethReturned = await bondingCurve.quoteSell(tokenAmount);

      await expect(bondingCurve.connect(buyer).sell(tokenAmount))
        .to.emit(bondingCurve, "Transfer")
        .withArgs(buyer.address, ethers.ZeroAddress, tokenAmount)
        .and.to.emit(bondingCurve, "Sell")
        .withArgs(buyer.address, tokenAmount, ethReturned);

      expect(await bondingCurve.balanceOf(buyer.address)).to.equal(0n);
      expect(await bondingCurve.totalSupply()).to.equal(50n);
    });

    it("Should revert with zero amount", async function () {
      await expect(bondingCurve.connect(buyer).sell(0n)).to.be.revertedWith("Zero amount");
    });

    it("Should revert with insufficient balance", async function () {
      await expect(bondingCurve.connect(buyer).sell(101n)).to.be.revertedWith("Insufficient balance");
    });

    it("Should transfer correct ETH amount after fee", async function () {
      const tokenAmount = 50n;
      const ethReturned = await bondingCurve.quoteSell(tokenAmount);

      await expect(() => bondingCurve.connect(buyer).sell(tokenAmount))
        .to.changeEtherBalances(
          [buyer, bondingCurve],
          [ethReturned, -ethReturned]
        );
    });
  });

  describe("Price Calculations", function () {
    it("Should return correct spot price", async function () {
      const initialPrice = await bondingCurve.spotPrice();
      expect(initialPrice).to.equal(basePrice);

      await bondingCurve.connect(buyer).buy(100n, { value: ethers.parseEther("100") });
      const newPrice = await bondingCurve.spotPrice();
      expect(newPrice).to.be.gt(basePrice);
    });

    it("Should return correct buy quote", async function () {
      const tokenAmount = 100n;
      const cost = await bondingCurve.quoteBuy(tokenAmount);
      expect(cost).to.be.gt(0n);
    });

    it("Should return correct sell quote", async function () {
      const tokenAmount = 50n;
      const ethReturned = await bondingCurve.quoteSell(tokenAmount);
      expect(ethReturned).to.be.gt(0n);
    });

    it("Should return zero for sell quote with insufficient supply", async function () {
      const ethReturned = await bondingCurve.quoteSell(1000n);
      expect(ethReturned).to.equal(0n);
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to collect fees", async function () {
      // First buy some tokens to generate fees
      await bondingCurve.connect(buyer).buy(100n, { value: ethers.parseEther("100") });
      await bondingCurve.connect(buyer).sell(50n);

      const contractBalance = await ethers.provider.getBalance(await bondingCurve.getAddress());
      const backing = await bondingCurve.quoteBuy(await bondingCurve.totalSupply());
      const expectedFees = contractBalance - backing;

      if (expectedFees > 0n) {
        await expect(() => bondingCurve.connect(owner).collectFees())
          .to.changeEtherBalances(
            [owner, bondingCurve],
            [expectedFees, -expectedFees]
          );
      } else {
        await expect(bondingCurve.connect(owner).collectFees()).to.be.revertedWith("No fees");
      }
    });

    it("Should revert if not owner tries to collect fees", async function () {
      await expect(bondingCurve.connect(buyer).collectFees()).to.be.revertedWith("Not owner");
    });
  });
});