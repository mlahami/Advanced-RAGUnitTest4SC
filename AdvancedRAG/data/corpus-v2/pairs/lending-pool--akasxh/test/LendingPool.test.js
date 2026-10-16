const { expect } = require("chai");
const hre = require("hardhat");

describe("PolkaLend", function () {
  let owner, alice, bob;
  let tokenA, tokenB, oracle, irm, pool;

  const SCALE = 10n ** 18n;

  beforeEach(async function () {
    [owner, alice, bob] = await hre.ethers.getSigners();

    // Deploy two PolkaToken instances as test tokens
    const Token = await hre.ethers.getContractFactory("PolkaToken");
    tokenA = await Token.deploy();
    await tokenA.waitForDeployment();
    tokenB = await Token.deploy();
    await tokenB.waitForDeployment();

    // Transfer tokens to alice & bob
    await tokenA.transfer(alice.address, hre.ethers.parseEther("100000"));
    await tokenB.transfer(bob.address, hre.ethers.parseEther("100000"));

    // Deploy oracle
    const Oracle = await hre.ethers.getContractFactory("PriceOracle");
    oracle = await Oracle.deploy();
    await oracle.waitForDeployment();

    // Both tokens = $1
    await oracle.setPrice(await tokenA.getAddress(), SCALE);
    await oracle.setPrice(await tokenB.getAddress(), SCALE);

    // Deploy interest rate model
    const IRM = await hre.ethers.getContractFactory("InterestRateModel");
    irm = await IRM.deploy(
      634195839n,      // ~2 % APR base (per sec)
      3170979198n,     // ~10 % APR slope1
      31709791983n,    // ~100 % APR slope2
      hre.ethers.parseEther("0.8")
    );
    await irm.waitForDeployment();

    // Deploy pool
    const Pool = await hre.ethers.getContractFactory("LendingPool");
    pool = await Pool.deploy(await irm.getAddress(), await oracle.getAddress());
    await pool.waitForDeployment();

    // List both markets (75 % CF, 10 % reserve)
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
  });

  it("1. should allow deposits", async function () {
    const amount = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), amount);
    await pool.connect(alice).deposit(await tokenA.getAddress(), amount);

    expect(await pool.userDeposits(alice.address, await tokenA.getAddress())).to.equal(amount);
    const market = await pool.markets(await tokenA.getAddress());
    expect(market.totalDeposits).to.equal(amount);
  });

  it("2. should allow withdrawals", async function () {
    const amount = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), amount);
    await pool.connect(alice).deposit(await tokenA.getAddress(), amount);

    await pool.connect(alice).withdraw(await tokenA.getAddress(), hre.ethers.parseEther("500"));
    expect(await pool.userDeposits(alice.address, await tokenA.getAddress())).to.equal(
      hre.ethers.parseEther("500")
    );
  });

  it("3. should allow borrowing against collateral", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    const borrowAmt = hre.ethers.parseEther("500");
    await pool.connect(alice).borrow(await tokenB.getAddress(), borrowAmt);

    expect(await pool.userBorrows(alice.address, await tokenB.getAddress())).to.equal(borrowAmt);
  });

  it("4. should reject borrow exceeding collateral factor", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    await expect(
      pool.connect(alice).borrow(await tokenB.getAddress(), hre.ethers.parseEther("800"))
    ).to.be.revertedWith("Pool: undercollateralized");
  });

  it("5. should allow repayment", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    const borrowAmt = hre.ethers.parseEther("500");
    await pool.connect(alice).borrow(await tokenB.getAddress(), borrowAmt);

    await tokenB.connect(alice).approve(await pool.getAddress(), hre.ethers.parseEther("200"));
    await pool.connect(alice).repay(await tokenB.getAddress(), hre.ethers.parseEther("200"));

    expect(await pool.userBorrows(alice.address, await tokenB.getAddress())).to.equal(
      hre.ethers.parseEther("300")
    );
  });

  it("6. should report correct collateral and borrow values", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    expect(await pool.getCollateralValue(alice.address)).to.equal(
      hre.ethers.parseEther("750")
    );
    expect(await pool.getBorrowValue(alice.address)).to.equal(0);
  });

  it("7. should prevent withdrawal that would undercollateralize", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    await pool.connect(alice).borrow(await tokenB.getAddress(), hre.ethers.parseEther("700"));

    await expect(
      pool.connect(alice).withdraw(await tokenA.getAddress(), hre.ethers.parseEther("100"))
    ).to.be.revertedWith("Pool: undercollateralized");
  });

  it("8. should execute flash loans", async function () {
    const MockReceiver = await hre.ethers.getContractFactory("MockFlashLoanReceiver");
    const receiver = await MockReceiver.deploy(await pool.getAddress());
    await receiver.waitForDeployment();

    const depositAmt = hre.ethers.parseEther("10000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    // Give receiver tokens to pay fee
    await tokenA.transfer(await receiver.getAddress(), hre.ethers.parseEther("100"));

    const flashAmt = hre.ethers.parseEther("5000");
    await pool.flashLoan(
      await receiver.getAddress(),
      await tokenA.getAddress(),
      flashAmt,
      "0x"
    );

    const poolBal = await tokenA.balanceOf(await pool.getAddress());
    expect(poolBal).to.be.gt(depositAmt);
  });

  it("9. should calculate interest rates correctly", async function () {
    const baseRate = await irm.getBorrowRate(hre.ethers.parseEther("1000"), 0);
    expect(baseRate).to.equal(634195839n);

    const midRate = await irm.getBorrowRate(
      hre.ethers.parseEther("1000"),
      hre.ethers.parseEther("500")
    );
    expect(midRate).to.be.gt(baseRate);

    const highRate = await irm.getBorrowRate(
      hre.ethers.parseEther("1000"),
      hre.ethers.parseEther("900")
    );
    expect(highRate).to.be.gt(midRate);
  });

  it("10. should allow liquidation of undercollateralized positions", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    await pool.connect(alice).borrow(await tokenB.getAddress(), hre.ethers.parseEther("700"));

    // Price of tokenA drops -> alice becomes undercollateralized
    await oracle.setPrice(await tokenA.getAddress(), hre.ethers.parseEther("0.5"));

    expect(await pool.isHealthy(alice.address)).to.be.false;

    const repayAmt = hre.ethers.parseEther("200");
    await tokenB.connect(bob).approve(await pool.getAddress(), repayAmt);
    await pool.connect(bob).liquidate(
      alice.address,
      await tokenB.getAddress(),
      await tokenA.getAddress(),
      repayAmt
    );

    expect(await pool.userBorrows(alice.address, await tokenB.getAddress())).to.equal(
      hre.ethers.parseEther("500")
    );
  });

  it("11. should reject deposit of unlisted token", async function () {
    const fakeAddr = "0x0000000000000000000000000000000000000001";
    await expect(
      pool.deposit(fakeAddr, hre.ethers.parseEther("100"))
    ).to.be.revertedWith("Pool: not listed");
  });

  it("12. should emit correct events on deposit", async function () {
    const amount = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), amount);

    await expect(pool.connect(alice).deposit(await tokenA.getAddress(), amount))
      .to.emit(pool, "Deposit")
      .withArgs(alice.address, await tokenA.getAddress(), amount);
  });
});
