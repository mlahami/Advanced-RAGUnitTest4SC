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

    // Deploy BenchmarkERC20 as loanToken
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

    it("Should revert if no ETH is sent", async function () {
      await expect(lendingPool.connect(user1).depositCollateral())
        .to.be.revertedWith("Send ETH");
    });
  });

  describe("borrow", function () {
    const ethPrice = 1000n; // 1 ETH = 1000 tokens
    const collateralAmount = ethers.parseEther("1");

    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: collateralAmount });
    });

    it("Should allow borrowing within collateral limit", async function () {
      const borrowAmount = (collateralAmount * ethPrice * 100n) / 150n; // 150% collateralization
      await expect(lendingPool.connect(user1).borrow(borrowAmount, ethPrice))
        .to.emit(lendingPool, "Borrowed")
        .withArgs(user1.address, borrowAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount);
      expect(await loanToken.balanceOf(user1.address)).to.equal(borrowAmount);
    });

    it("Should revert if borrowing exceeds collateral limit", async function () {
      const borrowAmount = (collateralAmount * ethPrice * 100n) / 150n + 1n;
      await expect(lendingPool.connect(user1).borrow(borrowAmount, ethPrice))
        .to.be.revertedWith("Undercollateralized");
    });

    it("Should allow multiple borrows up to limit", async function () {
      const firstBorrow = (collateralAmount * ethPrice * 100n) / 300n; // 50% of limit
      const secondBorrow = (collateralAmount * ethPrice * 100n) / 300n; // another 50%

      await lendingPool.connect(user1).borrow(firstBorrow, ethPrice);
      await lendingPool.connect(user1).borrow(secondBorrow, ethPrice);

      const totalBorrowed = firstBorrow + secondBorrow;
      expect(await lendingPool.debt(user1.address)).to.equal(totalBorrowed);
    });
  });

  describe("repay", function () {
    const ethPrice = 1000n;
    const collateralAmount = ethers.parseEther("1");
    const borrowAmount = (collateralAmount * ethPrice * 100n) / 150n;

    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: collateralAmount });
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), borrowAmount);
    });

    it("Should allow partial repayment", async function () {
      const repayAmount = borrowAmount / 2n;
      await expect(lendingPool.connect(user1).repay(repayAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, repayAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(repayAmount);
    });

    it("Should allow full repayment", async function () {
      await expect(lendingPool.connect(user1).repay(borrowAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, borrowAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(0n);
    });

    it("Should revert if repaying more than borrowed", async function () {
      await expect(lendingPool.connect(user1).repay(borrowAmount + 1n))
        .to.be.revertedWith("Excess repay");
    });
  });

  describe("liquidate", function () {
    const ethPrice = 1000n;
    const collateralAmount = ethers.parseEther("1");
    const borrowAmount = (collateralAmount * ethPrice * 100n) / 150n;

    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: collateralAmount });
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);
    });

    it("Should liquidate undercollateralized position", async function () {
      // Reduce ETH price to make position undercollateralized
      const newEthPrice = ethPrice / 2n;
      const initialBalance = await ethers.provider.getBalance(user2.address);

      await expect(lendingPool.connect(user2).liquidate(user1.address, newEthPrice))
        .to.emit(lendingPool, "Liquidated")
        .withArgs(user1.address, user2.address);

      expect(await lendingPool.collateral(user1.address)).to.equal(0n);
      expect(await lendingPool.debt(user1.address)).to.equal(0n);

      // Check liquidator received the collateral
      const finalBalance = await ethers.provider.getBalance(user2.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("Should revert if position is healthy", async function () {
      await expect(lendingPool.connect(user2).liquidate(user1.address, ethPrice))
        .to.be.revertedWith("Position healthy");
    });

    it("Should revert if liquidation transfer fails", async function () {
      // Create a contract that will reject ETH transfers
      const RejectingContract = await ethers.getContractFactory("BenchmarkTarget");
      const rejectingContract = await RejectingContract.deploy();
      await rejectingContract.waitForDeployment();

      // Try to liquidate to a contract that rejects ETH
      const newEthPrice = ethPrice / 2n;
      await expect(lendingPool.connect(rejectingContract).liquidate(user1.address, newEthPrice))
        .to.be.revertedWith("Transfer failed");
    });
  });
});