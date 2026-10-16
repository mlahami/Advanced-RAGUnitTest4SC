# loan-registry--quantsingularity

- domain: lending-collateral (lending)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/QuantSingularity/LendSmart @ 48d6d263788b9aebeee5143da86db942f2867369
- license: MIT
- targets: LoanRegistry.sol
- validation: 17 passing tests, 0 failing; statement coverage LoanRegistry.sol 95.24 %

## Contract: LoanRegistry.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title LoanRegistry
 * @dev Immutable, publicly-auditable anchor for loans that LendSmart originates
 * off-chain (KYC + a traditional payment processor move the actual funds).
 *
 * This is deliberately NOT an escrow contract: it never holds tokens and never
 * assigns `borrower`/`lender` from `msg.sender`, because the caller here is
 * always the platform's own backend operator wallet relaying on behalf of
 * users who do not sign their own transactions. Every write takes the real
 * borrower/lender addresses as explicit parameters and is restricted to the
 * contract owner (the backend's operator address) so the on-chain record
 * still faithfully reflects who actually borrowed and lent, even though the
 * backend is the one submitting the transaction.
 *
 * Each record is keyed by both an auto-incrementing on-chain `recordId` and
 * the off-chain Loan document id it corresponds to, so the backend can look
 * a record up either way after the fact.
 */
contract LoanRegistry is Ownable, Pausable {
    enum RecordStatus {
        Funded,
        Repaying,
        Repaid,
        Defaulted
    }

    struct LoanRecord {
        uint256 recordId;
        uint256 offChainLoanId;
        address borrower;
        address lender;
        uint256 principal;
        uint256 interestRate; // e.g. 500 = 5.00%, matches LendSmartLoan's convention
        uint256 termSeconds;
        uint256 maturityTimestamp;
        uint256 repaymentAmountDue; // principal + interest; 0 if unknown/not supplied
        uint256 amountRepaid;
        RecordStatus status;
        uint256 fundedAt;
    }

    uint256 public nextRecordId;
    mapping(uint256 => LoanRecord) public records;
    // off-chain Loan document id -> on-chain recordId (+1, so 0 means "none")
    mapping(uint256 => uint256) private offChainLoanIdToRecordIdPlusOne;

    event LoanFunded(
        uint256 indexed recordId,
        uint256 indexed offChainLoanId,
        address indexed borrower,
        address lender,
        uint256 principal,
        uint256 interestRate,
        uint256 termSeconds,
        uint256 maturityTimestamp
    );

    event RepaymentRecorded(
        uint256 indexed recordId,
        uint256 amount,
        uint256 totalAmountRepaid,
        bool isFullyRepaid
    );

    event LoanDefaultedRecorded(uint256 indexed recordId);

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    /**
     * @dev Anchors a loan that has just been funded off-chain. Callable only
     * by the operator (owner) wallet the backend signs with.
     * @param _offChainLoanId The backend's Loan document id, as a uint256
     * (e.g. the numeric value of its Mongo ObjectId).
     * @param _repaymentAmountDue Total amount due (principal + interest), or
     * 0 if the caller doesn't want to track a due amount on-chain.
     * @return recordId The new on-chain record's id.
     */
    function recordLoanFunded(
        uint256 _offChainLoanId,
        address _borrower,
        address _lender,
        uint256 _principal,
        uint256 _interestRate,
        uint256 _termSeconds,
        uint256 _maturityTimestamp,
        uint256 _repaymentAmountDue
    ) external onlyOwner whenNotPaused returns (uint256 recordId) {
        require(
            _borrower != address(0),
            "LoanRegistry: Borrower cannot be zero address"
        );
        require(
            _lender != address(0),
            "LoanRegistry: Lender cannot be zero address"
        );
        require(
            _principal > 0,
            "LoanRegistry: Principal must be greater than zero"
        );
        require(
            offChainLoanIdToRecordIdPlusOne[_offChainLoanId] == 0,
            "LoanRegistry: This off-chain loan is already recorded"
        );

        recordId = nextRecordId++;

        records[recordId] = LoanRecord({
            recordId: recordId,
            offChainLoanId: _offChainLoanId,
            borrower: _borrower,
            lender: _lender,
            principal: _principal,
            interestRate: _interestRate,
            termSeconds: _termSeconds,
            maturityTimestamp: _maturityTimestamp,
            repaymentAmountDue: _repaymentAmountDue,
            amountRepaid: 0,
            status: RecordStatus.Funded,
            fundedAt: block.timestamp
        });

        offChainLoanIdToRecordIdPlusOne[_offChainLoanId] = recordId + 1;

        emit LoanFunded(
            recordId,
            _offChainLoanId,
            _borrower,
            _lender,
            _principal,
            _interestRate,
            _termSeconds,
            _maturityTimestamp
        );
    }

    /**
     * @dev Anchors a repayment against a previously-recorded loan. Marks the
     * record Repaid once amountRepaid reaches repaymentAmountDue (only when
     * a non-zero due amount was supplied at funding time).
     */
    function recordRepayment(
        uint256 _recordId,
        uint256 _amount
    ) external onlyOwner whenNotPaused {
        LoanRecord storage record = records[_recordId];
        require(
            record.borrower != address(0),
            "LoanRegistry: Record does not exist"
        );
        require(
            record.status == RecordStatus.Funded ||
                record.status == RecordStatus.Repaying,
            "LoanRegistry: Loan is not in a repayable state"
        );
        require(_amount > 0, "LoanRegistry: Amount must be greater than zero");

        record.amountRepaid += _amount;

        bool isFullyRepaid =
            record.repaymentAmountDue > 0 &&
                record.amountRepaid >= record.repaymentAmountDue;

        record.status =
            isFullyRepaid ? RecordStatus.Repaid : RecordStatus.Repaying;

        emit RepaymentRecorded(
            _recordId,
            _amount,
            record.amountRepaid,
            isFullyRepaid
        );
    }

    /**
     * @dev Anchors a default event against a previously-recorded loan.
     */
    function recordDefault(uint256 _recordId) external onlyOwner whenNotPaused {
        LoanRecord storage record = records[_recordId];
        require(
            record.borrower != address(0),
            "LoanRegistry: Record does not exist"
        );
        require(
            record.status == RecordStatus.Funded ||
                record.status == RecordStatus.Repaying,
            "LoanRegistry: Loan is not in a defaultable state"
        );

        record.status = RecordStatus.Defaulted;

        emit LoanDefaultedRecorded(_recordId);
    }

    function getRecord(
        uint256 _recordId
    ) external view returns (LoanRecord memory) {
        return records[_recordId];
    }

    /**
     * @dev Look up the on-chain recordId for a given off-chain Loan id.
     * Reverts if no record exists, since 0 is a valid recordId.
     */
    function getRecordIdForOffChainLoan(
        uint256 _offChainLoanId
    ) external view returns (uint256) {
        uint256 recordIdPlusOne = offChainLoanIdToRecordIdPlusOne[
            _offChainLoanId
        ];
        require(
            recordIdPlusOne != 0,
            "LoanRegistry: No record for this off-chain loan"
        );
        return recordIdPlusOne - 1;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
```

## Tests: LoanRegistry.test.js

```javascript
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
```
