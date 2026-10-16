const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LendingPool", function () {
  let lendingPool;
  let loanToken;
  let owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy BenchmarkERC20 as loan token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    loanToken = await BenchmarkERC20.deploy("Loan Token", "LT");
    await loanToken.waitForDeployment();

    // Deploy LendingPool
    const LendingPool = await ethers.getContractFactory("LendingPool");
    lendingPool = await LendingPool.deploy(await loanToken.getAddress());
    await lendingPool.waitForDeployment();

    // Mint loan tokens to the lending pool
    await loanToken.mint(await lendingPool.getAddress(), ethers.parseEther("1000000"));
  });

  describe("Deposit Collateral", function () {
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

  describe("Borrow Tokens", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
    });

    it("Should allow borrowing within collateral limit", async function () {
      const ethPrice = 1000n; // 1 ETH = 1000 tokens
      const borrowAmount = 100000n; // 100 tokens

      await expect(lendingPool.connect(user1).borrow(borrowAmount, ethPrice))
        .to.emit(lendingPool, "Borrowed")
        .withArgs(user1.address, borrowAmount);

      expect(await loanToken.balanceOf(user1.address)).to.equal(borrowAmount);
      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount);
    });

    it("Should revert when borrowing exceeds collateral limit", async function () {
      const ethPrice = 1000n; // 1 ETH = 1000 tokens
      const borrowAmount = 150000n; // 150 tokens (150% of 1 ETH)

      await expect(lendingPool.connect(user1).borrow(borrowAmount, ethPrice))
        .to.be.revertedWith("Undercollateralized");
    });

    it("Should revert when borrowing zero tokens", async function () {
      const ethPrice = 1000n;
      await expect(lendingPool.connect(user1).borrow(0, ethPrice))
        .to.be.revertedWith("Undercollateralized");
    });
  });

  describe("Repay Debt", function () {
    let borrowAmount;
    let ethPrice;

    beforeEach(async function () {
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });

      ethPrice = 1000n;
      borrowAmount = 100000n;
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);

      // Approve lending pool to transfer loan tokens
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), borrowAmount);
    });

    it("Should allow partial repayment", async function () {
      const repayAmount = 50000n; // 50 tokens

      await expect(lendingPool.connect(user1).repay(repayAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, repayAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount - repayAmount);
    });

    it("Should allow full repayment", async function () {
      await expect(lendingPool.connect(user1).repay(borrowAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, borrowAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(0);
    });

    it("Should revert when repaying more than debt", async function () {
      await expect(lendingPool.connect(user1).repay(borrowAmount + 1n))
        .to.be.revertedWith("Excess repay");
    });

    it("Should revert when repaying zero", async function () {
      await expect(lendingPool.connect(user1).repay(0))
        .to.be.revertedWith("Excess repay");
    });
  });

  describe("Liquidation", function () {
    let ethPrice;
    let borrowAmount;

    beforeEach(async function () {
      // User1 deposits collateral
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });

      // User1 borrows tokens
      ethPrice = 1000n;
      borrowAmount = 150000n; // 150 tokens (150% of 1 ETH)
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);

      // Price drops to make position undercollateralized
      ethPrice = 900n; // 1 ETH = 900 tokens
    });

    it("Should allow liquidation of undercollateralized position", async function () {
      const initialCollateral = await lendingPool.collateral(user1.address);
      const initialDebt = await lendingPool.debt(user1.address);

      await expect(lendingPool.connect(user2).liquidate(user1.address, ethPrice))
        .to.emit(lendingPool, "Liquidated")
        .withArgs(user1.address, user2.address);

      expect(await lendingPool.collateral(user1.address)).to.equal(0);
      expect(await lendingPool.debt(user1.address)).to.equal(0);

      // Liquidator should receive the seized collateral
      const liquidatorBalance = await ethers.provider.getBalance(user2.address);
      expect(liquidatorBalance).to.be.gt(0);
    });

    it("Should revert when liquidating healthy position", async function () {
      // Price increases to make position healthy again
      ethPrice = 1100n; // 1 ETH = 1100 tokens

      await expect(lendingPool.connect(user2).liquidate(user1.address, ethPrice))
        .to.be.revertedWith("Position healthy");
    });

    it("Should revert when liquidating own position", async function () {
      await expect(lendingPool.connect(user1).liquidate(user1.address, ethPrice))
        .to.be.revertedWith("Position healthy");
    });
  });
});