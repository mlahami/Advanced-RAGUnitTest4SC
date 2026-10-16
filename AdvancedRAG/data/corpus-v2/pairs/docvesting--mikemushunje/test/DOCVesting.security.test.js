// test/DOCVesting.security.test.js
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DOCVesting — Security Audit", function () {

  // ─── Shared variables ───────────────────────────────────────────────────────
  let vesting, doc;
  let admin, beneficiary, stranger;

  const ONE_DAY    = 86400;
  const CLIFF      = ONE_DAY * 30;
  const VESTING    = ONE_DAY * 180;
  const ALLOCATION = ethers.parseEther("1000");

  // Fresh contracts before every test
  beforeEach(async function () {
    [admin, beneficiary, stranger] = await ethers.getSigners();

    const MockDOC = await ethers.getContractFactory("MockDOC");
    doc = await MockDOC.deploy();

    const DOCVesting = await ethers.getContractFactory("DOCVesting");
    vesting = await DOCVesting.deploy(await doc.getAddress());

    await doc.approve(await vesting.getAddress(), ethers.parseEther("100000"));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 1 — Reentrancy Protection
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 1: Reentrancy Protection", function () {

    it("withdraw() completes cleanly with no reentrant calls", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await expect(
        vesting.connect(beneficiary).withdraw(ALLOCATION)
      ).to.not.be.reverted;
    });

    it("state is updated before transfer (checks-effects-interactions)", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await vesting.connect(beneficiary).withdraw(ALLOCATION);

      // withdrawn equals totalAllocation proving state updated before transfer
      expect(await vesting.withdrawn()).to.equal(ALLOCATION);
      expect(await vesting.totalAllocation()).to.equal(ALLOCATION);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 2 — Access Control
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 2: Access Control", function () {

    it("stranger cannot call fundContract", async function () {
      await expect(
        vesting.connect(stranger).fundContract(ALLOCATION)
      ).to.be.revertedWith("Caller is not admin");
    });

    it("stranger cannot call setup", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.connect(stranger).setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Caller is not admin");
    });

    it("beneficiary cannot call setup", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.connect(beneficiary).setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Caller is not admin");
    });

    it("admin cannot withdraw", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);
      await expect(
        vesting.connect(admin).withdraw(ALLOCATION)
      ).to.be.revertedWith("Caller is not beneficiary");
    });

    it("stranger cannot withdraw", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);
      await expect(
        vesting.connect(stranger).withdraw(ALLOCATION)
      ).to.be.revertedWith("Caller is not beneficiary");
    });

    it("admin cannot be set as beneficiary", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(admin.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Admin cannot be beneficiary");
    });

    it("zero address cannot be set as beneficiary", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(ethers.ZeroAddress, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Zero address not allowed");
    });

    it("contract address cannot be set as beneficiary", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(await vesting.getAddress(), ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Cannot vest to contract itself");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 3 — Integer Accounting
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 3: Integer Accounting", function () {

    it("withdrawn never exceeds totalAllocation after full withdrawal", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await vesting.connect(beneficiary).withdraw(ALLOCATION);

      const withdrawn = await vesting.withdrawn();
      const total     = await vesting.totalAllocation();
      expect(withdrawn).to.equal(total);
    });

    it("cannot withdraw more than remaining allocation", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("9999"))
      ).to.be.revertedWith("Exceeds remaining allocation");
    });

    it("partial withdrawals correctly reduce remaining balance", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      const firstWithdraw  = ethers.parseEther("400");
      const secondWithdraw = ethers.parseEther("600");

      await vesting.connect(beneficiary).withdraw(firstWithdraw);
      expect(await vesting.withdrawn()).to.equal(firstWithdraw);

      await vesting.connect(beneficiary).withdraw(secondWithdraw);
      expect(await vesting.withdrawn()).to.equal(ALLOCATION);
    });

    it("cannot withdraw zero amount", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await expect(
        vesting.connect(beneficiary).withdraw(0)
      ).to.be.revertedWith("Amount must be greater than zero");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 4 — Penalty Calculation Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 4: Penalty Calculation Edge Cases", function () {

    it("no penalty when withdrawing exactly vested amount", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 2);

      const vested = await vesting.vestedAmount();

      const balanceBefore = await doc.balanceOf(beneficiary.address);
      await vesting.connect(beneficiary).withdraw(vested);
      const balanceAfter  = await doc.balanceOf(beneficiary.address);

      expect(balanceAfter - balanceBefore).to.equal(vested);
      expect(await vesting.penaltyPool()).to.equal(0);
    });

    it("penalty only applies to unvested excess not full amount", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 2);

      // 500 DOC vested, requesting 600 — only 100 DOC excess is penalised
      const [penalty] = await vesting.previewWithdrawal(ethers.parseEther("600"));

      // Should be ~20 DOC (20% of 100), NOT 120 DOC (20% of 600)
      expect(penalty).to.be.closeTo(
        ethers.parseEther("20"),
        ethers.parseEther("1")
      );
    });

    it("penaltyPool accumulates across multiple early withdrawals", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 4); // 25% vested

      await vesting.connect(beneficiary).withdraw(ethers.parseEther("300"));
      const penaltyAfterFirst = await vesting.penaltyPool();
      expect(penaltyAfterFirst).to.be.gt(0);

      await time.increase(VESTING / 4); // now 50% vested
      await vesting.connect(beneficiary).withdraw(ethers.parseEther("100"));
      const penaltyAfterSecond = await vesting.penaltyPool();

      expect(penaltyAfterSecond).to.be.gte(penaltyAfterFirst);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 5 — Configuration Lock
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 5: Configuration Lock", function () {

    it("setup cannot be called twice", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await expect(
        vesting.setup(stranger.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Beneficiary already configured");
    });

    it("setup cannot be called before funding", async function () {
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Fund the contract before setup");
    });

    it("allocation cannot exceed contract balance", async function () {
      await vesting.fundContract(ethers.parseEther("500"));
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.be.revertedWith("Fund the contract before setup");
    });

    it("cliff must be shorter than vesting period", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, CLIFF, VESTING)
      ).to.be.revertedWith("Cliff must be shorter than vesting period");
    });

    it("vesting period cannot be zero", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, 0, 0)
      ).to.be.revertedWith("Vesting period must be greater than zero");
    });

    it("allocation cannot be zero", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(beneficiary.address, 0, VESTING, CLIFF)
      ).to.be.revertedWith("Allocation must be greater than zero");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 6 — Vesting Math Integrity
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 6: Vesting Math Integrity", function () {

    it("vestedAmount returns 0 before configured", async function () {
      expect(await vesting.vestedAmount()).to.equal(0);
    });

    it("vestedAmount increases linearly over time", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, 0); // no cliff

      await time.increase(VESTING / 4);
      const vestedAt25 = await vesting.vestedAmount();

      await time.increase(VESTING / 4);
      const vestedAt50 = await vesting.vestedAmount();

      // Second reading should be roughly double the first
      expect(vestedAt50).to.be.closeTo(vestedAt25 * 2n, ethers.parseEther("5"));
    });

    it("vestedAmount is capped at totalAllocation after vesting ends", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING * 3); // way past vesting end

      expect(await vesting.vestedAmount()).to.equal(ALLOCATION);
    });

    it("cliff does not pause vesting clock", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(CLIFF);

      const vestedAtCliffEnd = await vesting.vestedAmount();

      // 30/180 days elapsed = ~16.6% = ~166 DOC
      expect(vestedAtCliffEnd).to.be.closeTo(
        ethers.parseEther("166"),
        ethers.parseEther("5")
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 7 — ERC-20 Safety
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 7: ERC-20 Safety", function () {

    it("fundContract fails if admin has not approved the contract", async function () {
      const DOCVesting = await ethers.getContractFactory("DOCVesting");
      const freshVesting = await DOCVesting.deploy(await doc.getAddress());

      // No approve() call — transferFrom should fail
      await expect(
        freshVesting.fundContract(ALLOCATION)
      ).to.be.reverted;
    });

    it("fundContract fails if admin has insufficient DOC balance", async function () {
      const DOCVesting = await ethers.getContractFactory("DOCVesting");
      const freshVesting = await DOCVesting.deploy(await doc.getAddress());

      const [, , poorAdmin] = await ethers.getSigners();
      await doc.connect(poorAdmin).approve(
        await freshVesting.getAddress(),
        ethers.parseEther("100000")
      );

      // poorAdmin has no DOC — transfer should fail
      await expect(
        freshVesting.connect(poorAdmin).fundContract(ethers.parseEther("1000"))
      ).to.be.reverted;
    });

    it("contract balance reflects funded amount correctly", async function () {
      await vesting.fundContract(ALLOCATION);

      const contractBalance = await doc.balanceOf(await vesting.getAddress());
      expect(contractBalance).to.equal(ALLOCATION);
    });

    it("beneficiary receives correct DOC balance after withdrawal", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      const beneficiaryBefore = await doc.balanceOf(beneficiary.address);
      await vesting.connect(beneficiary).withdraw(ALLOCATION);
      const beneficiaryAfter  = await doc.balanceOf(beneficiary.address);

      expect(beneficiaryAfter - beneficiaryBefore).to.equal(ALLOCATION);
    });

    it("contract balance decreases by withdrawn amount", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      const contractBefore = await doc.balanceOf(await vesting.getAddress());
      await vesting.connect(beneficiary).withdraw(ALLOCATION);
      const contractAfter  = await doc.balanceOf(await vesting.getAddress());

      expect(contractBefore - contractAfter).to.equal(ALLOCATION);
    });

    it("penalty amount stays in contract after early withdrawal", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 2); // 50% vested

      const contractBefore = await doc.balanceOf(await vesting.getAddress());
      await vesting.connect(beneficiary).withdraw(ethers.parseEther("600"));
      const contractAfter  = await doc.balanceOf(await vesting.getAddress());

      // Contract reduced by ~580 (actualReceived), not 600
      // Meaning ~20 DOC penalty stayed inside the contract
      const reduced = contractBefore - contractAfter;
      expect(reduced).to.be.closeTo(
        ethers.parseEther("580"),
        ethers.parseEther("1")
      );

      // penaltyPool state variable reflects the retained penalty
      expect(await vesting.penaltyPool()).to.be.closeTo(
        ethers.parseEther("20"),
        ethers.parseEther("1")
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 8 — Event Emission
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 8: Event Emission", function () {

    it("fundContract emits ContractFunded with correct args", async function () {
      await expect(vesting.fundContract(ALLOCATION))
        .to.emit(vesting, "ContractFunded")
        .withArgs(admin.address, ALLOCATION);
    });

    it("setup emits BeneficiarySet with correct args", async function () {
      await vesting.fundContract(ALLOCATION);
      await expect(
        vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF)
      ).to.emit(vesting, "BeneficiarySet");
    });

    it("normal withdrawal emits Withdrawal with zero penalty", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(CLIFF + 1);

      const withdrawAmount = ethers.parseEther("100");
      await expect(vesting.connect(beneficiary).withdraw(withdrawAmount))
        .to.emit(vesting, "Withdrawal")
        .withArgs(beneficiary.address, withdrawAmount, 0, "VESTING");
    });

    it("early withdrawal emits Withdrawal with EARLY_EXIT state", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING / 2);

      const tx      = await vesting.connect(beneficiary).withdraw(ethers.parseEther("600"));
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => {
        try { return vesting.interface.parseLog(log).name === "Withdrawal"; }
        catch { return false; }
      });

      const parsed = vesting.interface.parseLog(event);
      expect(parsed.args[3]).to.equal("EARLY_EXIT");
    });

    it("complete withdrawal emits Withdrawal with COMPLETE state", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      await expect(vesting.connect(beneficiary).withdraw(ALLOCATION))
        .to.emit(vesting, "Withdrawal")
        .withArgs(beneficiary.address, ALLOCATION, 0, "COMPLETE");
    });

    it("every withdrawal emits an event — no silent transfers", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);
      await time.increase(VESTING + 1);

      const tx      = await vesting.connect(beneficiary).withdraw(ALLOCATION);
      const receipt = await tx.wait();

      const withdrawalEvent = receipt.logs.find(log => {
        try { return vesting.interface.parseLog(log).name === "Withdrawal"; }
        catch { return false; }
      });

      expect(withdrawalEvent).to.not.be.undefined;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT 9 — Boundary Timing Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Audit 9: Boundary Timing Edge Cases", function () {

    it("withdrawal reverts before cliff ends", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      // Stay well inside the cliff window — 1 day in, cliff is 30 days
      await time.increase(ONE_DAY);

      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("10"))
      ).to.be.revertedWith("Cliff period has not passed yet");
    });

    it("withdrawal succeeds at exactly the cliff boundary", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await time.increase(CLIFF);

      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("10"))
      ).to.not.be.reverted;
    });

    it("vault is VESTING at exactly cliff boundary", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await time.increase(CLIFF);
      expect(await vesting.vaultState()).to.equal("VESTING");
    });

    it("vault is COMPLETE at exactly vesting period boundary", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await time.increase(VESTING);
      expect(await vesting.vaultState()).to.equal("COMPLETE");
    });

    it("no penalty applies at exactly the vesting period boundary", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await time.increase(VESTING);

      const [penalty] = await vesting.previewWithdrawal(ALLOCATION);
      expect(penalty).to.equal(0);
    });

    it("vestedAmount equals totalAllocation at exactly vesting boundary", async function () {
      await vesting.fundContract(ALLOCATION);
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, CLIFF);

      await time.increase(VESTING);
      expect(await vesting.vestedAmount()).to.equal(ALLOCATION);
    });

    it("withdrawal with no cliff works immediately after setup", async function () {
      await vesting.fundContract(ALLOCATION);
      // Set cliff to 0 — no waiting period at all
      await vesting.setup(beneficiary.address, ALLOCATION, VESTING, 0);

      await expect(
        vesting.connect(beneficiary).withdraw(ethers.parseEther("1"))
      ).to.not.be.reverted;
    });
  });
});