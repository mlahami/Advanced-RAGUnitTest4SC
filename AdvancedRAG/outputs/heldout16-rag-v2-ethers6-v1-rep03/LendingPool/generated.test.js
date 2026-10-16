const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LendingPool", function () {
  let lendingPool, loanToken, owner, user1, user2;
  const ETH_PRICE = 1000n; // 1 ETH = 1000 tokens
  const COLLATERAL_FACTOR = 150n; // 150%
  const LIQUIDATION_BONUS = 10n; // 10%

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy loan token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    loanToken = await BenchmarkERC20.deploy("Loan Token", "LT");
    await loanToken.waitForDeployment();

    // Deploy lending pool
    const LendingPool = await ethers.getContractFactory("LendingPool");
    lendingPool = await LendingPool.deploy(await loanToken.getAddress());
    await lendingPool.waitForDeployment();

    // Mint loan tokens to users
    await loanToken.mint(user1.address, ethers.parseEther("10000"));
    await loanToken.mint(user2.address, ethers.parseEther("10000"));
  });

  describe("Deposit Collateral", function () {
    it("should deposit ETH as collateral", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(lendingPool.connect(user1).depositCollateral({ value: depositAmount }))
        .to.emit(lendingPool, "CollateralDeposited")
        .withArgs(user1.address, depositAmount);

      expect(await lendingPool.collateral(user1.address)).to.equal(depositAmount);
    });

    it("should revert when depositing zero ETH", async function () {
      await expect(lendingPool.connect(user1).depositCollateral({ value: 0 }))
        .to.be.revertedWith("Send ETH");
    });
  });

  describe("Borrow", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
    });

    it("should allow borrowing within collateral limit", async function () {
      const borrowAmount = ethers.parseEther("500"); // 500 tokens
      await expect(lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE))
        .to.emit(lendingPool, "Borrowed")
        .withArgs(user1.address, borrowAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount);
      expect(await loanToken.balanceOf(user1.address)).to.equal(ethers.parseEther("10000") + borrowAmount);
    });

    it("should revert when borrowing exceeds collateral limit", async function () {
      const borrowAmount = ethers.parseEther("1001"); // 1001 tokens (1 ETH = 1000 tokens, 150% limit)
      await expect(lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE))
        .to.be.revertedWith("Undercollateralized");
    });

    it("should revert when borrowing zero amount", async function () {
      await expect(lendingPool.connect(user1).borrow(0, ETH_PRICE))
        .to.be.revertedWith("Undercollateralized");
    });
  });

  describe("Repay", function () {
    const borrowAmount = ethers.parseEther("500");

    beforeEach(async function () {
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE);
    });

    it("should allow partial repayment", async function () {
      const repayAmount = ethers.parseEther("200");
      await expect(lendingPool.connect(user1).repay(repayAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, repayAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount - repayAmount);
      expect(await loanToken.balanceOf(user1.address)).to.equal(ethers.parseEther("10000") + borrowAmount - repayAmount);
    });

    it("should allow full repayment", async function () {
      await expect(lendingPool.connect(user1).repay(borrowAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, borrowAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(0);
      expect(await loanToken.balanceOf(user1.address)).to.equal(ethers.parseEther("10000"));
    });

    it("should revert when repaying more than debt", async function () {
      await expect(lendingPool.connect(user1).repay(borrowAmount + 1n))
        .to.be.revertedWith("Excess repay");
    });

    it("should revert when repaying zero amount", async function () {
      await expect(lendingPool.connect(user1).repay(0))
        .to.be.revertedWith("Excess repay");
    });
  });

  describe("Liquidate", function () {
    const borrowAmount = ethers.parseEther("1001"); // Exceeds 150% limit

    beforeEach(async function () {
      // User1 deposits collateral
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });

      // User1 borrows too much
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE);

      // Price drops to make position undercollateralized
      const newEthPrice = 999n; // 1 ETH = 999 tokens
      await lendingPool.connect(user1).borrow(0, newEthPrice); // Update price
    });

    it("should liquidate undercollateralized position", async function () {
      const initialCollateral = await lendingPool.collateral(user1.address);
      const initialDebt = await lendingPool.debt(user1.address);

      await expect(lendingPool.connect(user2).liquidate(user1.address, ETH_PRICE))
        .to.emit(lendingPool, "Liquidated")
        .withArgs(user1.address, user2.address);

      expect(await lendingPool.collateral(user1.address)).to.equal(0);
      expect(await lendingPool.debt(user1.address)).to.equal(0);

      // User2 should receive the collateral
      const user2Balance = await ethers.provider.getBalance(user2.address);
      expect(user2Balance).to.be.above(0);
    });

    it("should revert when liquidating healthy position", async function () {
      // First repay some debt to make position healthy again
      const repayAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).repay(repayAmount);

      await expect(lendingPool.connect(user2).liquidate(user1.address, ETH_PRICE))
        .to.be.revertedWith("Position healthy");
    });

    it("should revert when liquidating own position", async function () {
      await expect(lendingPool.connect(user1).liquidate(user1.address, ETH_PRICE))
        .to.be.revertedWith("Position healthy");
    });
  });
});