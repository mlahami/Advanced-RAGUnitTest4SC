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
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("convertToShares", function () {
    it("Should return assets when no shares exist", async function () {
      const assets = ethers.parseEther("100");
      expect(await vault.convertToShares(assets)).to.equal(assets);
    });

    it("Should calculate correct shares for existing deposits", async function () {
      const assets = ethers.parseEther("100");
      await vault.connect(user1).deposit(assets, user1.address);

      const newAssets = ethers.parseEther("50");
      const expectedShares = (newAssets * await vault.totalShares()) / await vault.totalAssets();
      expect(await vault.convertToShares(newAssets)).to.equal(expectedShares);
    });
  });

  describe("convertToAssets", function () {
    it("Should return shares when no assets exist", async function () {
      const shares = 100n;
      expect(await vault.convertToAssets(shares)).to.equal(shares);
    });

    it("Should calculate correct assets for existing deposits", async function () {
      const assets = ethers.parseEther("100");
      await vault.connect(user1).deposit(assets, user1.address);

      const shares = await vault.totalShares();
      const expectedAssets = (shares * await vault.totalAssets()) / await vault.totalShares();
      expect(await vault.convertToAssets(shares)).to.equal(expectedAssets);
    });
  });

  describe("deposit", function () {
    it("Should deposit assets and mint shares", async function () {
      const assets = ethers.parseEther("100");
      const tx = await vault.connect(user1).deposit(assets, user1.address);
      const receipt = await tx.wait();

      const shares = await vault.sharesOf(user1.address);
      expect(shares).to.be.gt(0n);

      // Check events
      await expect(tx)
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, assets, shares);

      // Check state
      expect(await vault.totalAssets()).to.equal(assets);
      expect(await vault.totalShares()).to.equal(shares);
      expect(await asset.balanceOf(await vault.getAddress())).to.equal(assets);
    });

    it("Should forward assets to strategy if set", async function () {
      await vault.setStrategy(strategy.address);
      const assets = ethers.parseEther("100");
      await vault.connect(user1).deposit(assets, user1.address);

      expect(await asset.balanceOf(strategy.address)).to.equal(assets);
    });

    it("Should revert for zero shares", async function () {
      await expect(vault.connect(user1).deposit(0n, user1.address))
        .to.be.revertedWith("Zero shares");
    });
  });

  describe("withdraw", function () {
    it("Should withdraw assets and burn shares", async function () {
      const assets = ethers.parseEther("100");
      await vault.connect(user1).deposit(assets, user1.address);
      const shares = await vault.sharesOf(user1.address);

      const tx = await vault.connect(user1).withdraw(shares, user1.address);
      const receipt = await tx.wait();

      // Check events
      await expect(tx)
        .to.emit(vault, "Withdraw")
        .withArgs(user1.address, user1.address, assets, shares);

      // Check state
      expect(await vault.sharesOf(user1.address)).to.equal(0n);
      expect(await vault.totalAssets()).to.equal(0n);
      expect(await vault.totalShares()).to.equal(0n);
      expect(await asset.balanceOf(user1.address)).to.equal(INITIAL_SUPPLY);
    });

    it("Should revert for insufficient shares", async function () {
      const assets = ethers.parseEther("100");
      await vault.connect(user1).deposit(assets, user1.address);
      const shares = await vault.sharesOf(user1.address);

      await expect(vault.connect(user1).withdraw(shares + 1n, user1.address))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("reportProfit", function () {
    it("Should allow strategy to report profit", async function () {
      await vault.setStrategy(strategy.address);
      const profit = ethers.parseEther("50");

      const tx = await vault.connect(strategy).reportProfit(profit);
      const receipt = await tx.wait();

      // Check events
      await expect(tx)
        .to.emit(vault, "Harvested")
        .withArgs(profit);

      // Check state
      expect(await vault.totalAssets()).to.equal(profit);
    });

    it("Should revert for non-strategy caller", async function () {
      await expect(vault.connect(user1).reportProfit(ethers.parseEther("1")))
        .to.be.revertedWith("Not strategy");
    });
  });
});