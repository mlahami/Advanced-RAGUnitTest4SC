// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ICreditRegistry.sol";

/**
 * @title CollateralVault
 * @notice Manages collateral deposits for under-collateralized loans.
 *         Collateral requirements are dynamically determined by borrower credit score.
 * @dev LTV ratios:
 *      Band A (800+):  40% collateral required
 *      Band B (600-799): 70% collateral required
 *      Band C (400-599): 110% collateral required
 *      Band D (<400):  110% collateral required (same as C, highest risk)
 */
contract CollateralVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════
    //                          STATE
    // ═══════════════════════════════════════════════════════════════

    ICreditRegistry public creditRegistry;
    IERC20 public collateralToken; // Token used as collateral (e.g., USDC)

    /// @notice Lending pool address, authorized to lock/release collateral
    address public lendingPool;

    /// @notice Collateral balances per user (available, not locked)
    mapping(address => uint256) public collateralBalance;

    /// @notice Locked collateral per user (tied to active loans)
    mapping(address => uint256) public lockedCollateral;

    // Collateral ratios in basis points (4000 = 40%)
    uint256 public constant COLLATERAL_RATIO_A = 4000;
    uint256 public constant COLLATERAL_RATIO_B = 7000;
    uint256 public constant COLLATERAL_RATIO_C = 11000;
    uint256 public constant COLLATERAL_RATIO_D = 11000;

    // Liquidation threshold (when collateral value drops below this % of loan)
    uint256 public constant LIQUIDATION_THRESHOLD = 8000; // 80%

    // ═══════════════════════════════════════════════════════════════
    //                          EVENTS
    // ═══════════════════════════════════════════════════════════════

    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event CollateralLocked(address indexed user, uint256 amount);
    event CollateralUnlocked(address indexed user, uint256 amount);
    event CollateralLiquidated(address indexed user, uint256 amount);
    event LendingPoolUpdated(address indexed previousPool, address indexed newPool);

    // ═══════════════════════════════════════════════════════════════
    //                         MODIFIERS
    // ═══════════════════════════════════════════════════════════════

    modifier onlyLendingPool() {
        require(msg.sender == lendingPool, "CollateralVault: caller is not lending pool");
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    //                        CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param _creditRegistry Address of the CreditRegistry contract
     * @param _collateralToken Address of the ERC20 token used as collateral
     */
    constructor(
        address _creditRegistry,
        address _collateralToken
    ) Ownable(msg.sender) {
        require(_creditRegistry != address(0), "CollateralVault: zero address");
        require(_collateralToken != address(0), "CollateralVault: zero address");

        creditRegistry = ICreditRegistry(_creditRegistry);
        collateralToken = IERC20(_collateralToken);
    }

    // ═══════════════════════════════════════════════════════════════
    //                      ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Set the lending pool address (can only be set once or by owner)
     */
    function setLendingPool(address _lendingPool) external onlyOwner {
        require(_lendingPool != address(0), "CollateralVault: zero address");
        emit LendingPoolUpdated(lendingPool, _lendingPool);
        lendingPool = _lendingPool;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ═══════════════════════════════════════════════════════════════
    //                     USER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Deposit collateral tokens into the vault
     * @param amount Amount of collateral tokens to deposit
     */
    function depositCollateral(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "CollateralVault: amount must be > 0");

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        collateralBalance[msg.sender] += amount;

        emit CollateralDeposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw unlocked collateral
     * @param amount Amount to withdraw
     */
    function withdrawCollateral(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "CollateralVault: amount must be > 0");
        require(collateralBalance[msg.sender] >= amount, "CollateralVault: insufficient balance");

        collateralBalance[msg.sender] -= amount;
        collateralToken.safeTransfer(msg.sender, amount);

        emit CollateralWithdrawn(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════════
    //                  LENDING POOL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Lock collateral for a loan (called by LendingPool)
     * @param user Borrower address
     * @param amount Amount of collateral to lock
     */
    function lockCollateral(
        address user,
        uint256 amount
    ) external onlyLendingPool nonReentrant whenNotPaused {
        require(collateralBalance[user] >= amount, "CollateralVault: insufficient collateral");

        collateralBalance[user] -= amount;
        lockedCollateral[user] += amount;

        emit CollateralLocked(user, amount);
    }

    /**
     * @notice Unlock collateral after loan repayment (called by LendingPool)
     * @param user Borrower address
     * @param amount Amount of collateral to unlock
     */
    function unlockCollateral(
        address user,
        uint256 amount
    ) external onlyLendingPool nonReentrant whenNotPaused {
        require(lockedCollateral[user] >= amount, "CollateralVault: insufficient locked collateral");

        lockedCollateral[user] -= amount;
        collateralBalance[user] += amount;

        emit CollateralUnlocked(user, amount);
    }

    /**
     * @notice Liquidate collateral for a defaulted loan (called by LendingPool)
     * @param user Borrower address
     * @param amount Amount of collateral to seize
     * @param recipient Address to receive the liquidated collateral
     */
    function liquidateCollateral(
        address user,
        uint256 amount,
        address recipient
    ) external onlyLendingPool nonReentrant whenNotPaused {
        require(lockedCollateral[user] >= amount, "CollateralVault: insufficient locked collateral");

        lockedCollateral[user] -= amount;
        collateralToken.safeTransfer(recipient, amount);

        emit CollateralLiquidated(user, amount);
    }

    // ═══════════════════════════════════════════════════════════════
    //                      VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Get required collateral amount for a loan based on borrower's credit score
     * @param borrower Address of the borrower
     * @param loanAmount Amount of the loan
     * @return Required collateral amount
     */
    function getRequiredCollateral(
        address borrower,
        uint256 loanAmount
    ) external view returns (uint256) {
        ICreditRegistry.RiskBand band = creditRegistry.getRiskBand(borrower);
        uint256 ratio = _getCollateralRatio(band);
        return (loanAmount * ratio) / 10000;
    }

    /**
     * @notice Get the collateral ratio for a risk band
     * @param band Risk band enum
     * @return Collateral ratio in basis points
     */
    function getCollateralRatio(ICreditRegistry.RiskBand band) external pure returns (uint256) {
        return _getCollateralRatio(band);
    }

    /**
     * @notice Get total collateral for a user (locked + unlocked)
     */
    function getTotalCollateral(address user) external view returns (uint256) {
        return collateralBalance[user] + lockedCollateral[user];
    }

    // ═══════════════════════════════════════════════════════════════
    //                     INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function _getCollateralRatio(ICreditRegistry.RiskBand band) internal pure returns (uint256) {
        if (band == ICreditRegistry.RiskBand.A) return COLLATERAL_RATIO_A;
        if (band == ICreditRegistry.RiskBand.B) return COLLATERAL_RATIO_B;
        if (band == ICreditRegistry.RiskBand.C) return COLLATERAL_RATIO_C;
        return COLLATERAL_RATIO_D;
    }
}
