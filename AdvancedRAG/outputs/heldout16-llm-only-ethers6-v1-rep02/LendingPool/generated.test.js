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
    loanToken = await BenchmarkERC20.deploy("Loan Token", "LT");
    await loanToken.waitForDeployment();

    // Deploy LendingPool with loan token address
    const LendingPool = await ethers.getContractFactory("LendingPool");
    lendingPool = await LendingPool.deploy(await loanToken.getAddress());
    await lendingPool.waitForDeployment();

    // Mint loan tokens to users
    await loanToken.mint(user1.address, ethers.parseEther("1000"));
    await loanToken.mint(user2.address, ethers.parseEther("1000"));
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
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
    });

    it("Should allow borrowing within collateral limit", async function () {
      const ethPrice = 1000n; // 1 ETH = 1000 tokens
      const borrowAmount = ethers.parseEther("100"); // 100 tokens

      await expect(lendingPool.connect(user1).borrow(borrowAmount, ethPrice))
        .to.emit(lendingPool, "Borrowed")
        .withArgs(user1.address, borrowAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount);
      expect(await loanToken.balanceOf(user1.address)).to.equal(ethers.parseEther("1100")); // 1000 initial + 100 borrowed
    });

    it("Should revert when borrowing exceeds collateral limit", async function () {
      const ethPrice = 1000n; // 1 ETH = 1000 tokens
      const borrowAmount = ethers.parseEther("151"); // 151 tokens (1 ETH = 1000 tokens, 150% collateral)

      await expect(lendingPool.connect(user1).borrow(borrowAmount, ethPrice))
        .to.be.revertedWith("Undercollateralized");
    });
  });

  describe("repay", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });

      const ethPrice = 1000n; // 1 ETH = 1000 tokens
      const borrowAmount = ethers.parseEther("100");
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);

      // Approve lending pool to transfer loan tokens
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);
    });

    it("Should allow repaying debt", async function () {
      const repayAmount = ethers.parseEther("50");

      await expect(lendingPool.connect(user1).repay(repayAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, repayAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(ethers.parseEther("50"));
      expect(await loanToken.balanceOf(user1.address)).to.equal(ethers.parseEther("1050")); // 1000 initial + 100 borrowed - 50 repaid
    });

    it("Should revert when repaying more than debt", async function () {
      const repayAmount = ethers.parseEther("150");

      await expect(lendingPool.connect(user1).repay(repayAmount))
        .to.be.revertedWith("Excess repay");
    });
  });

  describe("liquidate", function () {
    beforeEach(async function () {
      // User1 deposits collateral
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });

      // User1 borrows
      const ethPrice = 1000n; // 1 ETH = 1000 tokens
      const borrowAmount = ethers.parseEther("150");
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);

      // Price drops to make position undercollateralized
      const newEthPrice = 900n; // 1 ETH = 900 tokens
      await lendingPool.connect(user1).borrow(0, newEthPrice); // Just to update debt calculation
    });

    it("Should allow liquidation of undercollateralized position", async function () {
      const initialCollateral = await lendingPool.collateral(user1.address);
      const initialDebt = await lendingPool.debt(user1.address);

      await expect(lendingPool.connect(user2).liquidate(user1.address, 900n))
        .to.emit(lendingPool, "Liquidated")
        .withArgs(user1.address, user2.address);

      expect(await lendingPool.collateral(user1.address)).to.equal(0n);
      expect(await lendingPool.debt(user1.address)).to.equal(0n);

      // Check user2 received the collateral
      const user2Balance = await ethers.provider.getBalance(user2.address);
      expect(user2Balance).to.be.gt(ethers.parseEther("10000")); // Initial balance + 1 ETH collateral
    });

    it("Should revert when liquidating healthy position", async function () {
      // First repay some debt to make position healthy
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).repay(ethers.parseEther("50"));

      await expect(lendingPool.connect(user2).liquidate(user1.address, 900n))
        .to.be.revertedWith("Position healthy");
    });
  });
});