const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LendingPool", function () {
  let lendingPool;
  let loanToken;
  let owner, user1, user2, liquidator;
  const ETH_PRICE = 1000n; // 1 ETH = 1000 tokens

  beforeEach(async function () {
    [owner, user1, user2, liquidator] = await ethers.getSigners();

    // Deploy BenchmarkERC20 as loan token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    loanToken = await BenchmarkERC20.deploy("Loan Token", "LT");
    await loanToken.waitForDeployment();

    // Mint tokens to users
    await loanToken.mint(user1.address, ethers.parseEther("1000000"));
    await loanToken.mint(user2.address, ethers.parseEther("1000000"));

    // Deploy LendingPool
    const LendingPool = await ethers.getContractFactory("LendingPool");
    lendingPool = await LendingPool.deploy(await loanToken.getAddress());
    await lendingPool.waitForDeployment();

    // Approve LendingPool to spend loan tokens
    await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);
    await loanToken.connect(user2).approve(await lendingPool.getAddress(), ethers.MaxUint256);
  });

  describe("Collateral Deposit", function () {
    it("should allow depositing ETH as collateral", async function () {
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

  describe("Borrowing", function () {
    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
    });

    it("should allow borrowing up to collateral factor", async function () {
      const borrowAmount = (1000n * 150n) / 100n; // 150% of collateral value
      await expect(lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE))
        .to.emit(lendingPool, "Borrowed")
        .withArgs(user1.address, borrowAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount);
      expect(await loanToken.balanceOf(user1.address)).to.equal(ethers.parseEther("1000000") + borrowAmount);
    });

    it("should revert when borrowing more than collateral allows", async function () {
      const borrowAmount = (1000n * 150n) / 100n + 1n; // 1 wei over limit
      await expect(lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE))
        .to.be.revertedWith("Undercollateralized");
    });

    it("should revert when borrowing zero", async function () {
      await expect(lendingPool.connect(user1).borrow(0, ETH_PRICE))
        .to.be.revertedWith("Undercollateralized");
    });
  });

  describe("Repayment", function () {
    const borrowAmount = 1000n;

    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
      await lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE);
    });

    it("should allow partial repayment", async function () {
      const repayAmount = 500n;
      await expect(lendingPool.connect(user1).repay(repayAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, repayAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount - repayAmount);
      expect(await loanToken.balanceOf(await lendingPool.getAddress())).to.equal(repayAmount);
    });

    it("should allow full repayment", async function () {
      await expect(lendingPool.connect(user1).repay(borrowAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, borrowAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(0);
      expect(await loanToken.balanceOf(await lendingPool.getAddress())).to.equal(borrowAmount);
    });

    it("should revert when repaying more than debt", async function () {
      await expect(lendingPool.connect(user1).repay(borrowAmount + 1n))
        .to.be.revertedWith("Excess repay");
    });

    it("should revert when repaying zero", async function () {
      await expect(lendingPool.connect(user1).repay(0))
        .to.be.revertedWith("Excess repay");
    });
  });

  describe("Liquidation", function () {
    const borrowAmount = (1000n * 150n) / 100n; // 150% of collateral value

    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
      await lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE);
    });

    it("should allow liquidation when position is undercollateralized", async function () {
      // Reduce ETH price to make position undercollateralized
      const newEthPrice = 900n; // 1 ETH = 900 tokens
      const collateralAmount = await lendingPool.collateral(user1.address);

      await expect(lendingPool.connect(liquidator).liquidate(user1.address, newEthPrice))
        .to.emit(lendingPool, "Liquidated")
        .withArgs(user1.address, liquidator.address);

      expect(await lendingPool.collateral(user1.address)).to.equal(0);
      expect(await lendingPool.debt(user1.address)).to.equal(0);
      expect(await ethers.provider.getBalance(liquidator.address)).to.be.gt(collateralAmount);
    });

    it("should revert when liquidating a healthy position", async function () {
      await expect(lendingPool.connect(liquidator).liquidate(user1.address, ETH_PRICE))
        .to.be.revertedWith("Position healthy");
    });

    it("should revert when liquidating with zero collateral", async function () {
      // First liquidate the position
      await lendingPool.connect(liquidator).liquidate(user1.address, 900n);

      // Then try to liquidate again
      await expect(lendingPool.connect(liquidator).liquidate(user1.address, 900n))
        .to.be.revertedWith("Position healthy");
    });
  });

  describe("State Variables", function () {
    it("should have correct constants", async function () {
      expect(await lendingPool.COLLATERAL_FACTOR()).to.equal(150);
      expect(await lendingPool.LIQUIDATION_BONUS()).to.equal(10);
    });

    it("should correctly track collateral", async function () {
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
      expect(await lendingPool.collateral(user1.address)).to.equal(depositAmount);
    });

    it("should correctly track debt", async function () {
      const depositAmount = ethers.parseEther("1");
      const borrowAmount = 1000n;
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
      await lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE);
      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount);
    });
  });
});