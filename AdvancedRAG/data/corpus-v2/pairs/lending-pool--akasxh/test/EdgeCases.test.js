const { expect } = require("chai");
const hre = require("hardhat");

describe("PolkaLend — Edge Cases", function () {
  let owner, alice, bob;
  let tokenA, tokenB, tokenC, oracle, irm, pool;

  const SCALE = 10n ** 18n;

  beforeEach(async function () {
    [owner, alice, bob] = await hre.ethers.getSigners();

    const Token = await hre.ethers.getContractFactory("PolkaToken");
    tokenA = await Token.deploy();
    await tokenA.waitForDeployment();
    tokenB = await Token.deploy();
    await tokenB.waitForDeployment();
    tokenC = await Token.deploy();
    await tokenC.waitForDeployment();

    await tokenA.transfer(alice.address, hre.ethers.parseEther("100000"));
    await tokenB.transfer(bob.address, hre.ethers.parseEther("100000"));
    await tokenB.transfer(alice.address, hre.ethers.parseEther("10000"));
    await tokenC.transfer(alice.address, hre.ethers.parseEther("100000"));

    const Oracle = await hre.ethers.getContractFactory("PriceOracle");
    oracle = await Oracle.deploy();
    await oracle.waitForDeployment();

    await oracle.setPrice(await tokenA.getAddress(), SCALE);
    await oracle.setPrice(await tokenB.getAddress(), SCALE);
    await oracle.setPrice(await tokenC.getAddress(), SCALE);

    const IRM = await hre.ethers.getContractFactory("InterestRateModel");
    irm = await IRM.deploy(
      634195839n,
      3170979198n,
      31709791983n,
      hre.ethers.parseEther("0.8")
    );
    await irm.waitForDeployment();

    const Pool = await hre.ethers.getContractFactory("LendingPool");
    pool = await Pool.deploy(await irm.getAddress(), await oracle.getAddress());
    await pool.waitForDeployment();

    await pool.addMarket(
      await tokenA.getAddress(),
      hre.ethers.parseEther("0.75"),
      hre.ethers.parseEther("0.1")
    );
    await pool.addMarket(
      await tokenB.getAddress(),
      hre.ethers.parseEther("0.75"),
      hre.ethers.parseEther("0.1")
    );
    await pool.addMarket(
      await tokenC.getAddress(),
      hre.ethers.parseEther("0.75"),
      hre.ethers.parseEther("0.1")
    );
  });

  // --- Test 13: PriceOracle batch pricing ---
  it("13. should batch-set prices via setPrices()", async function () {
    const addrA = await tokenA.getAddress();
    const addrB = await tokenB.getAddress();
    const addrC = await tokenC.getAddress();

    const priceA = hre.ethers.parseEther("2.5");
    const priceB = hre.ethers.parseEther("0.01");
    const priceC = hre.ethers.parseEther("1500");

    await oracle.setPrices(
      [addrA, addrB, addrC],
      [priceA, priceB, priceC]
    );

    expect(await oracle.getPrice(addrA)).to.equal(priceA);
    expect(await oracle.getPrice(addrB)).to.equal(priceB);
    expect(await oracle.getPrice(addrC)).to.equal(priceC);
  });

  // --- Test 14: PolkaToken supply cap ---
  it("14. should revert minting beyond MAX_SUPPLY", async function () {
    // tokenA is a PolkaToken with 10M initial supply, MAX_SUPPLY = 100M
    // Try to mint 91M more (would exceed 100M cap)
    const excess = hre.ethers.parseEther("91000000");
    await expect(
      tokenA.mint(owner.address, excess)
    ).to.be.revertedWith("PolkaToken: cap exceeded");
  });

  // --- Test 15: PolkaToken unauthorized mint ---
  it("15. should revert non-owner mint on PolkaToken", async function () {
    await expect(
      tokenA.connect(alice).mint(alice.address, hre.ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(tokenA, "OwnableUnauthorizedAccount");
  });

  // --- Test 16: Zero deposit rejection ---
  it("16. should reject deposit of zero amount", async function () {
    await expect(
      pool.connect(alice).deposit(await tokenA.getAddress(), 0)
    ).to.be.revertedWith("Pool: zero amount");
  });

  // --- Test 17: Zero borrow rejection ---
  it("17. should reject borrow of zero amount", async function () {
    await expect(
      pool.connect(alice).borrow(await tokenB.getAddress(), 0)
    ).to.be.revertedWith("Pool: zero amount");
  });

  // --- Test 18: Flash loan insufficient liquidity ---
  it("18. should revert flash loan exceeding pool balance", async function () {
    // Deposit 1000 tokenA into pool
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    const MockReceiver = await hre.ethers.getContractFactory("MockFlashLoanReceiver");
    const receiver = await MockReceiver.deploy(await pool.getAddress());
    await receiver.waitForDeployment();

    // Try to flash loan 5000 (more than pool has)
    await expect(
      pool.flashLoan(
        await receiver.getAddress(),
        await tokenA.getAddress(),
        hre.ethers.parseEther("5000"),
        "0x"
      )
    ).to.be.revertedWith("FlashLoan: insufficient liquidity");
  });

  // --- Test 19: Flash loan callback failure ---
  it("19. should revert flash loan when callback returns false", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    const FailReceiver = await hre.ethers.getContractFactory("FailingFlashLoanReceiver");
    const failReceiver = await FailReceiver.deploy();
    await failReceiver.waitForDeployment();

    await expect(
      pool.flashLoan(
        await failReceiver.getAddress(),
        await tokenA.getAddress(),
        hre.ethers.parseEther("100"),
        "0x"
      )
    ).to.be.revertedWith("FlashLoan: callback failed");
  });

  // --- Test 20: Liquidation of healthy position ---
  it("20. should revert liquidation of a healthy borrower", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    // Alice borrows 500 against 1000 collateral (healthy)
    await pool.connect(alice).borrow(await tokenB.getAddress(), hre.ethers.parseEther("500"));
    expect(await pool.isHealthy(alice.address)).to.be.true;

    const repayAmt = hre.ethers.parseEther("100");
    await tokenB.connect(bob).approve(await pool.getAddress(), repayAmt);
    await expect(
      pool.connect(bob).liquidate(
        alice.address,
        await tokenB.getAddress(),
        await tokenA.getAddress(),
        repayAmt
      )
    ).to.be.revertedWith("Pool: borrower is healthy");
  });

  // --- Test 21: Liquidation exceeding 50% of debt ---
  it("21. should revert liquidation repaying more than 50% of debt", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    await pool.connect(alice).borrow(await tokenB.getAddress(), hre.ethers.parseEther("700"));

    // Make alice undercollateralized
    await oracle.setPrice(await tokenA.getAddress(), hre.ethers.parseEther("0.5"));
    expect(await pool.isHealthy(alice.address)).to.be.false;

    // Try to repay 400 (> 50% of 700 = 350)
    const repayAmt = hre.ethers.parseEther("400");
    await tokenB.connect(bob).approve(await pool.getAddress(), repayAmt);
    await expect(
      pool.connect(bob).liquidate(
        alice.address,
        await tokenB.getAddress(),
        await tokenA.getAddress(),
        repayAmt
      )
    ).to.be.revertedWith("Pool: repay > 50%");
  });

  // --- Test 22: Supply rate calculation ---
  it("22. should calculate supply rate correctly", async function () {
    const totalDeposits = hre.ethers.parseEther("1000");
    const totalBorrows = hre.ethers.parseEther("500");
    const reserveFactor = hre.ethers.parseEther("0.1");

    const supplyRate = await irm.getSupplyRate(totalDeposits, totalBorrows, reserveFactor);
    const borrowRate = await irm.getBorrowRate(totalDeposits, totalBorrows);

    // supplyRate = borrowRate * (1 - reserveFactor) * utilization / SCALE
    // utilization = 500/1000 = 0.5
    const utilization = (totalBorrows * SCALE) / totalDeposits;
    const expectedSupply = (borrowRate * (SCALE - reserveFactor) / SCALE) * utilization / SCALE;

    expect(supplyRate).to.equal(expectedSupply);
    expect(supplyRate).to.be.gt(0n);
  });

  // --- Test 23: Multiple market deposits ---
  it("23. should track deposits across multiple markets", async function () {
    const amountA = hre.ethers.parseEther("500");
    const amountC = hre.ethers.parseEther("300");

    await tokenA.connect(alice).approve(await pool.getAddress(), amountA);
    await pool.connect(alice).deposit(await tokenA.getAddress(), amountA);

    await tokenC.connect(alice).approve(await pool.getAddress(), amountC);
    await pool.connect(alice).deposit(await tokenC.getAddress(), amountC);

    expect(await pool.userDeposits(alice.address, await tokenA.getAddress())).to.equal(amountA);
    expect(await pool.userDeposits(alice.address, await tokenC.getAddress())).to.equal(amountC);

    // Collateral value = (500 * 1 * 0.75) + (300 * 1 * 0.75) = 375 + 225 = 600
    const expectedCollateral = hre.ethers.parseEther("600");
    expect(await pool.getCollateralValue(alice.address)).to.equal(expectedCollateral);
  });

  // --- Test 24: Market re-listing rejection ---
  it("24. should reject adding an already listed market", async function () {
    await expect(
      pool.addMarket(
        await tokenA.getAddress(),
        hre.ethers.parseEther("0.75"),
        hre.ethers.parseEther("0.1")
      )
    ).to.be.revertedWith("Pool: already listed");
  });
});
