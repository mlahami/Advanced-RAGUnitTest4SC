const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YieldVault", function () {
  let vault, asset, owner, user1, user2, strategy;
  const ASSET_NAME = "Test Asset";
  const ASSET_SYMBOL = "TST";
  const VAULT_NAME = "Test Vault";
  const VAULT_SYMBOL = "TVLT";

  beforeEach(async function () {
    [owner, user1, user2, strategy] = await ethers.getSigners();

    // Deploy asset token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    asset = await BenchmarkERC20.deploy(ASSET_NAME, ASSET_SYMBOL);
    await asset.waitForDeployment();

    // Deploy vault
    const YieldVault = await ethers.getContractFactory("YieldVault");
    vault = await YieldVault.deploy(await asset.getAddress(), VAULT_NAME, VAULT_SYMBOL);
    await vault.waitForDeployment();

    // Mint and approve assets for users
    await asset.mint(user1.address, ethers.parseEther("1000"));
    await asset.mint(user2.address, ethers.parseEther("1000"));
    await asset.connect(user1).approve(await vault.getAddress(), ethers.MaxUint256);
    await asset.connect(user2).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct asset and metadata", async function () {
      expect(await vault.asset()).to.equal(await asset.getAddress());
      expect(await vault.name()).to.equal(VAULT_NAME);
      expect(await vault.symbol()).to.equal(VAULT_SYMBOL);
    });

    it("Should initialize with zero total assets and shares", async function () {
      expect(await vault.totalAssets()).to.equal(0n);
      expect(await vault.totalShares()).to.equal(0n);
    });
  });

  describe("setStrategy", function () {
    it("Should allow owner to set strategy", async function () {
      await vault.setStrategy(strategy.address);
      expect(await vault.strategy()).to.equal(strategy.address);
    });

    it("Should not allow non-owner to set strategy", async function () {
      await expect(vault.connect(user1).setStrategy(strategy.address))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("convertToShares", function () {
    it("Should return correct shares for initial deposit", async function () {
      const assets = ethers.parseEther("100");
      const shares = await vault.convertToShares(assets);
      expect(shares).to.equal(assets);
    });

    it("Should return correct shares after deposits", async function () {
      await vault.connect(user1).deposit(ethers.parseEther("100"), user1.address);
      const assets = ethers.parseEther("50");
      const shares = await vault.convertToShares(assets);
      expect(shares).to.equal(ethers.parseEther("50"));
    });
  });

  describe("convertToAssets", function () {
    it("Should return correct assets for initial shares", async function () {
      const shares = ethers.parseEther("100");
      const assets = await vault.convertToAssets(shares);
      expect(assets).to.equal(shares);
    });

    it("Should return correct assets after deposits", async function () {
      await vault.connect(user1).deposit(ethers.parseEther("100"), user1.address);
      const shares = ethers.parseEther("50");
      const assets = await vault.convertToAssets(shares);
      expect(assets).to.equal(ethers.parseEther("50"));
    });
  });

  describe("deposit", function () {
    it("Should allow deposit and emit Deposit event", async function () {
      const assets = ethers.parseEther("100");
      const shares = await vault.convertToShares(assets);

      await expect(vault.connect(user1).deposit(assets, user1.address))
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, assets, shares);

      expect(await vault.totalAssets()).to.equal(assets);
      expect(await vault.totalShares()).to.equal(shares);
      expect(await vault.sharesOf(user1.address)).to.equal(shares);
    });

    it("Should revert for zero shares", async function () {
      await expect(vault.connect(user1).deposit(0n, user1.address))
        .to.be.revertedWith("Zero shares");
    });

    it("Should forward assets to strategy if set", async function () {
      await vault.setStrategy(strategy.address);
      const assets = ethers.parseEther("100");

      await vault.connect(user1).deposit(assets, user1.address);

      const strategyBalance = await asset.balanceOf(strategy.address);
      expect(strategyBalance).to.equal(assets);
    });
  });

  describe("withdraw", function () {
    beforeEach(async function () {
      await vault.connect(user1).deposit(ethers.parseEther("100"), user1.address);
    });

    it("Should allow withdrawal and emit Withdraw event", async function () {
      const shares = ethers.parseEther("50");
      const assets = await vault.convertToAssets(shares);

      await expect(vault.connect(user1).withdraw(shares, user1.address))
        .to.emit(vault, "Withdraw")
        .withArgs(user1.address, user1.address, assets, shares);

      expect(await vault.totalAssets()).to.equal(ethers.parseEther("50"));
      expect(await vault.totalShares()).to.equal(ethers.parseEther("50"));
      expect(await vault.sharesOf(user1.address)).to.equal(ethers.parseEther("50"));
    });

    it("Should revert for insufficient shares", async function () {
      const shares = ethers.parseEther("150");
      await expect(vault.connect(user1).withdraw(shares, user1.address))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("reportProfit", function () {
    beforeEach(async function () {
      await vault.setStrategy(strategy.address);
      await vault.connect(user1).deposit(ethers.parseEther("100"), user1.address);
    });

    it("Should allow strategy to report profit and emit Harvested event", async function () {
      const profit = ethers.parseEther("50");

      await expect(vault.connect(strategy).reportProfit(profit))
        .to.emit(vault, "Harvested")
        .withArgs(profit);

      expect(await vault.totalAssets()).to.equal(ethers.parseEther("150"));
    });

    it("Should revert if not called by strategy", async function () {
      const profit = ethers.parseEther("50");
      await expect(vault.connect(user1).reportProfit(profit))
        .to.be.revertedWith("Not strategy");
    });
  });
});