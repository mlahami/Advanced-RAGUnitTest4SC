// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./ICreditRegistry.sol";

/**
 * @title CreditRegistry
 * @notice On-chain credit registry that stores borrower credit profiles.
 *         Only an authorized oracle (backend risk engine) can update credit scores.
 * @dev Scores are on a 0-1000 scale. Risk bands:
 *      A: 800-1000 (best)
 *      B: 600-799
 *      C: 400-599
 *      D: 0-399 (worst)
 */
contract CreditRegistry is ICreditRegistry, Ownable, Pausable {
    // ═══════════════════════════════════════════════════════════════
    //                          STATE
    // ═══════════════════════════════════════════════════════════════

    /// @notice Address authorized to update credit scores (backend oracle)
    address public oracle;

    /// @notice Mapping from borrower address to their credit profile
    mapping(address => BorrowerProfile) private _profiles;

    /// @notice Total number of registered borrowers
    uint256 public totalBorrowers;

    /// @notice Emitted when the authorized oracle address changes
    event OracleUpdated(address indexed previousOracle, address indexed newOracle);

    // Risk band thresholds
    uint256 public constant BAND_A_THRESHOLD = 800;
    uint256 public constant BAND_B_THRESHOLD = 600;
    uint256 public constant BAND_C_THRESHOLD = 400;
    uint256 public constant MAX_SCORE = 1000;
    uint256 public constant DEFAULT_SCORE = 500;

    // ═══════════════════════════════════════════════════════════════
    //                         MODIFIERS
    // ═══════════════════════════════════════════════════════════════

    modifier onlyOracle() {
        require(msg.sender == oracle, "CreditRegistry: caller is not the oracle");
        _;
    }

    modifier onlyOracleOrOwner() {
        require(
            msg.sender == oracle || msg.sender == owner(),
            "CreditRegistry: caller is not oracle or owner"
        );
        _;
    }

    modifier borrowerExists(address borrower) {
        require(_profiles[borrower].isRegistered, "CreditRegistry: borrower not registered");
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    //                        CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param _oracle Address of the backend oracle service
     */
    constructor(address _oracle) Ownable(msg.sender) {
        require(_oracle != address(0), "CreditRegistry: oracle is zero address");
        oracle = _oracle;
    }

    // ═══════════════════════════════════════════════════════════════
    //                      ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Update the oracle address
     * @param newOracle New oracle address
     */
    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "CreditRegistry: oracle is zero address");
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    /**
     * @notice Pause the contract (emergency stop)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════
    //                     ORACLE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Register a new borrower with a default credit score
     * @param borrower Address of the borrower to register
     */
    function registerBorrower(address borrower) external override onlyOracleOrOwner whenNotPaused {
        require(borrower != address(0), "CreditRegistry: borrower is zero address");
        require(!_profiles[borrower].isRegistered, "CreditRegistry: borrower already registered");

        _profiles[borrower] = BorrowerProfile({
            creditScore: DEFAULT_SCORE,
            totalLoans: 0,
            repaidLoans: 0,
            defaultedLoans: 0,
            reputationMultiplier: 100, // 1x multiplier (basis points / 100)
            lastUpdated: block.timestamp,
            isRegistered: true
        });

        totalBorrowers++;
        emit BorrowerRegistered(borrower, block.timestamp);
    }

    /**
     * @notice Update a borrower's credit score
     * @param borrower Address of the borrower
     * @param newScore New credit score (0-1000)
     */
    function updateCreditScore(
        address borrower,
        uint256 newScore
    ) external override onlyOracle whenNotPaused borrowerExists(borrower) {
        require(newScore <= MAX_SCORE, "CreditRegistry: score exceeds maximum");

        uint256 oldScore = _profiles[borrower].creditScore;
        _profiles[borrower].creditScore = newScore;
        _profiles[borrower].lastUpdated = block.timestamp;

        // Update reputation multiplier based on score trajectory
        if (newScore > oldScore) {
            // Score improved → boost reputation (cap at 200 = 2x)
            uint256 newMultiplier = _profiles[borrower].reputationMultiplier + 5;
            _profiles[borrower].reputationMultiplier = newMultiplier > 200 ? 200 : newMultiplier;
        } else if (newScore < oldScore) {
            // Score decreased → reduce reputation (floor at 50 = 0.5x)
            uint256 currentMultiplier = _profiles[borrower].reputationMultiplier;
            _profiles[borrower].reputationMultiplier = currentMultiplier > 55 ? currentMultiplier - 5 : 50;
        }

        emit CreditScoreUpdated(borrower, oldScore, newScore, block.timestamp);
    }

    /**
     * @notice Record a new loan taken by borrower
     * @param borrower Address of the borrower
     */
    function recordLoan(
        address borrower
    ) external override onlyOracleOrOwner whenNotPaused borrowerExists(borrower) {
        _profiles[borrower].totalLoans++;
        emit LoanRecorded(borrower, _profiles[borrower].totalLoans);
    }

    /**
     * @notice Record a loan repayment by borrower
     * @param borrower Address of the borrower
     */
    function recordRepayment(
        address borrower
    ) external override onlyOracleOrOwner whenNotPaused borrowerExists(borrower) {
        _profiles[borrower].repaidLoans++;
        emit RepaymentRecorded(borrower, _profiles[borrower].repaidLoans);
    }

    /**
     * @notice Record a loan default by borrower
     * @param borrower Address of the borrower
     */
    function recordDefault(
        address borrower
    ) external override onlyOracleOrOwner whenNotPaused borrowerExists(borrower) {
        _profiles[borrower].defaultedLoans++;
        emit DefaultRecorded(borrower, _profiles[borrower].defaultedLoans);
    }

    // ═══════════════════════════════════════════════════════════════
    //                      VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Get the credit score of a borrower
     */
    function getCreditScore(address borrower) external view override returns (uint256) {
        require(_profiles[borrower].isRegistered, "CreditRegistry: borrower not registered");
        return _profiles[borrower].creditScore;
    }

    /**
     * @notice Get the full borrower profile
     */
    function getBorrowerProfile(
        address borrower
    ) external view override returns (BorrowerProfile memory) {
        require(_profiles[borrower].isRegistered, "CreditRegistry: borrower not registered");
        return _profiles[borrower];
    }

    /**
     * @notice Get the risk band for a borrower
     * @return RiskBand enum: A (800+), B (600-799), C (400-599), D (<400)
     */
    function getRiskBand(address borrower) external view override returns (RiskBand) {
        require(_profiles[borrower].isRegistered, "CreditRegistry: borrower not registered");
        return _calculateRiskBand(_profiles[borrower].creditScore);
    }

    /**
     * @notice Check if a borrower is registered
     */
    function isRegistered(address borrower) external view override returns (bool) {
        return _profiles[borrower].isRegistered;
    }

    // ═══════════════════════════════════════════════════════════════
    //                     INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function _calculateRiskBand(uint256 score) internal pure returns (RiskBand) {
        if (score >= BAND_A_THRESHOLD) return RiskBand.A;
        if (score >= BAND_B_THRESHOLD) return RiskBand.B;
        if (score >= BAND_C_THRESHOLD) return RiskBand.C;
        return RiskBand.D;
    }
}
