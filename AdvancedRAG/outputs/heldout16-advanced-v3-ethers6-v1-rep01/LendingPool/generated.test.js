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
      await lendingPool.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
    });

    it("Should allow borrowing up to collateralization limit", async function () {
      const maxBorrow = (ethers.parseEther("1") * ETH_PRICE * 100n) / 150n; // 150% collateralization
      await expect(lendingPool.connect(user1).borrow(maxBorrow, ETH_PRICE))
        .to.emit(lendingPool, "Borrowed")
        .withArgs(user1.address, maxBorrow);

      expect(await lendingPool.debt(user1.address)).to.equal(maxBorrow);
      expect(await loanToken.balanceOf(user1.address)).to.equal(maxBorrow);
    });

    it("Should revert when borrowing more than collateralization limit", async function () {
      const maxBorrow = (ethers.parseEther("1") * ETH_PRICE * 100n) / 150n;
      await expect(lendingPool.connect(user1).borrow(maxBorrow + 1n, ETH_PRICE))
        .to.be.revertedWith("Undercollateralized");
    });

    it("Should allow multiple borrows up to limit", async function () {
      const firstBorrow = (ethers.parseEther("1") * ETH_PRICE * 100n) / 300n; // 1/3 of limit
      const secondBorrow = (ethers.parseEther("1") * ETH_PRICE * 100n) / 300n;

      await lendingPool.connect(user1).borrow(firstBorrow, ETH_PRICE);
      await lendingPool.connect(user1).borrow(secondBorrow, ETH_PRICE);

      expect(await lendingPool.debt(user1.address)).to.equal(firstBorrow + secondBorrow);
    });
  });

  describe("Repay Debt", function () {
    const borrowAmount = ethers.parseEther("500");

    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
      await lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE);
      await loanToken.connect(user1).approve(await lendingPool.getAddress(), ethers.MaxUint256);
    });

    it("Should allow partial repayment", async function () {
      const repayAmount = ethers.parseEther("200");
      await expect(lendingPool.connect(user1).repay(repayAmount))
        .to.emit(lendingPool, "Repaid")
        .withArgs(user1.address, repayAmount);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount - repayAmount);
    });

    it("Should allow full repayment", async function () {
      await lendingPool.connect(user1).repay(borrowAmount);
      expect(await lendingPool.debt(user1.address)).to.equal(0);
    });

    it("Should revert when repaying more than debt", async function () {
      await expect(lendingPool.connect(user1).repay(borrowAmount + 1n))
        .to.be.revertedWith("Excess repay");
    });
  });

  describe("Liquidation", function () {
    const collateralAmount = ethers.parseEther("1");
    const borrowAmount = (collateralAmount * ETH_PRICE * 100n) / 150n; // Max borrow

    beforeEach(async function () {
      await lendingPool.connect(user1).depositCollateral({ value: collateralAmount });
      await lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE);
    });

    it("Should liquidate undercollateralized position", async function () {
      // Reduce ETH price to make position undercollateralized
      const newEthPrice = (ETH_PRICE * 90n) / 100n; // 10% price drop

      const initialLiquidatorBalance = await ethers.provider.getBalance(liquidator.address);
      const initialUserCollateral = await lendingPool.collateral(user1.address);

      await expect(lendingPool.connect(liquidator).liquidate(user1.address, newEthPrice))
        .to.emit(lendingPool, "Liquidated")
        .withArgs(user1.address, liquidator.address);

      // Check liquidator received collateral
      const finalLiquidatorBalance = await ethers.provider.getBalance(liquidator.address);
      expect(finalLiquidatorBalance).to.be.gt(initialLiquidatorBalance);

      // Check user's collateral and debt were reset
      expect(await lendingPool.collateral(user1.address)).to.equal(0);
      expect(await lendingPool.debt(user1.address)).to.equal(0);
    });

    it("Should revert liquidation of healthy position", async function () {
      await expect(lendingPool.connect(liquidator).liquidate(user1.address, ETH_PRICE))
        .to.be.revertedWith("Position healthy");
    });
  });

  describe("State Variables", function () {
    it("Should have correct constants", async function () {
      expect(await lendingPool.COLLATERAL_FACTOR()).to.equal(150n);
      expect(await lendingPool.LIQUIDATION_BONUS()).to.equal(10n);
    });

    it("Should track collateral correctly", async function () {
      const depositAmount = ethers.parseEther("1");
      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
      expect(await lendingPool.collateral(user1.address)).to.equal(depositAmount);
    });

    it("Should track debt correctly", async function () {
      const depositAmount = ethers.parseEther("1");
      const borrowAmount = (depositAmount * ETH_PRICE * 100n) / 150n;

      await lendingPool.connect(user1).depositCollateral({ value: depositAmount });
      await lendingPool.connect(user1).borrow(borrowAmount, ETH_PRICE);

      expect(await lendingPool.debt(user1.address)).to.equal(borrowAmount);
    });
  });
});