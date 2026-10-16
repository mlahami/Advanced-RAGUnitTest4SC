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
