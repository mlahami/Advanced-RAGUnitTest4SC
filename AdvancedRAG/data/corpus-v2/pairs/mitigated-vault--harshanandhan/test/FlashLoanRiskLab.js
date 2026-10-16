const { expect } = require("chai");
const { ethers } = require("hardhat");

const ONE = ethers.parseEther("1");
const HUNDRED = ethers.parseEther("100");
const THOUSAND = ethers.parseEther("1000");
const TEN_THOUSAND = ethers.parseEther("10000");

describe("Flash Loan Risk Lab (educational)", function () {
  let coll, debt, oracle, pool, vuln, mit, attacker, deployer, user;

  beforeEach(async function () {
    [deployer, user] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("MockERC20");
    coll = await ERC20.deploy("Lab Collateral", "LAB-COLL", TEN_THOUSAND);
    debt = await ERC20.deploy("Lab USD", "LAB-USD", TEN_THOUSAND);

    const Oracle = await ethers.getContractFactory("LabOracle");
    oracle = await Oracle.deploy(ONE);

    const Pool = await ethers.getContractFactory("FlashLoanPool");
    pool = await Pool.deploy(coll);
    await coll.transfer(await pool.getAddress(), THOUSAND);

    const Vuln = await ethers.getContractFactory("VulnerableVault");
    vuln = await Vuln.deploy(coll, debt, oracle);
    await debt.transfer(await vuln.getAddress(), THOUSAND);

    const Mit = await ethers.getContractFactory("MitigatedVault");
    mit = await Mit.deploy(coll, debt, oracle, ONE);
    await debt.transfer(await mit.getAddress(), THOUSAND);

    const Att = await ethers.getContractFactory("LabAttacker");
    attacker = await Att.deploy(pool, oracle, coll, debt, vuln, mit);
  });

  it("VulnerableVault: spot spike enables oversized borrow (lab drain)", async function () {
    await coll.transfer(user.address, HUNDRED);
    await coll.connect(user).approve(await vuln.getAddress(), HUNDRED);
    await vuln.connect(user).depositCollateral(HUNDRED);

    expect(await vuln.maxBorrow(user.address)).to.equal(ethers.parseEther("90"));

    await oracle.setSpotPrice(ethers.parseEther("10"));
    expect(await vuln.maxBorrow(user.address)).to.equal(ethers.parseEther("900"));

    await vuln.connect(user).borrow(ethers.parseEther("900"));
    expect(await debt.balanceOf(user.address)).to.equal(ethers.parseEther("900"));
    expect(await debt.balanceOf(await vuln.getAddress())).to.equal(ethers.parseEther("100"));
  });

  it("MitigatedVault: TWAP + circuit breaker blocks spiked borrow", async function () {
    await coll.transfer(user.address, HUNDRED);
    await coll.connect(user).approve(await mit.getAddress(), HUNDRED);
    await mit.connect(user).depositCollateral(HUNDRED);

    expect(await mit.twap()).to.equal(ONE);
    expect(await mit.maxBorrow(user.address)).to.equal(ethers.parseEther("90"));

    await oracle.setSpotPrice(ethers.parseEther("10"));
    expect(await mit.spotDeviationBps()).to.be.gt(500);

    await expect(mit.connect(user).borrow(ethers.parseEther("50"))).to.be.revertedWith(
      "MitigatedVault: circuit breaker"
    );

    await mit.tripCircuitIfDeviated();
    expect(await mit.circuitOpen()).to.equal(true);
    expect(await debt.balanceOf(await mit.getAddress())).to.equal(THOUSAND);
  });

  it("MitigatedVault: honest borrow at TWAP still works", async function () {
    await coll.transfer(user.address, HUNDRED);
    await coll.connect(user).approve(await mit.getAddress(), HUNDRED);
    await mit.connect(user).depositCollateral(HUNDRED);

    await mit.connect(user).borrow(ethers.parseEther("50"));
    expect(await debt.balanceOf(user.address)).to.equal(ethers.parseEther("50"));
    expect(await mit.circuitOpen()).to.equal(false);
  });

  it("LabAttacker flash path: Vulnerable succeeds, Mitigated blocked", async function () {
    const flashAmount = ethers.parseEther("200");
    const depositAmount = ethers.parseEther("100");
    const spike = ethers.parseEther("10");

    await coll.transfer(await attacker.getAddress(), flashAmount + depositAmount + flashAmount + depositAmount);

    await attacker.attackVulnerable(flashAmount, depositAmount, spike);
    expect(await attacker.lastSuccess()).to.equal(true);
    expect(await attacker.lastBorrowed()).to.equal(ethers.parseEther("900"));
    expect(await debt.balanceOf(await attacker.getAddress())).to.equal(ethers.parseEther("900"));

    await attacker.attackMitigated(flashAmount, depositAmount, spike);
    expect(await attacker.lastSuccess()).to.equal(false);
    const reason = await attacker.lastReason();
    expect(reason).to.match(/circuit breaker|circuit open|blocked|MitigatedVault/i);
  });

  it("FlashLoanPool requires full repayment (insufficient seed reverts)", async function () {
    await expect(
      attacker.attackVulnerable(HUNDRED, ethers.parseEther("10"), ethers.parseEther("10"))
    ).to.be.revertedWith("LabAttacker: seed collateral");
  });

  it("LabOracle starts at $1 and is freely settable (lab model)", async function () {
    expect(await oracle.latestPrice()).to.equal(ONE);
    await oracle.connect(user).setSpotPrice(ethers.parseEther("2"));
    expect(await oracle.latestPrice()).to.equal(ethers.parseEther("2"));
  });
});
