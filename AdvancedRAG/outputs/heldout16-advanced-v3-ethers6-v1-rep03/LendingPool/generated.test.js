const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LendingPool", function () {
  let lendingPool, loanToken, owner, user1, user2;
  const COLLATERAL_FACTOR = 150n;
  const LIQUIDATION_BONUS = 10n;

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

    // Mint loan tokens to lending pool
    await loanToken.mint(await lendingPool.getAddress(), ethers.parseEther("1000000"));
  });

  describe("Deposit Collateral", function () {
    it("Should deposit ETH collateral", async function () {
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });

      expect(await lendingPool.collateral(user1.address)).to.equal(depositAmount);
    });

    it("Should emit CollateralDeposited event", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(lendingPool.connect(user1).depositCollateral({ value: depositAmount }))
        .to.emit(lendingPool, "CollateralDeposited")
        .withArgs(user1.address, depositAmount);
    });

    it("Should revert when depositing zero ETH", async function () {
      await expect(lendingPool.connect(user1).depositCollateral({ value: 0 }))
        .to.be.revertedWith("Send ETH");
    });
  });

  describe("Borrow", function () {
    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
    });

    it("Should allow borrowing within collateral limit", async function () {
      const ethPrice = 1000n; // 1 ETH = 1000 tokens
      const borrowAmount = (1n * ethPrice * 100n) / COLLATERAL_FACTOR;

      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount);
      expect(await loanToken.balanceOf(user1.address)).to.equal(borrowAmount);
    });

    it("Should emit Borrowed event", async function () {
      const ethPrice = 1000n;
      const borrowAmount = (1n * ethPrice * 100n) / COLLATERAL_FACTOR;

      await expect(lendingPool.connect(user1).borrow(borrowAmount, ethPrice))
        .to.emit(lendingPool, "Borrowed")
        .withArgs(user1.address, borrowAmount);
    });

    it("Should revert when borrowing over collateral limit", async function () {
      const ethPrice = 1000n;
      const maxBorrow = (1n * ethPrice * 100n) / COLLATERAL_FACTOR;
      const borrowAmount = maxBorrow + 1n;

      await expect(lendingPool.connect(user1).borrow(borrowAmount, ethPrice))
        .to.be.revertedWith("Undercollateralized");
    });
  });

  describe("Repay", function () {
    const ethPrice = 1000n;
    const borrowAmount = (1n * ethPrice * 100n) / COLLATERAL_FACTOR;

    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
      await loanToken.approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);
    });

    it("Should allow partial repayment", async function () {
      const repayAmount = borrowAmount / 2n;
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), repayAmount);
      await lendingPool.connect(user1).repay(repayAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount - repayAmount);
    });

    it("Should emit Repaid event", async function () {
      const repayAmount = borrowAmount / 2n;
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), repayAmount);

      await expect(lendingPool.connect(user1).repay(repayAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, repayAmount);
    });

    it("Should revert when repaying more than debt", async function () {
      const repayAmount = borrowAmount + 1n;
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), repayAmount);

      await expect(lendingPool.connect(user1).repay(repayAmount))
        .to.be.revertedWith("Excess repay");
    });
  });

  describe("Liquidate", function () {
    const ethPrice = 1000n;
    const borrowAmount = (1n * ethPrice * 100n) / COLLATERAL_FACTOR;

    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
      await loanToken.approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);
    });

    it("Should liquidate undercollateralized position", async function () {
      // Reduce ETH price to make position undercollateralized
      const newEthPrice = ethPrice / 2n;
      const initialCollateral = await lendingPool.collateral(user1.address);

      await lendingPool.connect(user2).liquidate(user1.address, newEthPrice);

      expect(await lendingPool.collateral(user1.address)).to.equal(0n);
      expect(await lendingPool.debt(user1.address)).to.equal(0n);
      expect(await ethers.provider.getBalance(await lendingPool.getAddress())).to.equal(initialCollateral);
    });

    it("Should emit Liquidated event", async function () {
      const newEthPrice = ethPrice / 2n;

      await expect(lendingPool.connect(user2).liquidate(user1.address, newEthPrice))
        .to.emit(lendingPool, "Liquidated")
        .withArgs(user1.address, user2.address);
    });

    it("Should revert when liquidating healthy position", async function () {
      await expect(lendingPool.connect(user2).liquidate(user1.address, ethPrice))
        .to.be.revertedWith("Position healthy");
    });
  });
});