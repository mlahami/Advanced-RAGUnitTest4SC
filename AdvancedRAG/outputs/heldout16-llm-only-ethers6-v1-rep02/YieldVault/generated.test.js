const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YieldVault", function () {
  let vault, asset, owner, user1, user2, strategy;
  const ASSET_NAME = "Test Asset";
  const ASSET_SYMBOL = "TST";
  const VAULT_NAME = "Test Vault";
  const VAULT_SYMBOL = "TVLT";
  const INITIAL_SUPPLY = ethers.parseEther("1000000");

  beforeEach(async function () {
    [owner, user1, user2, strategy] = await ethers.getSigners();

    // Deploy asset token
    const Asset = await ethers.getContractFactory("BenchmarkERC20");
    asset = await Asset.deploy(ASSET_NAME, ASSET_SYMBOL);
    await asset.waitForDeployment();

    // Mint initial supply to users
    await asset.mint(user1.address, INITIAL_SUPPLY);
    await asset.mint(user2.address, INITIAL_SUPPLY);

    // Deploy vault
    const Vault = await ethers.getContractFactory("YieldVault");
    vault = await Vault.deploy(await asset.getAddress(), VAULT_NAME, VAULT_SYMBOL);
    await vault.waitForDeployment();

    // Approve vault to spend assets
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
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });
  });

  describe("convertToShares", function () {
    it("Should return assets when totalAssets is zero", async function () {
      const assets = ethers.parseEther("100");
      expect(await vault.convertToShares(assets)).to.equal(assets);
    });

    it("Should calculate shares correctly when totalAssets > 0", async function () {
      const assets = ethers.parseEther("100");
      await vault.connect(user1).deposit(assets, user1.address);
      const shares = await vault.convertToShares(assets);
      expect(shares).to.equal(assets);
    });
  });

  describe("convertToAssets", function () {
    it("Should return shares when totalShares is zero", async function () {
      const shares = ethers.parseEther("100");
      expect(await vault.convertToAssets(shares)).to.equal(shares);
    });

    it("Should calculate assets correctly when totalShares > 0", async function () {
      const assets = ethers.parseEther("100");
      await vault.connect(user1).deposit(assets, user1.address);
      const shares = await vault.convertToShares(assets);
      expect(await vault.convertToAssets(shares)).to.equal(assets);
    });
  });

  describe("deposit", function () {
    it("Should deposit assets and mint shares", async function () {
      const assets = ethers.parseEther("100");
      const tx = await vault.connect(user1).deposit(assets, user1.address);
      await expect(tx)
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, assets, assets);

      expect(await vault.totalAssets()).to.equal(assets);
      expect(await vault.totalShares()).to.equal(assets);
      expect(await vault.sharesOf(user1.address)).to.equal(assets);
    });

    it("Should revert when depositing zero assets", async function () {
      await expect(vault.connect(user1).deposit(0n, user1.address))
        .to.be.revertedWith("Zero shares");
    });

    it("Should forward assets to strategy when strategy is set", async function () {
      await vault.setStrategy(strategy.address);
      const assets = ethers.parseEther("100");
      const tx = await vault.connect(user1).deposit(assets, user1.address);

      await expect(tx)
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, assets, assets);

      expect(await asset.balanceOf(strategy.address)).to.equal(assets);
    });
  });

  describe("withdraw", function () {
    it("Should withdraw assets and burn shares", async function () {
      const assets = ethers.parseEther("100");
      await vault.connect(user1).deposit(assets, user1.address);

      const shares = await vault.convertToShares(assets);
      const tx = await vault.connect(user1).withdraw(shares, user1.address);

      await expect(tx)
        .to.emit(vault, "Withdraw")
        .withArgs(user1.address, user1.address, assets, shares);

      expect(await vault.totalAssets()).to.equal(0n);
      expect(await vault.totalShares()).to.equal(0n);
      expect(await vault.sharesOf(user1.address)).to.equal(0n);
    });

    it("Should revert when withdrawing more shares than owned", async function () {
      const assets = ethers.parseEther("100");
      await vault.connect(user1).deposit(assets, user1.address);

      const shares = await vault.convertToShares(assets);
      await expect(vault.connect(user1).withdraw(shares + 1n, user1.address))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("reportProfit", function () {
    it("Should allow strategy to report profit", async function () {
      await vault.setStrategy(strategy.address);
      const profit = ethers.parseEther("50");

      const tx = await vault.connect(strategy).reportProfit(profit);
      await expect(tx)
        .to.emit(vault, "Harvested")
        .withArgs(profit);

      expect(await vault.totalAssets()).to.equal(profit);
    });

    it("Should revert when non-strategy tries to report profit", async function () {
      await vault.setStrategy(strategy.address);
      await expect(vault.connect(user1).reportProfit(ethers.parseEther("50")))
        .to.be.revertedWith("Not strategy");
    });
  });
});