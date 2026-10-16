const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YieldVault", function () {
  let vault, asset, owner, user1, user2, strategy;
  const ASSET_AMOUNT = ethers.parseEther("1000");
  const NAME = "Yield Vault";
  const SYMBOL = "YV";

  beforeEach(async function () {
    [owner, user1, user2, strategy] = await ethers.getSigners();

    // Deploy mock ERC20 asset
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    asset = await BenchmarkERC20.deploy("Test Asset", "TST");
    await asset.waitForDeployment();

    // Mint assets to users
    await asset.mint(user1.address, ASSET_AMOUNT);
    await asset.mint(user2.address, ASSET_AMOUNT);

    // Deploy vault
    const YieldVault = await ethers.getContractFactory("YieldVault");
    vault = await YieldVault.deploy(
      await asset.getAddress(),
      NAME,
      SYMBOL
    );
    await vault.waitForDeployment();

    // Approve vault to spend assets
    await asset.connect(user1).approve(await vault.getAddress(), ASSET_AMOUNT);
    await asset.connect(user2).approve(await vault.getAddress(), ASSET_AMOUNT);
  });

  describe("Deployment", function () {
    it("Should set the correct asset, name, and symbol", async function () {
      expect(await vault.asset()).to.equal(await asset.getAddress());
      expect(await vault.name()).to.equal(NAME);
      expect(await vault.symbol()).to.equal(SYMBOL);
    });

    it("Should initialize with zero total assets and shares", async function () {
      expect(await vault.totalAssets()).to.equal(0n);
      expect(await vault.totalShares()).to.equal(0n);
    });
  });

  describe("Strategy Management", function () {
    it("Should allow owner to set strategy", async function () {
      await expect(vault.connect(owner).setStrategy(strategy.address))
        .to.emit(vault, "StrategyUpdated")
        .withArgs(ethers.ZeroAddress, strategy.address);

      expect(await vault.strategy()).to.equal(strategy.address);
    });

    it("Should revert when non-owner tries to set strategy", async function () {
      await expect(
        vault.connect(user1).setStrategy(strategy.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("Deposit", function () {
    it("Should deposit assets and mint shares", async function () {
      const depositAmount = ethers.parseEther("100");
      const expectedShares = depositAmount;

      await expect(vault.connect(user1).deposit(depositAmount, user1.address))
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, depositAmount, expectedShares);

      expect(await vault.sharesOf(user1.address)).to.equal(expectedShares);
      expect(await vault.totalAssets()).to.equal(depositAmount);
      expect(await vault.totalShares()).to.equal(expectedShares);
    });

    it("Should revert when depositing zero assets", async function () {
      await expect(
        vault.connect(user1).deposit(0n, user1.address)
      ).to.be.revertedWith("Zero shares");
    });

    it("Should forward assets to strategy when strategy is set", async function () {
      await vault.connect(owner).setStrategy(strategy.address);

      const depositAmount = ethers.parseEther("100");
      const initialStrategyBalance = await asset.balanceOf(strategy.address);

      await vault.connect(user1).deposit(depositAmount, user1.address);

      expect(await asset.balanceOf(strategy.address)).to.equal(
        initialStrategyBalance + depositAmount
      );
    });
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseEther("100");
      await vault.connect(user1).deposit(depositAmount, user1.address);
    });

    it("Should withdraw assets and burn shares", async function () {
      const shares = await vault.sharesOf(user1.address);
      const expectedAssets = await vault.convertToAssets(shares);

      await expect(vault.connect(user1).withdraw(shares, user1.address))
        .to.emit(vault, "Withdraw")
        .withArgs(user1.address, user1.address, expectedAssets, shares);

      expect(await vault.sharesOf(user1.address)).to.equal(0n);
      expect(await vault.totalAssets()).to.equal(0n);
      expect(await vault.totalShares()).to.equal(0n);
    });

    it("Should revert when withdrawing more shares than owned", async function () {
      const shares = await vault.sharesOf(user1.address);
      await expect(
        vault.connect(user1).withdraw(shares + 1n, user1.address)
      ).to.be.revertedWith("Insufficient shares");
    });
  });

  describe("Conversion Functions", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseEther("100");
      await vault.connect(user1).deposit(depositAmount, user1.address);
    });

    it("Should convert assets to shares correctly", async function () {
      const assets = ethers.parseEther("50");
      const expectedShares = assets; // 1:1 ratio in this test

      expect(await vault.convertToShares(assets)).to.equal(expectedShares);
    });

    it("Should convert shares to assets correctly", async function () {
      const shares = ethers.parseEther("50");
      const expectedAssets = shares; // 1:1 ratio in this test

      expect(await vault.convertToAssets(shares)).to.equal(expectedAssets);
    });

    it("Should handle zero cases in conversion functions", async function () {
      expect(await vault.convertToShares(0n)).to.equal(0n);
      expect(await vault.convertToAssets(0n)).to.equal(0n);
    });
  });

  describe("Profit Reporting", function () {
    beforeEach(async function () {
      await vault.connect(owner).setStrategy(strategy.address);
      const depositAmount = ethers.parseEther("100");
      await vault.connect(user1).deposit(depositAmount, user1.address);
    });

    it("Should allow strategy to report profit", async function () {
      const profit = ethers.parseEther("10");
      const initialTotalAssets = await vault.totalAssets();

      await expect(vault.connect(strategy).reportProfit(profit))
        .to.emit(vault, "Harvested")
        .withArgs(profit);

      expect(await vault.totalAssets()).to.equal(initialTotalAssets + profit);
    });

    it("Should revert when non-strategy tries to report profit", async function () {
      await expect(
        vault.connect(user1).reportProfit(ethers.parseEther("10"))
      ).to.be.revertedWith("Not strategy");
    });
  });
});