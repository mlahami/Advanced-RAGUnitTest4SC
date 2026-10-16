const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YieldVault", function () {
  let vault;
  let asset;
  let owner;
  let user1;
  let user2;
  let strategy;

  beforeEach(async function () {
    [owner, user1, user2, strategy] = await ethers.getSigners();

    // Deploy BenchmarkERC20 as the asset token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    asset = await BenchmarkERC20.deploy("Test Asset", "TST");
    await asset.waitForDeployment();

    // Deploy YieldVault
    const YieldVault = await ethers.getContractFactory("YieldVault");
    vault = await YieldVault.deploy(
      await asset.getAddress(),
      "Yield Vault",
      "YV"
    );
    await vault.waitForDeployment();

    // Mint assets to users
    const amount = ethers.parseEther("1000000");
    await asset.mint(user1.address, amount);
    await asset.mint(user2.address, amount);

    // Approve vault to spend assets
    await asset.connect(user1).approve(await vault.getAddress(), ethers.MaxUint256);
    await asset.connect(user2).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct asset, name and symbol", async function () {
      expect(await vault.asset()).to.equal(await asset.getAddress());
      expect(await vault.name()).to.equal("Yield Vault");
      expect(await vault.symbol()).to.equal("YV");
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
      await expect(vault.connect(user1).setStrategy(strategy.address))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("View Functions", function () {
    it("Should convert assets to shares correctly", async function () {
      const amount = ethers.parseEther("1000");
      await vault.connect(user1).deposit(amount, user1.address);

      expect(await vault.convertToShares(amount)).to.equal(amount);
    });

    it("Should convert shares to assets correctly", async function () {
      const amount = ethers.parseEther("1000");
      await vault.connect(user1).deposit(amount, user1.address);

      const shares = await vault.sharesOf(user1.address);
      expect(await vault.convertToAssets(shares)).to.equal(amount);
    });

    it("Should handle zero case in convertToShares", async function () {
      expect(await vault.convertToShares(0n)).to.equal(0n);
    });

    it("Should handle zero case in convertToAssets", async function () {
      expect(await vault.convertToAssets(0n)).to.equal(0n);
    });
  });

  describe("Deposit", function () {
    it("Should deposit assets and mint shares", async function () {
      const amount = ethers.parseEther("1000");

      await expect(vault.connect(user1).deposit(amount, user1.address))
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, amount, amount);

      expect(await vault.sharesOf(user1.address)).to.equal(amount);
      expect(await vault.totalAssets()).to.equal(amount);
      expect(await vault.totalShares()).to.equal(amount);
    });

    it("Should revert when depositing zero assets", async function () {
      await expect(vault.connect(user1).deposit(0n, user1.address))
        .to.be.revertedWith("Zero shares");
    });

    it("Should forward assets to strategy when strategy is set", async function () {
      await vault.connect(owner).setStrategy(strategy.address);

      const amount = ethers.parseEther("1000");
      await vault.connect(user1).deposit(amount, user1.address);

      expect(await asset.balanceOf(strategy.address)).to.equal(amount);
    });
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      const amount = ethers.parseEther("1000");
      await vault.connect(user1).deposit(amount, user1.address);
    });

    it("Should withdraw assets and burn shares", async function () {
      const shares = await vault.sharesOf(user1.address);
      const assets = await vault.convertToAssets(shares);

      await expect(vault.connect(user1).withdraw(shares, user1.address))
        .to.emit(vault, "Withdraw")
        .withArgs(user1.address, user1.address, assets, shares);

      expect(await vault.sharesOf(user1.address)).to.equal(0n);
      expect(await vault.totalAssets()).to.equal(0n);
      expect(await vault.totalShares()).to.equal(0n);
    });

    it("Should revert when withdrawing more shares than owned", async function () {
      const shares = await vault.sharesOf(user1.address);
      await expect(vault.connect(user1).withdraw(shares + 1n, user1.address))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("Profit Reporting", function () {
    beforeEach(async function () {
      await vault.connect(owner).setStrategy(strategy.address);
      const amount = ethers.parseEther("1000");
      await vault.connect(user1).deposit(amount, user1.address);
    });

    it("Should allow strategy to report profit", async function () {
      const profit = ethers.parseEther("100");

      await expect(vault.connect(strategy).reportProfit(profit))
        .to.emit(vault, "Harvested")
        .withArgs(profit);

      expect(await vault.totalAssets()).to.equal(ethers.parseEther("1100"));
    });

    it("Should revert when non-strategy tries to report profit", async function () {
      await expect(vault.connect(user1).reportProfit(ethers.parseEther("100")))
        .to.be.revertedWith("Not strategy");
    });
  });
});