// test/DOCVesting.test.js
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DOCVesting", function () {

  // ─── Shared variables ───────────────────────────────────────────────────────
  let vesting, doc;
  let admin, beneficiary, stranger;

  // Common time values (in seconds)
  const ONE_DAY    = 86400;
  const CLIFF      = ONE_DAY * 30;   // 30 days
  const VESTING    = ONE_DAY * 180;  // 180 days
  const ALLOCATION = ethers.parseEther("1000"); // 1000 DOC

  // ─── beforeEach — fresh contracts before every test ─────────────────────────
  // This means every test starts from a clean slate.
  // No test can accidentally affect another.
  beforeEach(async function () {
    [admin, beneficiary, stranger] = await ethers.getSigners();

    // Deploy mock DOC token
    const MockDOC = await ethers.getContractFactory("MockDOC");
    doc = await MockDOC.deploy();

    // Deploy the vesting contract
    const DOCVesting = await ethers.getContractFactory("DOCVesting");
    vesting = await DOCVesting.deploy(await doc.getAddress());

    // Approve the vesting contract to pull DOC from admin's wallet
    await doc.approve(await vesting.getAddress(), ethers.parseEther("100000"));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 1 — Deploy & configure
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 1: Deployment", function () {

    it("sets admin to deployer", async function () {
      expect(await vesting.admin()).to.equal(admin.address);
    });

    it("sets the DOC token address correctly", async function () {
      expect(await vesting.docToken()).to.equal(await doc.getAddress());
    });

    it("starts in NOT_CONFIGURED state", async function () {
      expect(await vesting.vaultState()).to.equal("NOT_CONFIGURED");
    });

    it("isConfigured is false before setup", async function () {
      expect(await vesting.isConfigured()).to.equal(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 2 — Fund the contract
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 2: Funding the contract", function () {

    it("allows admin to fund the contract", async function () {
      await vesting.fundContract(ALLOCATION);
      const balance = await doc.balanceOf(await vesting.getAddress());
      expect(balance).to.equal(ALLOCATION);
    });

    it("emits ContractFunded event", async function () {
      await expect(vesting.fundContract(ALLOCATION))
        .to.emit(vesting, "ContractFunded")
        .withArgs(admin.address, ALLOCATION);
    });

    it("reverts if amount is zero", async function () {
      await expect(vesting.fundContract(0))
        .to.be.revertedWith("Amount must be greater than zero");
    });

    it("reverts if a non-admin tries to fund", async function () {
      await expect(vesting.connect(stranger).fundContract(ALLOCATION))
        .to.be.revertedWith("Caller is not admin");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 3 — Set up beneficiary
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 3: Setting up beneficiary", function () {

    beforeEach(async function () {
      // Fund first, then setup — correct order
      await vesting.fundContract(ALLOCATION);
    });

    it("allows admin to set up a beneficiary", async function () {
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      expect(await vesting.beneficiary()).to.equal(beneficiary.address);
      expect(await vesting.totalAllocation()).to.equal(ALLOCATION);
      expect(await vesting.isConfigured()).to.equal(true);
    });

    it("emits BeneficiarySet event", async function () {
      await expect(vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF))
        .to.emit(vesting, "BeneficiarySet");
    });

    it("vault moves to LOCKED state after setup", async function () {
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      expect(await vesting.vaultState()).to.equal("LOCKED");
    });

    it("reverts if setup called twice", async function () {
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await expect(vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF))
        .to.be.revertedWith("Beneficiary already configured");
    });

    it("reverts if contract is not funded first", async function () {
      // Deploy a fresh unfunded vesting contract
      const DOCVesting = await ethers.getContractFactory("DOCVesting");
      const freshVesting = await DOCVesting.deploy(await doc.getAddress());
      await expect(
        freshVesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Fund the contract before setup");
    });

    it("reverts if admin tries to set themselves as beneficiary", async function () {
      await expect(
        vesting.setup(admin.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Admin cannot be beneficiary");
    });

    it("reverts if zero address is used", async function () {
      await expect(
        vesting.setup(ethers.ZeroAddress, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Zero address not allowed");
    });

    it("reverts if cliff is longer than vesting period", async function () {
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, CLIFF, VESTING)
        //                                              ^ swapped deliberately
      ).to.be.revertedWith("Cliff must be shorter than vesting period");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 4 — Locked withdrawal attempt
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 4: Withdrawal blocked during cliff (LOCKED state)", function () {

    beforeEach(async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
    });

    it("reverts when beneficiary tries to withdraw during cliff", async function () {
      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("100"))
      ).to.be.revertedWith("Cliff period has not passed yet");
    });

    it("vault state is LOCKED during cliff period", async function () {
      expect(await vesting.vaultState()).to.equal("LOCKED");
    });

    it("vestedAmount still calculates during cliff (clock runs from startTime)", async function () {
      // Advance time to halfway through cliff
      await time.increase(CLIFF / 2);
      const vested = await vesting.vestedAmount();
      // Vested should be > 0 even though withdrawal is blocked
      expect(vested).to.be.gt(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 5 — Normal withdrawal (within vested amount)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 5: Normal withdrawal after cliff (VESTING state)", function () {

    beforeEach(async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      // Jump past the cliff
      await time.increase(CLIFF + 1);
    });

    it("vault is in VESTING state after cliff", async function () {
      expect(await vesting.vaultState()).to.equal("VESTING");
    });

    it("allows withdrawal within vested amount with no penalty", async function () {
      // At cliff end (~30/180 days) roughly 16.6% is vested = ~166 DOC
      const withdrawAmount = ethers.parseEther("100"); // safely within vested

      const balanceBefore = await doc.balanceOf(beneficiary.address);
      await vesting.connect(beneficiary).withdraw(withdrawAmount);
      const balanceAfter = await doc.balanceOf(beneficiary.address);

      // Beneficiary received exact amount — no penalty deducted
      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
    });

    it("emits Withdrawal event with zero penalty and VESTING state", async function () {
      const withdrawAmount = ethers.parseEther("100");
      await expect(vesting.connect(beneficiary).withdraw(withdrawAmount))
        .to.emit(vesting, "Withdrawal")
        .withArgs(beneficiary.address, withdrawAmount, 0, "VESTING");
    });

    it("updates withdrawn correctly after normal withdrawal", async function () {
      const withdrawAmount = ethers.parseEther("100");
      await vesting.connect(beneficiary).withdraw(withdrawAmount);
      expect(await vesting.withdrawn()).to.equal(withdrawAmount);
    });

    it("reverts if a stranger tries to withdraw", async function () {
      await expect(
        vesting.connect(stranger).withdraw(ethers.parseEther("100"))
      ).to.be.revertedWith("Caller is not beneficiary");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 6 — Early exit (penalty applied)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 6: Early withdrawal with penalty (EARLY_EXIT)", function () {

    beforeEach(async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      // Jump to exactly 50% through vesting (90 days)
      await time.increase(VESTING / 2);
    });

    it("applies 20% penalty on unvested excess", async function () {
      // At 50% vesting: 500 DOC vested
      // Requesting 600 DOC → 100 DOC is unvested excess
      // Penalty = 20% of 100 = 20 DOC
      // Actual received = 580 DOC
      const withdrawAmount = ethers.parseEther("600");

      const balanceBefore = await doc.balanceOf(beneficiary.address);
      await vesting.connect(beneficiary).withdraw(withdrawAmount);
      const balanceAfter = await doc.balanceOf(beneficiary.address);

      // closeTo allows 1 DOC tolerance for block timing variance
      expect(balanceAfter - balanceBefore).to.be.closeTo(
        ethers.parseEther("580"),
        ethers.parseEther("1")
      );
      expect(await vesting.penaltyPool()).to.be.closeTo(
        ethers.parseEther("20"),
        ethers.parseEther("1")
      );
    });

    it("emits Withdrawal event with correct penalty and EARLY_EXIT state", async function () {
      const withdrawAmount = ethers.parseEther("600");

      // Execute withdrawal and check event state label
      // Exact amounts checked in the test above — event check focuses on state
      const tx = await vesting.connect(beneficiary).withdraw(withdrawAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try { return vesting.interface.parseLog(log).name === "Withdrawal"; }
        catch { return false; }
      });
      const parsed = vesting.interface.parseLog(event);

      expect(parsed.args[0]).to.equal(beneficiary.address);
      expect(parsed.args[3]).to.equal("EARLY_EXIT");
      expect(parsed.args[1]).to.be.closeTo(
        ethers.parseEther("580"),
        ethers.parseEther("1")
      );
    });

    it("previewWithdrawal returns correct penalty before transaction", async function () {
      const withdrawAmount = ethers.parseEther("600");
      const [penalty, actualReceived] = await vesting.previewWithdrawal(withdrawAmount);

      expect(penalty).to.be.closeTo(
        ethers.parseEther("20"),
        ethers.parseEther("1")
      );
      expect(actualReceived).to.be.closeTo(
        ethers.parseEther("580"),
        ethers.parseEther("1")
      );
    });

    it("penaltyPool increases after early exit", async function () {
      await vesting.connect(beneficiary).withdraw(ethers.parseEther("600"));
      expect(await vesting.penaltyPool()).to.be.gt(0);
    });

    it("reverts if withdrawal exceeds total remaining allocation", async function () {
      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("9999"))
      ).to.be.revertedWith("Exceeds remaining allocation");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 7 — Complete withdrawal (fully vested, no penalty)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Scenario 7: Full withdrawal after vesting complete (COMPLETE state)", function () {

    beforeEach(async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      // Jump past the entire vesting period
      await time.increase(VESTING + 1);
    });

    it("vault is in COMPLETE state", async function () {
      expect(await vesting.vaultState()).to.equal("COMPLETE");
    });

    it("allows full withdrawal with zero penalty", async function () {
      const balanceBefore = await doc.balanceOf(beneficiary.address);
      await vesting.connect(beneficiary).withdraw(ALLOCATION);
      const balanceAfter = await doc.balanceOf(beneficiary.address);

      expect(balanceAfter - balanceBefore).to.equal(ALLOCATION);
      expect(await vesting.penaltyPool()).to.equal(0);
    });

    it("emits Withdrawal with zero penalty and COMPLETE state", async function () {
      await expect(vesting.connect(beneficiary).withdraw(ALLOCATION))
        .to.emit(vesting, "Withdrawal")
        .withArgs(beneficiary.address, ALLOCATION, 0, "COMPLETE");
    });

    it("vestedAmount equals totalAllocation after vesting ends", async function () {
      expect(await vesting.vestedAmount()).to.equal(ALLOCATION);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BONUS — getVaultStatus returns correct snapshot
  // ═══════════════════════════════════════════════════════════════════════════
  describe("getVaultStatus snapshot", function () {

    it("returns correct data at 50% vesting", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 2);

      const status = await vesting.getVaultStatus();

      expect(status.state).to.equal("VESTING");
      expect(status._totalAllocation).to.equal(ALLOCATION);
      expect(status._withdrawn).to.equal(0);
      expect(status.vested).to.be.closeTo(
        ethers.parseEther("500"),
        ethers.parseEther("1") // allow 1 DOC tolerance for block timing
      );
    });
  });
});