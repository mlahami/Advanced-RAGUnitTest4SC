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

    // Deploy mock ERC20 asset
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    asset = await BenchmarkERC20.deploy("Test Asset", "TST");
    await asset.waitForDeployment();

    // Deploy YieldVault
    const YieldVault = await ethers.getContractFactory("YieldVault");
    vault = await YieldVault.deploy(
      await asset.getAddress(),
      "Test Vault",
      "TVLT"
    );
    await vault.waitForDeployment();

    // Mint assets to users
    await asset.mint(user1.address, ethers.parseEther("1000"));
    await asset.mint(user2.address, ethers.parseEther("1000"));

    // Approve vault to spend assets
    await asset.connect(user1).approve(await vault.getAddress(), ethers.MaxUint256);
    await asset.connect(user2).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct asset, name, and symbol", async function () {
      expect(await vault.asset()).to.equal(await asset.getAddress());
      expect(await vault.name()).to.equal("Test Vault");
      expect(await vault.symbol()).to.equal("TVLT");
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
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("convertToShares", function () {
    it("Should return assets when totalAssets is zero", async function () {
      const assets = ethers.parseEther("100");
      expect(await vault.convertToShares(assets)).to.equal(assets);
    });

    it("Should calculate shares correctly when totalAssets > 0", async function () {
      // Deposit some assets first
      await vault.connect(user1).deposit(ethers.parseEther("100"), user1.address);

      // Check conversion
      const assets = ethers.parseEther("50");
      const expectedShares = (assets * 100n) / 100n; // 1:1 ratio in this case
      expect(await vault.convertToShares(assets)).to.equal(expectedShares);
    });
  });

  describe("convertToAssets", function () {
    it("Should return shares when totalShares is zero", async function () {
      const shares = ethers.parseEther("100");
      expect(await vault.convertToAssets(shares)).to.equal(shares);
    });

    it("Should calculate assets correctly when totalShares > 0", async function () {
      // Deposit some assets first
      await vault.connect(user1).deposit(ethers.parseEther("100"), user1.address);

      // Check conversion
      const shares = ethers.parseEther("50");
      const expectedAssets = (shares * 100n) / 100n; // 1:1 ratio in this case
      expect(await vault.convertToAssets(shares)).to.equal(expectedAssets);
    });
  });

  describe("deposit", function () {
    it("Should deposit assets and mint shares", async function () {
      const assets = ethers.parseEther("100");
      const expectedShares = assets; // 1:1 ratio initially

      await expect(vault.connect(user1).deposit(assets, user1.address))
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, assets, expectedShares);

      expect(await vault.totalAssets()).to.equal(assets);
      expect(await vault.totalShares()).to.equal(expectedShares);
      expect(await vault.sharesOf(user1.address)).to.equal(expectedShares);
    });

    it("Should forward assets to strategy if set", async function () {
      await vault.setStrategy(strategy.address);
      const assets = ethers.parseEther("100");

      const initialVaultBalance = await asset.balanceOf(await vault.getAddress());
      const initialStrategyBalance = await asset.balanceOf(strategy.address);

      await vault.connect(user1).deposit(assets, user1.address);

      expect(await asset.balanceOf(await vault.getAddress())).to.equal(initialVaultBalance);
      expect(await asset.balanceOf(strategy.address)).to.equal(initialStrategyBalance + assets);
    });

    it("Should revert when trying to deposit zero assets", async function () {
      await expect(vault.connect(user1).deposit(0n, user1.address))
        .to.be.revertedWith("Zero shares");
    });
  });

  describe("withdraw", function () {
    beforeEach(async function () {
      // Deposit some assets first
      await vault.connect(user1).deposit(ethers.parseEther("100"), user1.address);
    });

    it("Should withdraw assets and burn shares", async function () {
      const shares = ethers.parseEther("50");
      const expectedAssets = ethers.parseEther("50"); // 1:1 ratio

      await expect(vault.connect(user1).withdraw(shares, user1.address))
        .to.emit(vault, "Withdraw")
        .withArgs(user1.address, user1.address, expectedAssets, shares);

      expect(await vault.totalAssets()).to.equal(ethers.parseEther("50"));
      expect(await vault.totalShares()).to.equal(ethers.parseEther("50"));
      expect(await vault.sharesOf(user1.address)).to.equal(ethers.parseEther("50"));
    });

    it("Should revert when trying to withdraw more shares than owned", async function () {
      const shares = ethers.parseEther("150"); // More than user has
      await expect(vault.connect(user1).withdraw(shares, user1.address))
        .to.be.revertedWith("Insufficient shares");
    });
  });

  describe("reportProfit", function () {
    beforeEach(async function () {
      await vault.setStrategy(strategy.address);
    });

    it("Should allow strategy to report profit", async function () {
      const profit = ethers.parseEther("50");

      await expect(vault.connect(strategy).reportProfit(profit))
        .to.emit(vault, "Harvested")
        .withArgs(profit);

      expect(await vault.totalAssets()).to.equal(profit);
    });

    it("Should revert when non-strategy tries to report profit", async function () {
      await expect(vault.connect(user1).reportProfit(ethers.parseEther("50")))
        .to.be.revertedWith("Not strategy");
    });
  });
});