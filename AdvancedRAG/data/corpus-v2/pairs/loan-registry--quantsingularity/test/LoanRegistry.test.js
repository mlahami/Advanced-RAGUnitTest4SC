const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LoanRegistry", function () {
  let loanRegistry;
  let operator, borrower, lender, otherAccount;

  const OFF_CHAIN_LOAN_ID = 12345;
  const PRINCIPAL = ethers.parseUnits("1000", 18);
  const INTEREST_RATE = 500; // 5.00%
  const TERM_SECONDS = 30 * 86400;
  const REPAYMENT_DUE = ethers.parseUnits("1050", 18);

  beforeEach(async function () {
    [operator, borrower, lender, otherAccount] = await ethers.getSigners();

    const LoanRegistry = await ethers.getContractFactory("LoanRegistry");
    loanRegistry = await LoanRegistry.deploy(operator.address);
  });

  async function fundOne() {
    const maturity =
      (await ethers.provider.getBlock("latest")).timestamp + TERM_SECONDS;
    const tx = await loanRegistry
      .connect(operator)
      .recordLoanFunded(
        OFF_CHAIN_LOAN_ID,
        borrower.address,
        lender.address,
        PRINCIPAL,
        INTEREST_RATE,
        TERM_SECONDS,
        maturity,
        REPAYMENT_DUE,
      );
    await tx.wait();
    return { maturity };
  }

  describe("Deployment", function () {
    it("Should set the operator as owner", async function () {
      expect(await loanRegistry.owner()).to.equal(operator.address);
    });

    it("Should start with no records", async function () {
      expect(await loanRegistry.nextRecordId()).to.equal(0);
    });
  });

  describe("recordLoanFunded", function () {
    it("Should record a funded loan under the real borrower/lender, not the operator", async function () {
      await fundOne();

      const record = await loanRegistry.getRecord(0);
      expect(record.borrower).to.equal(borrower.address);
      expect(record.lender).to.equal(lender.address);
      expect(record.principal).to.equal(PRINCIPAL);
      expect(record.status).to.equal(0); // Funded
      expect(record.amountRepaid).to.equal(0);
    });

    it("Should emit LoanFunded with the correct indexed fields", async function () {
      const maturity =
        (await ethers.provider.getBlock("latest")).timestamp + TERM_SECONDS + 1;
      await expect(
        loanRegistry
          .connect(operator)
          .recordLoanFunded(
            OFF_CHAIN_LOAN_ID,
            borrower.address,
            lender.address,
            PRINCIPAL,
            INTEREST_RATE,
            TERM_SECONDS,
            maturity,
            REPAYMENT_DUE,
          ),
      )
        .to.emit(loanRegistry, "LoanFunded")
        .withArgs(
          0,
          OFF_CHAIN_LOAN_ID,
          borrower.address,
          lender.address,
          PRINCIPAL,
          INTEREST_RATE,
          TERM_SECONDS,
          maturity,
        );
    });

    it("Should let the off-chain loan id be looked up to its record id", async function () {
      await fundOne();
      expect(
        await loanRegistry.getRecordIdForOffChainLoan(OFF_CHAIN_LOAN_ID),
      ).to.equal(0);
    });

    it("Should reject recording the same off-chain loan twice", async function () {
      await fundOne();
      await expect(fundOne()).to.be.revertedWith(
        "LoanRegistry: This off-chain loan is already recorded",
      );
    });

    it("Should reject a zero-address borrower or lender", async function () {
      await expect(
        loanRegistry
          .connect(operator)
          .recordLoanFunded(
            OFF_CHAIN_LOAN_ID,
            ethers.ZeroAddress,
            lender.address,
            PRINCIPAL,
            INTEREST_RATE,
            TERM_SECONDS,
            0,
            REPAYMENT_DUE,
          ),
      ).to.be.revertedWith("LoanRegistry: Borrower cannot be zero address");

      await expect(
        loanRegistry
          .connect(operator)
          .recordLoanFunded(
            OFF_CHAIN_LOAN_ID,
            borrower.address,
            ethers.ZeroAddress,
            PRINCIPAL,
            INTEREST_RATE,
            TERM_SECONDS,
            0,
            REPAYMENT_DUE,
          ),
      ).to.be.revertedWith("LoanRegistry: Lender cannot be zero address");
    });

    it("Should reject calls from anyone other than the operator", async function () {
      await expect(
        loanRegistry
          .connect(otherAccount)
          .recordLoanFunded(
            OFF_CHAIN_LOAN_ID,
            borrower.address,
            lender.address,
            PRINCIPAL,
            INTEREST_RATE,
            TERM_SECONDS,
            0,
            REPAYMENT_DUE,
          ),
      ).to.be.revertedWithCustomError(
        loanRegistry,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("recordRepayment", function () {
    beforeEach(async function () {
      await fundOne();
    });

    it("Should accumulate partial repayments without marking the loan repaid", async function () {
      const partial = ethers.parseUnits("500", 18);
      await loanRegistry.connect(operator).recordRepayment(0, partial);

      const record = await loanRegistry.getRecord(0);
      expect(record.amountRepaid).to.equal(partial);
      expect(record.status).to.equal(1); // Repaying
    });

    it("Should mark the loan Repaid once amountRepaid reaches the due amount", async function () {
      await expect(
        loanRegistry.connect(operator).recordRepayment(0, REPAYMENT_DUE),
      )
        .to.emit(loanRegistry, "RepaymentRecorded")
        .withArgs(0, REPAYMENT_DUE, REPAYMENT_DUE, true);

      const record = await loanRegistry.getRecord(0);
      expect(record.status).to.equal(2); // Repaid
    });

    it("Should reject repayments against a non-existent record", async function () {
      await expect(
        loanRegistry.connect(operator).recordRepayment(999, PRINCIPAL),
      ).to.be.revertedWith("LoanRegistry: Record does not exist");
    });

    it("Should reject further repayments once a loan is already Repaid", async function () {
      await loanRegistry.connect(operator).recordRepayment(0, REPAYMENT_DUE);
      await expect(
        loanRegistry.connect(operator).recordRepayment(0, PRINCIPAL),
      ).to.be.revertedWith("LoanRegistry: Loan is not in a repayable state");
    });

    it("Should reject calls from anyone other than the operator", async function () {
      await expect(
        loanRegistry.connect(otherAccount).recordRepayment(0, PRINCIPAL),
      ).to.be.revertedWithCustomError(
        loanRegistry,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("recordDefault", function () {
    beforeEach(async function () {
      await fundOne();
    });

    it("Should mark a funded loan as Defaulted", async function () {
      await expect(loanRegistry.connect(operator).recordDefault(0))
        .to.emit(loanRegistry, "LoanDefaultedRecorded")
        .withArgs(0);

      const record = await loanRegistry.getRecord(0);
      expect(record.status).to.equal(3); // Defaulted
    });

    it("Should reject defaulting an already-repaid loan", async function () {
      await loanRegistry.connect(operator).recordRepayment(0, REPAYMENT_DUE);
      await expect(
        loanRegistry.connect(operator).recordDefault(0),
      ).to.be.revertedWith("LoanRegistry: Loan is not in a defaultable state");
    });
  });

  describe("Pausable", function () {
    it("Should prevent recording while paused", async function () {
      await loanRegistry.connect(operator).pause();

      await expect(fundOne()).to.be.revertedWithCustomError(
        loanRegistry,
        "EnforcedPause",
      );
    });

    it("Should prevent non-owners from pausing", async function () {
      await expect(
        loanRegistry.connect(otherAccount).pause(),
      ).to.be.revertedWithCustomError(
        loanRegistry,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});
