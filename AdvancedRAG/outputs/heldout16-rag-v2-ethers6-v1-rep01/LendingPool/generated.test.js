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

    // Mint loan tokens to users
    await loanToken.mint(user1.address, ethers.parseEther("10000"));
    await loanToken.mint(user2.address, ethers.parseEther("10000"));
  });

  describe("Deposit Collateral", function () {
    it("should allow depositing ETH as collateral", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(
        lendingPool.connect(user1).depositCollateral({ value: depositAmount })
      )
        .to.emit(lendingPool, "CollateralDeposited")
        .withArgs(user1.address, depositAmount);

      expect(await lendingPool.collateral(user1.address)).to.equal(depositAmount);
    });

    it("should revert when depositing zero ETH", async function () {
      await expect(
        lendingPool.connect(user1).depositCollateral({ value: 0 })
      ).to.be.revertedWith("Send ETH");
    });
  });

  describe("Borrow", function () {
    it("should allow borrowing when collateralized", async function () {
      const depositAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("100");
      const ethPrice = 100n; // 1 ETH = 100 tokens

      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);

      await expect(
        lendingPool.connect(user1).borrow(borrowAmount, ethPrice)
      )
        .to.emit(lendingPool, "Borrowed")
        .withArgs(user1.address, borrowAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount);
      expect(await loanToken.balanceOf(user1.address)).to.equal(ethers.parseEther("10100"));
    });

    it("should revert when borrowing exceeds collateral limit", async function () {
      const depositAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("151"); // 150% of 1 ETH at 100 tokens/ETH
      const ethPrice = 100n;

      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });

      await expect(
        lendingPool.connect(user1).borrow(borrowAmount, ethPrice)
      ).to.be.revertedWith("Undercollateralized");
    });

    it("should revert when borrowing zero amount", async function () {
      const depositAmount = ethers.parseEther("1");
      const ethPrice = 100n;

      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });

      await expect(
        lendingPool.connect(user1).borrow(0, ethPrice)
      ).to.be.revertedWith("Undercollateralized");
    });
  });

  describe("Repay", function () {
    it("should allow repaying debt", async function () {
      const depositAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("100");
      const repayAmount = ethers.parseEther("50");
      const ethPrice = 100n;

      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);

      await expect(
        lendingPool.connect(user1).repay(repayAmount)
      )
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, repayAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount - repayAmount);
      expect(await loanToken.balanceOf(user1.address)).to.equal(ethers.parseEther("9950"));
    });

    it("should revert when repaying more than debt", async function () {
      const depositAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("100");
      const repayAmount = ethers.parseEther("150");
      const ethPrice = 100n;

      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);

      await expect(
        lendingPool.connect(user1).repay(repayAmount)
      ).to.be.revertedWith("Excess repay");
    });
  });

  describe("Liquidate", function () {
    it("should allow liquidating undercollateralized positions", async function () {
      const depositAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("100");
      const ethPrice = 100n;

      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);

      // Reduce ETH price to make position undercollateralized
      const newEthPrice = 99n; // 1 ETH = 99 tokens
      const user1Collateral = await lendingPool.collateral(user1.address);

      await expect(
        lendingPool.connect(user2).liquidate(user1.address, newEthPrice)
      )
        .to.emit(lendingPool, "Liquidated")
        .withArgs(user1.address, user2.address);

      expect(await lendingPool.collateral(user1.address)).to.equal(0);
      expect(await lendingPool.debt(user1.address)).to.equal(0);
      expect(await ethers.provider.getBalance(await lendingPool.getAddress())).to.equal(0);
    });

    it("should revert when liquidating healthy positions", async function () {
      const depositAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("100");
      const ethPrice = 100n;

      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);

      await expect(
        lendingPool.connect(user2).liquidate(user1.address, ethPrice)
      ).to.be.revertedWith("Position healthy");
    });
  });

  describe("State Variables", function () {
    it("should correctly report constants", async function () {
      expect(await lendingPool.COLLATERAL_FACTOR()).to.equal(150n);
      expect(await lendingPool.LIQUIDATION_BONUS()).to.equal(10n);
    });

    it("should correctly track collateral and debt", async function () {
      const depositAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("100");
      const ethPrice = 100n;

      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);
      await lendingPool.connect(user1).borrow(borrowAmount, ethPrice);

      expect(await lendingPool.collateral(user1.address)).to.equal(depositAmount);
      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount);
    });
  });
});