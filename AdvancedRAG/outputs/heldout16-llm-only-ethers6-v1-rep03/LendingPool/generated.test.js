const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LendingPool", function () {
  let lendingPool;
  let loanToken;
  let owner;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy BenchmarkERC20 as loan token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    loanToken = await BenchmarkERC20.deploy("LoanToken", "LT");
    await loanToken.waitForDeployment();

    // Deploy LendingPool with loanToken address
    const LendingPool = await ethers.getContractFactory("LendingPool");
    lendingPool = await LendingPool.deploy(await loanToken.getAddress());
    await lendingPool.waitForDeployment();

    // Mint loan tokens to the lending pool
    await loanToken.mint(await lendingPool.getAddress(), ethers.parseEther("1000000"));
  });

  describe("Deployment", function () {
    it("Should set the correct loan token", async function () {
      expect(await lendingPool.loanToken()).to.equal(await loanToken.getAddress());
    });

    it("Should have correct constants", async function () {
      expect(await lendingPool.COLLATERAL_FACTOR()).to.equal(150n);
      expect(await lendingPool.LIQUIDATION_BONUS()).to.equal(10n);
    });
  });

  describe("depositCollateral", function () {
    it("Should deposit ETH as collateral", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(lendingPool.connect(user1).depositCollateral({ value: depositAmount }))
        .to.emit(lendingPool, "CollateralDeposited")
        .withArgs(user1.address, depositAmount);

      expect(await lendingPool.collateral(user1.address)).to.equal(depositAmount);
    });

    it("Should revert when depositing zero ETH", async function () {
      await expect(lendingPool.connect(user1).depositCollateral({ value: 0 }))
        .to.be.revertedWith("Send ETH");
    });
  });

  describe("borrow", function () {
    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
    });

    it("Should allow borrowing within collateral limit", async function () {
      const ethPrice = 1000n; // 1 ETH = 1000 tokens
      const borrowAmount = (1n * ethPrice * 100n) / 150n; // 1 ETH collateral * 100% * 100 / 150% = 666.666... tokens

      await expect(lendingPool.connect(user1).borrow(borrowAmount, ethPrice))
        .to.emit(lendingPool, "Borrowed")
        .withArgs(user1.address, borrowAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount);
      expect(await loanToken.balanceOf(user1.address)).to.equal(borrowAmount);
    });

    it("Should revert when borrowing exceeds collateral limit", async function () {
      const ethPrice = 1000n;
      const borrowAmount = (1n * ethPrice * 100n) / 150n + 1n; // Just over the limit

      await expect(lendingPool.connect(user1).borrow(borrowAmount, ethPrice))
        .to.be.revertedWith("Undercollateralized");
    });
  });

  describe("repay", function () {
    let borrowAmount;
    let ethPrice;

    beforeEach(async function () {
      ethPrice = 1000n;
      borrowAmount = (1n * ethPrice * 100n) / 150n;

      await lendingPool.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
      await loanToken.connect(owner).approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);
    });

    it("Should allow repaying debt", async function () {
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), borrowAmount);

      await expect(lendingPool.connect(user1).repay(borrowAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, borrowAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(0n);
      expect(await loanToken.balanceOf(user1.address)).to.equal(0n);
    });

    it("Should revert when repaying more than debt", async function () {
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), borrowAmount + 1n);

      await expect(lendingPool.connect(user1).repay(borrowAmount + 1n))
        .to.be.revertedWith("Excess repay");
    });
  });

  describe("liquidate", function () {
    let borrowAmount;
    let ethPrice;

    beforeEach(async function () {
      ethPrice = 1000n;
      borrowAmount = (1n * ethPrice * 100n) / 150n;

      await lendingPool.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
      await loanToken.connect(owner).approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);
    });

    it("Should liquidate undercollateralized position", async function () {
      // Reduce ETH price to make position undercollateralized
      const newEthPrice = 500n; // 1 ETH = 500 tokens
      const collateralAmount = ethers.parseEther("1");

      await expect(lendingPool.connect(user2).liquidate(user1.address, newEthPrice))
        .to.emit(lendingPool, "Liquidated")
        .withArgs(user1.address, user2.address);

      expect(await lendingPool.collateral(user1.address)).to.equal(0n);
      expect(await lendingPool.debt(user1.address)).to.equal(0n);
      expect(await ethers.provider.getBalance(await lendingPool.getAddress())).to.equal(0n);
    });

    it("Should revert when liquidating healthy position", async function () {
      await expect(lendingPool.connect(user2).liquidate(user1.address, ethPrice))
        .to.be.revertedWith("Position healthy");
    });
  });
});