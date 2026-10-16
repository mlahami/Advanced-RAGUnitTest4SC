// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IHypurrFiPool.sol";
import "./MockAToken.sol";

/**
 * @title MockHypurrFiPool
 * @notice Mock implementation of HypurrFi Pool for local testing
 * @dev Implements core lending/borrowing logic with simplified economics
 */
contract MockHypurrFiPool is IHypurrFiPool, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Constants for calculations
    uint256 private constant PRECISION = 1e18;
    uint256 private constant HEALTH_FACTOR_LIQUIDATION_THRESHOLD = 1e18; // HF < 1.0 = liquidation
    uint256 private constant MAX_UINT256 = type(uint256).max;

    // Reserve configuration per asset
    struct ReserveConfig {
        bool isActive;
        uint256 ltv; // Loan-to-value (e.g., 80% = 8000)
        uint256 liquidationThreshold; // e.g., 85% = 8500
        uint256 liquidationBonus; // e.g., 5% = 500
        address aTokenAddress;
        uint256 price; // Simple fixed price oracle (scaled by 1e8, like Chainlink)
    }

    // User position data
    struct UserReserveData {
        uint256 collateral; // Amount supplied (in aTokens)
        uint256 debt; // Amount borrowed
    }

    // Storage
    mapping(address => ReserveConfig) public reserves;
    mapping(address => mapping(address => UserReserveData)) public userReserves; // user => asset => data

    address[] public reservesList;

    // Events
    event Supply(
        address indexed reserve,
        address indexed user,
        address indexed onBehalfOf,
        uint256 amount
    );

    event Withdraw(
        address indexed reserve,
        address indexed user,
        address indexed to,
        uint256 amount
    );

    event Borrow(
        address indexed reserve,
        address indexed user,
        address indexed onBehalfOf,
        uint256 amount,
        uint256 interestRateMode
    );

    event Repay(
        address indexed reserve,
        address indexed user,
        address indexed onBehalfOf,
        uint256 amount
    );

    event ReserveInitialized(
        address indexed asset,
        address indexed aToken,
        uint256 ltv,
        uint256 liquidationThreshold,
        uint256 price
    );

    event PriceUpdated(address indexed asset, uint256 newPrice);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Initialize a reserve (asset) in the pool
     * @param asset Address of the underlying asset
     * @param aTokenName Name for the aToken
     * @param aTokenSymbol Symbol for the aToken
     * @param ltv Loan-to-value ratio (in basis points, e.g., 8000 = 80%)
     * @param liquidationThreshold Liquidation threshold (in basis points, e.g., 8500 = 85%)
     * @param liquidationBonus Liquidation bonus (in basis points, e.g., 500 = 5%)
     * @param initialPrice Initial price in USD (scaled by 1e8)
     */
    function initReserve(
        address asset,
        string memory aTokenName,
        string memory aTokenSymbol,
        uint256 ltv,
        uint256 liquidationThreshold,
        uint256 liquidationBonus,
        uint256 initialPrice
    ) external onlyOwner {
        require(!reserves[asset].isActive, "Reserve already initialized");
        require(ltv <= 10000, "LTV too high");
        require(liquidationThreshold <= 10000, "Liquidation threshold too high");
        require(liquidationThreshold >= ltv, "Liquidation threshold < LTV");

        // Deploy aToken
        MockAToken aToken = new MockAToken(
            aTokenName,
            aTokenSymbol,
            asset,
            address(this)
        );

        reserves[asset] = ReserveConfig({
            isActive: true,
            ltv: ltv,
            liquidationThreshold: liquidationThreshold,
            liquidationBonus: liquidationBonus,
            aTokenAddress: address(aToken),
            price: initialPrice
        });

        reservesList.push(asset);

        emit ReserveInitialized(asset, address(aToken), ltv, liquidationThreshold, initialPrice);
    }

    /**
     * @notice Update the price of an asset (simplified oracle)
     * @param asset Address of the asset
     * @param newPrice New price (scaled by 1e8)
     */
    function setAssetPrice(address asset, uint256 newPrice) external onlyOwner {
        require(reserves[asset].isActive, "Reserve not active");
        reserves[asset].price = newPrice;
        emit PriceUpdated(asset, newPrice);
    }

    /**
     * @notice Supply assets to the pool
     */
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /* referralCode */
    ) external override nonReentrant {
        require(reserves[asset].isActive, "Reserve not active");
        require(amount > 0, "Amount must be > 0");

        // Transfer tokens from user to pool
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        // Mint aTokens 1:1
        MockAToken aToken = MockAToken(reserves[asset].aTokenAddress);
        aToken.mint(onBehalfOf, amount);

        // Update user collateral
        userReserves[onBehalfOf][asset].collateral += amount;

        emit Supply(asset, msg.sender, onBehalfOf, amount);
    }

    /**
     * @notice Withdraw assets from the pool
     */
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external override nonReentrant returns (uint256) {
        require(reserves[asset].isActive, "Reserve not active");

        UserReserveData storage userData = userReserves[msg.sender][asset];

        // Handle max withdrawal
        uint256 amountToWithdraw = amount;
        if (amount == MAX_UINT256) {
            amountToWithdraw = userData.collateral;
        }

        require(amountToWithdraw > 0, "Amount must be > 0");
        require(userData.collateral >= amountToWithdraw, "Insufficient collateral");

        // Update collateral before checking health factor
        userData.collateral -= amountToWithdraw;

        // Check health factor after withdrawal
        (, , , , , uint256 healthFactor) = this.getUserAccountData(msg.sender);
        if (healthFactor > 0) {
            require(healthFactor >= HEALTH_FACTOR_LIQUIDATION_THRESHOLD, "Health factor too low");
        }

        // Burn aTokens
        MockAToken aToken = MockAToken(reserves[asset].aTokenAddress);
        aToken.burn(msg.sender, amountToWithdraw);

        // Transfer underlying to user
        IERC20(asset).safeTransfer(to, amountToWithdraw);

        emit Withdraw(asset, msg.sender, to, amountToWithdraw);

        return amountToWithdraw;
    }

    /**
     * @notice Borrow assets from the pool
     */
    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 /* referralCode */,
        address onBehalfOf
    ) external override nonReentrant {
        require(reserves[asset].isActive, "Reserve not active");
        require(amount > 0, "Amount must be > 0");
        require(interestRateMode == 1 || interestRateMode == 2, "Invalid interest rate mode");

        // Update debt
        userReserves[onBehalfOf][asset].debt += amount;

        // Check health factor after borrow
        (, , , , , uint256 healthFactor) = this.getUserAccountData(onBehalfOf);
        require(healthFactor >= HEALTH_FACTOR_LIQUIDATION_THRESHOLD, "Health factor too low");

        // Transfer borrowed tokens to user
        IERC20(asset).safeTransfer(msg.sender, amount);

        emit Borrow(asset, msg.sender, onBehalfOf, amount, interestRateMode);
    }

    /**
     * @notice Repay borrowed assets
     */
    function repay(
        address asset,
        uint256 amount,
        uint256 /* rateMode */,
        address onBehalfOf
    ) external override nonReentrant returns (uint256) {
        require(reserves[asset].isActive, "Reserve not active");

        UserReserveData storage userData = userReserves[onBehalfOf][asset];
        require(userData.debt > 0, "No debt to repay");

        // Handle max repayment
        uint256 amountToRepay = amount;
        if (amount == MAX_UINT256) {
            amountToRepay = userData.debt;
        } else {
            amountToRepay = amount > userData.debt ? userData.debt : amount;
        }

        // Transfer tokens from user to pool
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amountToRepay);

        // Update debt
        userData.debt -= amountToRepay;

        emit Repay(asset, msg.sender, onBehalfOf, amountToRepay);

        return amountToRepay;
    }

    /**
     * @notice Get user account data across all reserves
     */
    function getUserAccountData(address user)
        external
        view
        override
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        )
    {
        uint256 totalCollateralInUSD = 0;
        uint256 totalDebtInUSD = 0;
        uint256 weightedLiquidationThreshold = 0;
        uint256 weightedLTV = 0;

        // Iterate through all reserves
        for (uint256 i = 0; i < reservesList.length; i++) {
            address asset = reservesList[i];
            UserReserveData memory userData = userReserves[user][asset];
            ReserveConfig memory config = reserves[asset];

            if (userData.collateral > 0) {
                // Calculate collateral value in USD
                uint256 collateralValueUSD = (userData.collateral * config.price) / 1e8;
                totalCollateralInUSD += collateralValueUSD;

                // Weight the liquidation threshold and LTV by collateral value
                weightedLiquidationThreshold += collateralValueUSD * config.liquidationThreshold;
                weightedLTV += collateralValueUSD * config.ltv;
            }

            if (userData.debt > 0) {
                // Calculate debt value in USD
                uint256 debtValueUSD = (userData.debt * config.price) / 1e8;
                totalDebtInUSD += debtValueUSD;
            }
        }

        // Calculate weighted averages
        if (totalCollateralInUSD > 0) {
            currentLiquidationThreshold = weightedLiquidationThreshold / totalCollateralInUSD;
            ltv = weightedLTV / totalCollateralInUSD;
        }

        // Calculate available borrows (in USD)
        if (totalCollateralInUSD > 0 && ltv > 0) {
            uint256 maxBorrowCapacity = (totalCollateralInUSD * ltv) / 10000;
            if (maxBorrowCapacity > totalDebtInUSD) {
                availableBorrowsBase = maxBorrowCapacity - totalDebtInUSD;
            }
        }

        // Calculate health factor
        if (totalDebtInUSD > 0) {
            // HF = (collateral * liquidationThreshold) / debt
            healthFactor = (totalCollateralInUSD * currentLiquidationThreshold * PRECISION) /
                           (totalDebtInUSD * 10000);
        } else if (totalCollateralInUSD > 0) {
            // No debt = max health factor
            healthFactor = MAX_UINT256;
        } else {
            // No collateral, no debt = neutral
            healthFactor = 0;
        }

        return (
            totalCollateralInUSD,
            totalDebtInUSD,
            availableBorrowsBase,
            currentLiquidationThreshold,
            ltv,
            healthFactor
        );
    }

    /**
     * @notice Supply with permit (not implemented in mock)
     */
    function supplyWithPermit(
        address /* asset */,
        uint256 /* amount */,
        address /* onBehalfOf */,
        uint16 /* referralCode */,
        uint256 /* deadline */,
        uint8 /* permitV */,
        bytes32 /* permitR */,
        bytes32 /* permitS */
    ) external pure override {
        revert("Not implemented in mock");
    }

    /**
     * @notice Repay with aTokens (not implemented in mock)
     */
    function repayWithATokens(
        address /* asset */,
        uint256 /* amount */,
        uint256 /* interestRateMode */
    ) external pure override returns (uint256) {
        revert("Not implemented in mock");
    }

    /**
     * @notice Repay with permit (not implemented in mock)
     */
    function repayWithPermit(
        address /* asset */,
        uint256 /* amount */,
        uint256 /* interestRateMode */,
        address /* onBehalfOf */,
        uint256 /* deadline */,
        uint8 /* permitV */,
        bytes32 /* permitR */,
        bytes32 /* permitS */
    ) external pure override returns (uint256) {
        revert("Not implemented in mock");
    }

    /**
     * @notice Swap borrow rate mode (not implemented in mock)
     */
    function swapBorrowRateMode(address /* asset */, uint256 /* interestRateMode */)
        external
        pure
        override
    {
        revert("Not implemented in mock");
    }

    /**
     * @notice Set user use reserve as collateral (not implemented in mock)
     */
    function setUserUseReserveAsCollateral(address /* asset */, bool /* useAsCollateral */)
        external
        pure
        override
    {
        revert("Not implemented in mock");
    }

    /**
     * @notice Liquidation call (not implemented in mock)
     */
    function liquidationCall(
        address /* collateralAsset */,
        address /* debtAsset */,
        address /* user */,
        uint256 /* debtToCover */,
        bool /* receiveAToken */
    ) external pure override {
        revert("Not implemented in mock");
    }

    /**
     * @notice Flash loan (not implemented in mock)
     */
    function flashLoan(
        address /* receiverAddress */,
        address[] calldata /* assets */,
        uint256[] calldata /* amounts */,
        uint256[] calldata /* interestRateModes */,
        address /* onBehalfOf */,
        bytes calldata /* params */,
        uint16 /* referralCode */
    ) external pure override {
        revert("Not implemented in mock");
    }

    /**
     * @notice Get the aToken address for a reserve
     */
    function getReserveAToken(address asset) external view returns (address) {
        return reserves[asset].aTokenAddress;
    }

    /**
     * @notice Get user reserve data for a specific asset
     */
    function getUserReserveData(address user, address asset)
        external
        view
        returns (uint256 collateral, uint256 debt)
    {
        UserReserveData memory userData = userReserves[user][asset];
        return (userData.collateral, userData.debt);
    }

    /**
     * @notice Get reserve configuration
     */
    function getReserveConfiguration(address asset)
        external
        view
        returns (
            bool isActive,
            uint256 ltv,
            uint256 liquidationThreshold,
            uint256 liquidationBonus,
            address aTokenAddress,
            uint256 price
        )
    {
        ReserveConfig memory config = reserves[asset];
        return (
            config.isActive,
            config.ltv,
            config.liquidationThreshold,
            config.liquidationBonus,
            config.aTokenAddress,
            config.price
        );
    }

    /**
     * @notice Get the number of reserves
     */
    function getReservesCount() external view returns (uint256) {
        return reservesList.length;
    }

    /**
     * @notice Get reserve address by index
     */
    function getReserveAddressById(uint256 id) external view returns (address) {
        require(id < reservesList.length, "Invalid reserve id");
        return reservesList[id];
    }
}
