// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICreditRegistry
 * @notice Interface for the Credit Registry contract
 */
interface ICreditRegistry {
    struct BorrowerProfile {
        uint256 creditScore;      // 0-1000 scale
        uint256 totalLoans;
        uint256 repaidLoans;
        uint256 defaultedLoans;
        uint256 reputationMultiplier; // basis points (100 = 1x)
        uint256 lastUpdated;
        bool isRegistered;
    }

    enum RiskBand { D, C, B, A }

    event BorrowerRegistered(address indexed borrower, uint256 timestamp);
    event CreditScoreUpdated(address indexed borrower, uint256 oldScore, uint256 newScore, uint256 timestamp);
    event LoanRecorded(address indexed borrower, uint256 totalLoans);
    event RepaymentRecorded(address indexed borrower, uint256 repaidLoans);
    event DefaultRecorded(address indexed borrower, uint256 defaultedLoans);

    function registerBorrower(address borrower) external;
    function updateCreditScore(address borrower, uint256 newScore) external;
    function recordLoan(address borrower) external;
    function recordRepayment(address borrower) external;
    function recordDefault(address borrower) external;
    function getCreditScore(address borrower) external view returns (uint256);
    function getBorrowerProfile(address borrower) external view returns (BorrowerProfile memory);
    function getRiskBand(address borrower) external view returns (RiskBand);
    function isRegistered(address borrower) external view returns (bool);
}
