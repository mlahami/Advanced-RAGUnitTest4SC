// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ILendingPool.sol";
import "./InterestRateModel.sol";
import "./PriceOracle.sol";
import "./FlashLoan.sol";

/**
 * @title LendingPool
 * @notice Core lending pool for the PolkaLend protocol.
 *
 *  Supported operations:
 *    - deposit / withdraw collateral
 *    - borrow / repay (over-collateralized)
 *    - liquidate under-collateralized positions
 *    - flash loans
 */
contract LendingPool is ILendingPool, FlashLoan, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------------
    //  State
    // ----------------------------------------------------------------

    struct Market {
        bool isListed;
        uint256 collateralFactor; // 1e18 = 100 %
        uint256 totalDeposits;
        uint256 totalBorrows;
        uint256 reserveFactor;    // 1e18 = 100 %
    }

    InterestRateModel public interestRateModel;
    PriceOracle public oracle;

    /// token => Market
    mapping(address => Market) public markets;

    /// user => token => deposited balance
    mapping(address => mapping(address => uint256)) public userDeposits;

    /// user => token => borrowed balance
    mapping(address => mapping(address => uint256)) public userBorrows;

    /// Listed token addresses (for iteration)
    address[] public listedTokens;

    uint256 public constant LIQUIDATION_BONUS = 1.05e18; // 5 % bonus
    uint256 private constant SCALE = 1e18;

    // ----------------------------------------------------------------
    //  Constructor
    // ----------------------------------------------------------------

    constructor(
        address _interestRateModel,
        address _oracle
    ) Ownable(msg.sender) {
        interestRateModel = InterestRateModel(_interestRateModel);
        oracle = PriceOracle(_oracle);
    }

    // ----------------------------------------------------------------
    //  Admin
    // ----------------------------------------------------------------

    /**
     * @notice List a new token market.
     * @param token             ERC-20 address.
     * @param collateralFactor  Max borrow power (e.g. 0.75e18 = 75 %).
     * @param reserveFactor     Protocol reserve share of interest.
     */
    function addMarket(
        address token,
        uint256 collateralFactor,
        uint256 reserveFactor
    ) external onlyOwner {
        require(!markets[token].isListed, "Pool: already listed");
        require(collateralFactor <= SCALE, "Pool: CF > 100%");
        require(reserveFactor <= SCALE, "Pool: RF > 100%");

        markets[token] = Market({
            isListed: true,
            collateralFactor: collateralFactor,
            totalDeposits: 0,
            totalBorrows: 0,
            reserveFactor: reserveFactor
        });
        listedTokens.push(token);
    }

    // ----------------------------------------------------------------
    //  Core operations
    // ----------------------------------------------------------------

    function deposit(address token, uint256 amount) external override nonReentrant {
        Market storage m = markets[token];
        require(m.isListed, "Pool: not listed");
        require(amount > 0, "Pool: zero amount");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        userDeposits[msg.sender][token] += amount;
        m.totalDeposits += amount;

        emit Deposit(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external override nonReentrant {
        Market storage m = markets[token];
        require(m.isListed, "Pool: not listed");
        require(amount > 0, "Pool: zero amount");
        require(userDeposits[msg.sender][token] >= amount, "Pool: insufficient deposit");

        userDeposits[msg.sender][token] -= amount;
        m.totalDeposits -= amount;

        // Ensure user stays solvent after withdrawal
        require(_isHealthy(msg.sender), "Pool: undercollateralized");

        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, token, amount);
    }

    function borrow(address token, uint256 amount) external override nonReentrant {
        Market storage m = markets[token];
        require(m.isListed, "Pool: not listed");
        require(amount > 0, "Pool: zero amount");
        require(m.totalDeposits - m.totalBorrows >= amount, "Pool: insufficient liquidity");

        userBorrows[msg.sender][token] += amount;
        m.totalBorrows += amount;

        // Health check AFTER adding debt
        require(_isHealthy(msg.sender), "Pool: undercollateralized");

        IERC20(token).safeTransfer(msg.sender, amount);

        emit Borrow(msg.sender, token, amount);
    }

    function repay(address token, uint256 amount) external override nonReentrant {
        Market storage m = markets[token];
        require(m.isListed, "Pool: not listed");
        require(amount > 0, "Pool: zero amount");

        uint256 owed = userBorrows[msg.sender][token];
        uint256 repayAmount = amount > owed ? owed : amount;

        IERC20(token).safeTransferFrom(msg.sender, address(this), repayAmount);

        userBorrows[msg.sender][token] -= repayAmount;
        m.totalBorrows -= repayAmount;

        emit Repay(msg.sender, token, repayAmount);
    }

    // ----------------------------------------------------------------
    //  Liquidation
    // ----------------------------------------------------------------

    /**
     * @notice Liquidate an under-collateralized borrower.
     * @param borrower         Address to liquidate.
     * @param debtToken        Token the borrower owes.
     * @param collateralToken  Collateral to seize.
     * @param repayAmount      Amount of debt to repay on behalf of borrower.
     */
    function liquidate(
        address borrower,
        address debtToken,
        address collateralToken,
        uint256 repayAmount
    ) external nonReentrant {
        require(!_isHealthy(borrower), "Pool: borrower is healthy");
        require(repayAmount > 0, "Pool: zero amount");

        uint256 owed = userBorrows[borrower][debtToken];
        require(owed > 0, "Pool: no debt");
        // Can repay up to 50 % of the debt in one liquidation
        uint256 maxRepay = owed / 2;
        require(repayAmount <= maxRepay, "Pool: repay > 50%");

        // Transfer debt tokens from liquidator
        IERC20(debtToken).safeTransferFrom(msg.sender, address(this), repayAmount);
        userBorrows[borrower][debtToken] -= repayAmount;
        markets[debtToken].totalBorrows -= repayAmount;

        // Calculate collateral to seize (includes bonus)
        uint256 debtValue = (repayAmount * oracle.getPrice(debtToken)) / SCALE;
        uint256 collateralPrice = oracle.getPrice(collateralToken);
        uint256 seizeAmount = (debtValue * LIQUIDATION_BONUS) / collateralPrice;

        require(
            userDeposits[borrower][collateralToken] >= seizeAmount,
            "Pool: insufficient collateral"
        );

        userDeposits[borrower][collateralToken] -= seizeAmount;
        markets[collateralToken].totalDeposits -= seizeAmount;

        IERC20(collateralToken).safeTransfer(msg.sender, seizeAmount);

        emit Liquidate(msg.sender, borrower, collateralToken, repayAmount, seizeAmount);
    }

    // ----------------------------------------------------------------
    //  Flash loan
    // ----------------------------------------------------------------

    function flashLoan(
        address receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external override nonReentrant {
        require(markets[token].isListed, "Pool: not listed");
        _executeFlashLoan(receiver, token, amount, data);
        emit FlashLoan(receiver, token, amount, (amount * FLASH_LOAN_FEE_BPS) / 10_000);
    }

    // ----------------------------------------------------------------
    //  View helpers
    // ----------------------------------------------------------------

    /**
     * @notice Get the total collateral value (USD, 1e18) for a user.
     */
    function getCollateralValue(address user) public view returns (uint256 total) {
        for (uint256 i = 0; i < listedTokens.length; i++) {
            address t = listedTokens[i];
            uint256 deposited = userDeposits[user][t];
            if (deposited == 0) continue;
            uint256 price = oracle.getPrice(t);
            uint256 cf = markets[t].collateralFactor;
            total += (deposited * price * cf) / (SCALE * SCALE);
        }
    }

    /**
     * @notice Get the total borrow value (USD, 1e18) for a user.
     */
    function getBorrowValue(address user) public view returns (uint256 total) {
        for (uint256 i = 0; i < listedTokens.length; i++) {
            address t = listedTokens[i];
            uint256 borrowed = userBorrows[user][t];
            if (borrowed == 0) continue;
            total += (borrowed * oracle.getPrice(t)) / SCALE;
        }
    }

    /**
     * @notice Check whether a user position is healthy (collateral >= borrows).
     */
    function isHealthy(address user) external view returns (bool) {
        return _isHealthy(user);
    }

    function getListedTokens() external view returns (address[] memory) {
        return listedTokens;
    }

    // ----------------------------------------------------------------
    //  Internal
    // ----------------------------------------------------------------

    function _isHealthy(address user) internal view returns (bool) {
        return getCollateralValue(user) >= getBorrowValue(user);
    }
}
