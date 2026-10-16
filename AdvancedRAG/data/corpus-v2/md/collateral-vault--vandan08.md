# collateral-vault--vandan08

- domain: lending-collateral (lending)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/vandan08/CredLayer @ 1afa6d305c46635741133355c37824b667a963a2
- license: MIT
- targets: CollateralVault.sol, CreditRegistry.sol, MockUSDC.sol, ICreditRegistry.sol
- validation: 11 passing tests, 0 failing; statement coverage CollateralVault.sol 84.85 %, CreditRegistry.sol 57.14 %, MockUSDC.sol 50.0 %, ICreditRegistry.sol 100.0 %

## Contract: CollateralVault.sol (primary target)

```solidity
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
```

## Contract: CreditRegistry.sol (dependency)

```solidity
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
```

## Contract: ICreditRegistry.sol (dependency)

```solidity
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
```

## Contract: MockUSDC.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice A mock USDC token for testing and local development
 * @dev Mintable by owner, 6 decimals like real USDC
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private constant DECIMALS = 6;

    constructor() ERC20("USD Coin", "USDC") Ownable(msg.sender) {
        // Mint 1,000,000 USDC to deployer for testing
        _mint(msg.sender, 1_000_000 * 10 ** DECIMALS);
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /**
     * @notice Mint tokens to a specified address (owner only)
     * @param to Address to receive tokens
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Faucet function for testing - anyone can mint up to 10,000 USDC
     */
    function faucet() external {
        _mint(msg.sender, 10_000 * 10 ** DECIMALS);
    }
}
```

## Tests: CollateralVault.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CollateralVault", function () {
    let usdc, creditRegistry, collateralVault;
    let owner, oracle, user1, lendingPoolMock;
    const USDC_DECIMALS = 6;
    const toUSDC = (amount) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);

    beforeEach(async function () {
        [owner, oracle, user1, lendingPoolMock] = await ethers.getSigners();

        // Deploy MockUSDC
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();
        await usdc.waitForDeployment();

        // Deploy CreditRegistry
        const CreditRegistry = await ethers.getContractFactory("CreditRegistry");
        creditRegistry = await CreditRegistry.deploy(oracle.address);
        await creditRegistry.waitForDeployment();

        // Deploy CollateralVault
        const CollateralVault = await ethers.getContractFactory("CollateralVault");
        collateralVault = await CollateralVault.deploy(
            await creditRegistry.getAddress(),
            await usdc.getAddress()
        );
        await collateralVault.waitForDeployment();

        // Set lending pool
        await collateralVault.setLendingPool(lendingPoolMock.address);

        // Register and score user
        await creditRegistry.connect(oracle).registerBorrower(user1.address);

        // Give user some USDC
        await usdc.mint(user1.address, toUSDC(100000));
    });

    describe("Deposit & Withdraw Collateral", function () {
        it("Should deposit collateral", async function () {
            await usdc.connect(user1).approve(await collateralVault.getAddress(), toUSDC(1000));
            await collateralVault.connect(user1).depositCollateral(toUSDC(1000));

            expect(await collateralVault.collateralBalance(user1.address)).to.equal(toUSDC(1000));
        });

        it("Should emit CollateralDeposited event", async function () {
            await usdc.connect(user1).approve(await collateralVault.getAddress(), toUSDC(1000));
            await expect(collateralVault.connect(user1).depositCollateral(toUSDC(1000)))
                .to.emit(collateralVault, "CollateralDeposited")
                .withArgs(user1.address, toUSDC(1000));
        });

        it("Should withdraw collateral", async function () {
            await usdc.connect(user1).approve(await collateralVault.getAddress(), toUSDC(1000));
            await collateralVault.connect(user1).depositCollateral(toUSDC(1000));
            await collateralVault.connect(user1).withdrawCollateral(toUSDC(500));

            expect(await collateralVault.collateralBalance(user1.address)).to.equal(toUSDC(500));
        });

        it("Should revert withdraw if insufficient balance", async function () {
            await expect(
                collateralVault.connect(user1).withdrawCollateral(toUSDC(1000))
            ).to.be.revertedWith("CollateralVault: insufficient balance");
        });
    });

    describe("Required Collateral Calculation", function () {
        it("Should require 110% for C-band (default 500 score)", async function () {
            // Default score is 500 (C-band) → 110% collateral
            const required = await collateralVault.getRequiredCollateral(user1.address, toUSDC(1000));
            expect(required).to.equal(toUSDC(1100)); // 110%
        });

        it("Should require 40% for A-band borrower", async function () {
            await creditRegistry.connect(oracle).updateCreditScore(user1.address, 850);
            const required = await collateralVault.getRequiredCollateral(user1.address, toUSDC(1000));
            expect(required).to.equal(toUSDC(400)); // 40%
        });

        it("Should require 70% for B-band borrower", async function () {
            await creditRegistry.connect(oracle).updateCreditScore(user1.address, 700);
            const required = await collateralVault.getRequiredCollateral(user1.address, toUSDC(1000));
            expect(required).to.equal(toUSDC(700)); // 70%
        });
    });

    describe("Lock & Unlock (LendingPool Only)", function () {
        beforeEach(async function () {
            await usdc.connect(user1).approve(await collateralVault.getAddress(), toUSDC(5000));
            await collateralVault.connect(user1).depositCollateral(toUSDC(5000));
        });

        it("Should lock collateral (lending pool only)", async function () {
            await collateralVault.connect(lendingPoolMock).lockCollateral(user1.address, toUSDC(1000));
            expect(await collateralVault.lockedCollateral(user1.address)).to.equal(toUSDC(1000));
            expect(await collateralVault.collateralBalance(user1.address)).to.equal(toUSDC(4000));
        });

        it("Should unlock collateral", async function () {
            await collateralVault.connect(lendingPoolMock).lockCollateral(user1.address, toUSDC(1000));
            await collateralVault.connect(lendingPoolMock).unlockCollateral(user1.address, toUSDC(1000));

            expect(await collateralVault.lockedCollateral(user1.address)).to.equal(0);
            expect(await collateralVault.collateralBalance(user1.address)).to.equal(toUSDC(5000));
        });

        it("Should revert if non-lending-pool tries to lock", async function () {
            await expect(
                collateralVault.connect(user1).lockCollateral(user1.address, toUSDC(1000))
            ).to.be.revertedWith("CollateralVault: caller is not lending pool");
        });
    });

    describe("Liquidation", function () {
        beforeEach(async function () {
            await usdc.connect(user1).approve(await collateralVault.getAddress(), toUSDC(5000));
            await collateralVault.connect(user1).depositCollateral(toUSDC(5000));
            await collateralVault.connect(lendingPoolMock).lockCollateral(user1.address, toUSDC(2000));
        });

        it("Should liquidate collateral to recipient", async function () {
            const balBefore = await usdc.balanceOf(owner.address);
            await collateralVault
                .connect(lendingPoolMock)
                .liquidateCollateral(user1.address, toUSDC(2000), owner.address);

            expect(await collateralVault.lockedCollateral(user1.address)).to.equal(0);
            const balAfter = await usdc.balanceOf(owner.address);
            expect(balAfter - balBefore).to.equal(toUSDC(2000));
        });
    });
});
```
