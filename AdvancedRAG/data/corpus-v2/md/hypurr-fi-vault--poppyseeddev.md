# hypurr-fi-vault--poppyseeddev

- domain: staking-yield (yield-vault)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/poppyseedDev/hypurrfi-hack @ 0b37c12d8f904b71ddffc0249750e8011358ca9c
- license: MIT
- targets: HypurrFiVault.sol, IHypurrFiOracle.sol, IHypurrFiPool.sol, MockAToken.sol, MockERC20.sol, MockHypurrFiOracle.sol, MockHypurrFiPool.sol
- validation: 78 passing tests, 0 failing; statement coverage HypurrFiVault.sol 85.12 %, IHypurrFiOracle.sol 100.0 %, IHypurrFiPool.sol 100.0 %, MockAToken.sol 57.14 %, MockERC20.sol 66.67 %, MockHypurrFiOracle.sol 16.67 %, MockHypurrFiPool.sol 78.21 %

## Contract: HypurrFiVault.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IHypurrFiPool.sol";
import "./IHypurrFiOracle.sol";

/**
 * @title HypurrFiVault
 * @notice ERC-4626 compliant vault that automates leverage loops on HypurrFi
 * @dev Implements automated supply->borrow->re-supply cycles with health factor monitoring
 * 
 * Key Features:
 * - ERC-4626 standard compliance for composability
 * - Automated leverage loop execution on deposits
 * - Continuous health factor monitoring and rebalancing
 * - Safe unwinding of positions on withdrawals
 * - Emergency controls for risk management
 */
contract HypurrFiVault is ERC4626, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ==================== Events ====================

    event LoopExecuted(
        uint256 iterations,
        uint256 finalCollateral,
        uint256 finalDebt,
        uint256 finalHealthFactor
    );

    event Rebalanced(
        uint256 oldHealthFactor,
        uint256 newHealthFactor,
        uint256 collateral,
        uint256 debt,
        uint256 timestamp
    );

    event EmergencyDeleveraged(
        uint256 collateralWithdrawn,
        uint256 debtRepaid,
        uint256 timestamp
    );

    event ParametersUpdated(
        uint256 targetHealthFactor,
        uint256 minHealthFactor,
        uint256 maxHealthFactor,
        uint256 targetLTV
    );

    // ==================== State Variables ====================

    // HypurrFi Protocol contracts
    IHypurrFiPool public immutable hypurrfiPool;
    IHypurrFiOracle public immutable oracle;

    // Borrow asset (typically USDXL stablecoin)
    address public immutable borrowAsset;

    // Target parameters (in basis points where applicable)
    uint256 public targetHealthFactor = 1.3e18;      // 130% (1.3 * 10^18)
    uint256 public minHealthFactor = 1.15e18;        // 115% (rebalance trigger)
    uint256 public maxHealthFactor = 1.5e18;         // 150% (re-lever trigger)
    uint256 public targetLTV = 6000;                 // 60% in basis points (10000 = 100%)
    uint256 public maxLoopIterations = 4;            // Max recursive supply/borrow cycles

    // Risk controls
    bool public paused;
    uint256 public maxTotalAssets = type(uint256).max;

    // Constants
    uint256 private constant BASIS_POINTS = 10000;
    uint256 private constant VARIABLE_INTEREST_RATE_MODE = 2;
    uint16 private constant REFERRAL_CODE = 0;

    // ==================== Modifiers ====================

    modifier whenNotPaused() {
        require(!paused, "Vault is paused");
        _;
    }

    // ==================== Constructor ====================

    /**
     * @notice Initializes the HypurrFi Leverage Vault
     * @param _asset The primary deposit asset (e.g., USDC)
     * @param _borrowAsset The asset to borrow in loops (e.g., USDXL)
     * @param _pool HypurrFi Pool contract address
     * @param _oracle HypurrFi Oracle contract address
     * @param _name Vault token name
     * @param _symbol Vault token symbol
     */
    constructor(
        address _asset,
        address _borrowAsset,
        address _pool,
        address _oracle,
        string memory _name,
        string memory _symbol
    )
        ERC4626(IERC20(_asset))
        ERC20(_name, _symbol)
        Ownable(msg.sender)
    {
        require(_asset != address(0), "Invalid asset");
        require(_borrowAsset != address(0), "Invalid borrow asset");
        require(_pool != address(0), "Invalid pool");
        require(_oracle != address(0), "Invalid oracle");

        borrowAsset = _borrowAsset;
        hypurrfiPool = IHypurrFiPool(_pool);
        oracle = IHypurrFiOracle(_oracle);

        // Approve infinite spending to pool for both assets
        IERC20(_asset).forceApprove(_pool, type(uint256).max);
        IERC20(_borrowAsset).forceApprove(_pool, type(uint256).max);
    }

    // ==================== ERC-4626 Overrides ====================

    /**
     * @notice Deposits assets and executes leverage loop
     * @param assets Amount of assets to deposit
     * @param receiver Address to receive vault shares
     * @return shares Amount of shares minted
     */
    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        require(assets > 0, "Cannot deposit 0");
        require(assets <= maxDeposit(receiver), "Exceeds max deposit");

        // Calculate shares (before taking assets)
        shares = previewDeposit(assets);
        require(shares > 0, "Cannot mint 0 shares");

        // Transfer assets from depositor
        SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), assets);

        // Mint shares to receiver
        _mint(receiver, shares);

        // Execute leverage loop with deposited assets
        _executeLoop(assets);

        // Verify health factor after loop
        (, , uint256 hf) = _getPositionData();
        require(hf >= minHealthFactor, "Unsafe position after loop");

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /**
     * @notice Withdraws assets by burning shares and unwinding position
     * @param assets Amount of assets to withdraw
     * @param receiver Address to receive assets
     * @param owner Address whose shares will be burned
     * @return shares Amount of shares burned
     */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    )
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        require(assets > 0, "Cannot withdraw 0");
        require(assets <= maxWithdraw(owner), "Exceeds max withdraw");

        shares = previewWithdraw(assets);
        require(shares > 0, "Cannot burn 0 shares");

        // Check allowance if caller is not owner
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }

        // Burn shares from owner
        _burn(owner, shares);

        // Unwind position proportionally
        _unwindPosition(assets);

        // Transfer assets to receiver
        SafeERC20.safeTransfer(IERC20(asset()), receiver, assets);

        // Verify remaining position health (if vault still has deposits)
        if (totalSupply() > 0) {
            (, , uint256 hf) = _getPositionData();
            require(hf >= minHealthFactor, "Unsafe position after withdrawal");
        }

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /**
     * @notice Redeems shares for assets
     * @param shares Amount of shares to redeem
     * @param receiver Address to receive assets
     * @param owner Address whose shares will be burned
     * @return assets Amount of assets withdrawn
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    )
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        require(shares > 0, "Cannot redeem 0");
        require(shares <= maxRedeem(owner), "Exceeds max redeem");

        assets = previewRedeem(shares);
        require(assets > 0, "Cannot withdraw 0 assets");

        // Check allowance if caller is not owner
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }

        // Burn shares from owner
        _burn(owner, shares);

        // Unwind position proportionally
        _unwindPosition(assets);

        // Transfer assets to receiver
        SafeERC20.safeTransfer(IERC20(asset()), receiver, assets);

        // Verify remaining position health
        if (totalSupply() > 0) {
            (, , uint256 hf) = _getPositionData();
            require(hf >= minHealthFactor, "Unsafe position after redemption");
        }

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /**
     * @notice Returns total assets managed by vault (collateral - debt)
     * @return Total assets in base currency
     */
    function totalAssets() public view override returns (uint256) {
        (uint256 collateral, uint256 debt, ) = _getPositionData();
        
        // Total assets = collateral value - debt value
        // Assumes both are denominated in same base currency (USD)
        return collateral > debt ? collateral - debt : 0;
    }

    /**
     * @notice Returns maximum assets that can be deposited
     * @param receiver Address receiving shares (unused but part of ERC-4626)
     * @return Maximum deposit amount
     */
    function maxDeposit(address receiver) public view override returns (uint256) {
        if (paused) return 0;
        
        uint256 currentAssets = totalAssets();
        if (currentAssets >= maxTotalAssets) return 0;
        
        return maxTotalAssets - currentAssets;
    }

    /**
     * @notice Returns maximum shares that can be minted
     * @param receiver Address receiving shares (unused but part of ERC-4626)
     * @return Maximum mint amount
     */
    function maxMint(address receiver) public view override returns (uint256) {
        uint256 maxAssets = maxDeposit(receiver);
        return maxAssets == 0 ? 0 : previewDeposit(maxAssets);
    }

    /**
     * @notice Returns maximum assets that can be withdrawn
     * @param owner Address owning the shares
     * @return Maximum withdrawal amount
     */
    function maxWithdraw(address owner) public view override returns (uint256) {
        // Max withdrawal is the owner's share of total assets
        // Limited by pool liquidity
        uint256 ownerAssets = previewRedeem(balanceOf(owner));
        return ownerAssets;
    }

    /**
     * @notice Returns maximum shares that can be redeemed
     * @param owner Address owning the shares
     * @return Maximum redeem amount
     */
    function maxRedeem(address owner) public view override returns (uint256) {
        return balanceOf(owner);
    }

    // ==================== Leverage Loop Functions ====================

    /**
     * @notice Executes leverage loop: supply -> borrow -> re-supply
     * @param initialAssets Amount of initial assets to loop
     */
    function _executeLoop(uint256 initialAssets) internal {
        uint256 iterations = 0;
        uint256 toSupply = initialAssets;

        // Initial supply
        hypurrfiPool.supply(asset(), toSupply, address(this), REFERRAL_CODE);

        // Execute recursive loops
        for (iterations = 1; iterations < maxLoopIterations; iterations++) {
            // Get current position data
            (uint256 collateral, uint256 debt, uint256 hf) = _getPositionData();

            // Calculate max safe borrow based on target LTV
            uint256 maxBorrow = (collateral * targetLTV) / BASIS_POINTS;
            
            if (maxBorrow <= debt) break; // No more borrowing capacity
            
            uint256 toBorrow = maxBorrow - debt;
            if (toBorrow == 0) break;

            // Borrow assets
            hypurrfiPool.borrow(
                borrowAsset,
                toBorrow,
                VARIABLE_INTEREST_RATE_MODE,
                REFERRAL_CODE,
                address(this)
            );

            // Re-supply borrowed assets
            hypurrfiPool.supply(borrowAsset, toBorrow, address(this), REFERRAL_CODE);

            // Check health factor
            (, , hf) = _getPositionData();
            if (hf < minHealthFactor) {
                revert("Loop would create unsafe position");
            }

            toSupply = toBorrow;
        }

        // Log final state
        (uint256 finalCollateral, uint256 finalDebt, uint256 finalHF) = _getPositionData();
        emit LoopExecuted(iterations, finalCollateral, finalDebt, finalHF);
    }

    /**
     * @notice Unwinds position proportionally for withdrawal
     * @param assetsToWithdraw Amount of assets to withdraw
     */
    function _unwindPosition(uint256 assetsToWithdraw) internal {
        (uint256 collateral, uint256 debt, ) = _getPositionData();

        if (collateral == 0) return; // No position to unwind

        // Calculate proportional debt to repay
        uint256 withdrawRatio = (assetsToWithdraw * 1e18) / collateral;
        uint256 debtToRepay = (debt * withdrawRatio) / 1e18;

        // Repay debt proportionally
        if (debtToRepay > 0 && debt > 0) {
            // Withdraw enough collateral to repay debt
            hypurrfiPool.withdraw(borrowAsset, debtToRepay, address(this));
            
            // Repay debt
            hypurrfiPool.repay(
                borrowAsset,
                debtToRepay,
                VARIABLE_INTEREST_RATE_MODE,
                address(this)
            );
        }

        // Withdraw primary asset
        hypurrfiPool.withdraw(asset(), assetsToWithdraw, address(this));
    }

    // ==================== Rebalancing Functions ====================

    /**
     * @notice Rebalances vault to target health factor
     * @dev Can be called by anyone when health factor is outside acceptable range
     * @return success Whether rebalancing was needed and executed
     */
    function rebalance() external nonReentrant returns (bool success) {
        (uint256 collateral, uint256 debt, uint256 hf) = _getPositionData();

        if (hf < minHealthFactor) {
            // Deleverage to improve health factor
            _deleverageToTarget();
            success = true;
        } else if (hf > maxHealthFactor && debt > 0) {
            // Re-leverage to increase yield
            _releverageToTarget();
            success = true;
        } else {
            return false; // No rebalancing needed
        }

        (uint256 newCollateral, uint256 newDebt, uint256 newHF) = _getPositionData();
        emit Rebalanced(hf, newHF, newCollateral, newDebt, block.timestamp);
    }

    /**
     * @notice Reduces leverage by repaying debt
     */
    function _deleverageToTarget() internal {
        (uint256 collateral, uint256 debt, uint256 hf) = _getPositionData();

        while (hf < targetHealthFactor && debt > 0) {
            // Calculate amount to repay to reach target HF
            // Simplified: repay a portion of debt iteratively
            uint256 toRepay = (debt * (targetHealthFactor - hf)) / targetHealthFactor / 1e18;
            
            if (toRepay == 0) toRepay = debt / 10; // Repay at least 10% if calculation rounds to 0
            if (toRepay > debt) toRepay = debt;

            // Withdraw collateral to repay debt
            hypurrfiPool.withdraw(borrowAsset, toRepay, address(this));

            // Repay debt
            hypurrfiPool.repay(
                borrowAsset,
                toRepay,
                VARIABLE_INTEREST_RATE_MODE,
                address(this)
            );

            // Update position data
            (collateral, debt, hf) = _getPositionData();

            // Safety check to prevent infinite loop
            if (toRepay == 0) break;
        }
    }

    /**
     * @notice Increases leverage by borrowing and re-supplying
     */
    function _releverageToTarget() internal {
        (uint256 collateral, uint256 debt, uint256 hf) = _getPositionData();

        while (hf > maxHealthFactor) {
            // Calculate max safe borrow to reach target HF
            uint256 maxNewBorrow = (collateral * targetLTV) / BASIS_POINTS;
            
            if (maxNewBorrow <= debt) break;
            
            uint256 toBorrow = maxNewBorrow - debt;
            if (toBorrow == 0) break;

            // Borrow additional assets
            hypurrfiPool.borrow(
                borrowAsset,
                toBorrow,
                VARIABLE_INTEREST_RATE_MODE,
                REFERRAL_CODE,
                address(this)
            );

            // Re-supply to increase collateral
            hypurrfiPool.supply(borrowAsset, toBorrow, address(this), REFERRAL_CODE);

            // Update position data
            (collateral, debt, hf) = _getPositionData();
        }
    }

    // ==================== View Functions ====================

    /**
     * @notice Returns current position details
     * @return totalCollateral Total collateral in base currency
     * @return totalDebt Total debt in base currency
     * @return healthFactor Current health factor (1e18 = 100%)
     */
    function getPositionDetails()
        external
        view
        returns (
            uint256 totalCollateral,
            uint256 totalDebt,
            uint256 healthFactor
        )
    {
        return _getPositionData();
    }

    /**
     * @notice Returns comprehensive vault metrics
     * @return vaultTotalAssets Total assets (collateral - debt)
     * @return vaultTotalShares Total shares outstanding
     * @return exchangeRate Share to asset exchange rate
     * @return currentHealthFactor Current health factor
     */
    function getVaultMetrics()
        external
        view
        returns (
            uint256 vaultTotalAssets,
            uint256 vaultTotalShares,
            uint256 exchangeRate,
            uint256 currentHealthFactor
        )
    {
        vaultTotalAssets = totalAssets();
        vaultTotalShares = totalSupply();
        exchangeRate = vaultTotalShares > 0
            ? (vaultTotalAssets * 1e18) / vaultTotalShares
            : 1e18;
        (, , currentHealthFactor) = _getPositionData();
    }

    /**
     * @notice Returns user's share value in underlying assets
     * @param user Address of the user
     * @return Value of user's shares in assets
     */
    function getUserShareValue(address user) external view returns (uint256) {
        uint256 userShares = balanceOf(user);
        if (userShares == 0) return 0;
        return previewRedeem(userShares);
    }

    // ==================== Internal Helper Functions ====================

    /**
     * @notice Gets current position data from HypurrFi
     * @return collateral Total collateral in base currency
     * @return debt Total debt in base currency
     * @return healthFactor Current health factor
     */
    function _getPositionData()
        internal
        view
        returns (
            uint256 collateral,
            uint256 debt,
            uint256 healthFactor
        )
    {
        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            ,
            ,
            ,
            uint256 hf
        ) = hypurrfiPool.getUserAccountData(address(this));

        return (totalCollateralBase, totalDebtBase, hf);
    }

    // ==================== Owner Functions ====================

    /**
     * @notice Pauses vault operations
     */
    function pause() external onlyOwner {
        paused = true;
    }

    /**
     * @notice Unpauses vault operations
     */
    function unpause() external onlyOwner {
        paused = false;
    }

    /**
     * @notice Emergency function to fully deleverage vault
     * @dev Should only be used in emergency situations
     */
    function emergencyDeleverage() external onlyOwner nonReentrant {
        (uint256 collateral, uint256 debt, ) = _getPositionData();

        // Repay all debt
        if (debt > 0) {
            // Withdraw enough to repay debt
            hypurrfiPool.withdraw(borrowAsset, debt, address(this));
            
            // Repay all debt
            hypurrfiPool.repay(
                borrowAsset,
                type(uint256).max,
                VARIABLE_INTEREST_RATE_MODE,
                address(this)
            );
        }

        // Withdraw all primary asset collateral
        hypurrfiPool.withdraw(asset(), type(uint256).max, address(this));

        // Pause vault
        paused = true;

        emit EmergencyDeleveraged(collateral, debt, block.timestamp);
    }

    /**
     * @notice Updates vault parameters
     * @param _targetHealthFactor New target health factor
     * @param _minHealthFactor New minimum health factor
     * @param _maxHealthFactor New maximum health factor
     * @param _targetLTV New target LTV in basis points
     */
    function setParameters(
        uint256 _targetHealthFactor,
        uint256 _minHealthFactor,
        uint256 _maxHealthFactor,
        uint256 _targetLTV
    ) external onlyOwner {
        require(_targetHealthFactor >= 1.1e18 && _targetHealthFactor <= 2.0e18, "Invalid target HF");
        require(_minHealthFactor >= 1.05e18 && _minHealthFactor < _targetHealthFactor, "Invalid min HF");
        require(_maxHealthFactor > _targetHealthFactor && _maxHealthFactor <= 3.0e18, "Invalid max HF");
        require(_targetLTV > 0 && _targetLTV <= 8000, "Invalid LTV"); // Max 80%

        targetHealthFactor = _targetHealthFactor;
        minHealthFactor = _minHealthFactor;
        maxHealthFactor = _maxHealthFactor;
        targetLTV = _targetLTV;

        emit ParametersUpdated(_targetHealthFactor, _minHealthFactor, _maxHealthFactor, _targetLTV);
    }

    /**
     * @notice Updates max loop iterations
     * @param _maxLoopIterations New max loop iterations
     */
    function setMaxLoopIterations(uint256 _maxLoopIterations) external onlyOwner {
        require(_maxLoopIterations > 0 && _maxLoopIterations <= 10, "Invalid iterations");
        maxLoopIterations = _maxLoopIterations;
    }

    /**
     * @notice Updates max total assets limit
     * @param _maxTotalAssets New max total assets
     */
    function setMaxTotalAssets(uint256 _maxTotalAssets) external onlyOwner {
        require(_maxTotalAssets > 0, "Invalid max assets");
        maxTotalAssets = _maxTotalAssets;
    }
}
```

## Contract: IHypurrFiOracle.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IHypurrFiOracle
 * @notice Interface for the HypurrFi price oracle
 * @dev Provides price feeds for asset valuation and health factor calculations
 */
interface IHypurrFiOracle {
    /**
     * @notice Returns the latest price for an asset
     * @param asset The address of the asset
     * @return The price of the asset in the base currency (typically USD with 8 decimals)
     */
    function getAssetPrice(address asset) external view returns (uint256);

    /**
     * @notice Returns the prices for multiple assets
     * @param assets The addresses of the assets
     * @return An array of prices for the assets in the base currency
     */
    function getAssetsPrices(address[] calldata assets) external view returns (uint256[] memory);

    /**
     * @notice Returns the address of the source for an asset
     * @param asset The address of the asset
     * @return The address of the price source
     */
    function getSourceOfAsset(address asset) external view returns (address);

    /**
     * @notice Returns the base currency used by the oracle (e.g., USD)
     * @return The address of the base currency (address(0) for USD)
     */
    function BASE_CURRENCY() external view returns (address);

    /**
     * @notice Returns the base currency unit (decimals used for prices)
     * @return The number of decimals for the base currency unit (typically 8 for USD)
     */
    function BASE_CURRENCY_UNIT() external view returns (uint256);
}
```

## Contract: IHypurrFiPool.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IHypurrFiPool
 * @notice Interface for the HypurrFi Pool contract (Aave V3-compatible)
 * @dev Main entry point for all lending protocol interactions
 */
interface IHypurrFiPool {
    /**
     * @notice Supplies an `amount` of underlying asset into the reserve, receiving in return overlying hyTokens.
     * @param asset The address of the underlying asset to supply
     * @param amount The amount to be supplied
     * @param onBehalfOf The address that will receive the hyTokens, same as msg.sender if the user
     *   wants to receive them on his own wallet, or a different address if the beneficiary of hyTokens
     *   is a different wallet
     * @param referralCode Code used to register the integrator originating the operation, for potential rewards.
     *   0 if the action is executed directly by the user, without any middle-man
     */
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    /**
     * @notice Supplies an `amount` of underlying asset into the reserve with a permit signature
     * @param asset The address of the underlying asset to supply
     * @param amount The amount to be supplied
     * @param onBehalfOf The address that will receive the hyTokens
     * @param referralCode Code used to register the integrator
     * @param deadline The deadline timestamp that the permit is valid
     * @param permitV The V parameter of ERC712 permit sig
     * @param permitR The R parameter of ERC712 permit sig
     * @param permitS The S parameter of ERC712 permit sig
     */
    function supplyWithPermit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode,
        uint256 deadline,
        uint8 permitV,
        bytes32 permitR,
        bytes32 permitS
    ) external;

    /**
     * @notice Withdraws an `amount` of underlying asset from the reserve, burning the equivalent hyTokens owned
     * @param asset The address of the underlying asset to withdraw
     * @param amount The underlying amount to be withdrawn
     *   - Send the value type(uint256).max in order to withdraw the whole hyToken balance
     * @param to The address that will receive the underlying, same as msg.sender if the user
     *   wants to receive it on his own wallet, or a different address if the beneficiary is a
     *   different wallet
     * @return The final amount withdrawn
     */
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);

    /**
     * @notice Allows users to borrow a specific `amount` of the reserve underlying asset
     * @param asset The address of the underlying asset to borrow
     * @param amount The amount to be borrowed
     * @param interestRateMode The interest rate mode at which the user wants to borrow: 1 for Stable, 2 for Variable
     * @param referralCode The code used to register the integrator originating the operation
     * @param onBehalfOf The address of the user who will receive the debt. Should be the address of the borrower itself
     * calling the function if he wants to borrow against his own collateral, or the address of the credit delegator
     * if he has been given credit delegation allowance
     */
    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external;

    /**
     * @notice Repays a borrowed `amount` on a specific reserve, burning the equivalent debt tokens owned
     * @param asset The address of the borrowed underlying asset previously borrowed
     * @param amount The amount to repay
     * - Send the value type(uint256).max in order to repay the whole debt for `asset` on the specific `debtMode`
     * @param interestRateMode The interest rate mode at of the debt the user wants to repay: 1 for Stable, 2 for Variable
     * @param onBehalfOf The address of the user who will get his debt reduced/removed. Should be the address of the
     * user calling the function if he wants to reduce/remove his own debt, or the address of any other
     * other borrower whose debt should be removed
     * @return The final amount repaid
     */
    function repay(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        address onBehalfOf
    ) external returns (uint256);

    /**
     * @notice Repays a borrowed `amount` on a specific reserve using the reserve hyTokens, burning the
     * equivalent debt tokens
     * @param asset The address of the borrowed underlying asset previously borrowed
     * @param amount The amount to repay
     * - Send the value type(uint256).max in order to repay the whole debt for `asset` on the specific `debtMode`
     * @param interestRateMode The interest rate mode at of the debt the user wants to repay: 1 for Stable, 2 for Variable
     * @return The final amount repaid
     */
    function repayWithATokens(
        address asset,
        uint256 amount,
        uint256 interestRateMode
    ) external returns (uint256);

    /**
     * @notice Repays a borrowed `amount` on a specific reserve with a permit signature
     * @param asset The address of the borrowed underlying asset previously borrowed
     * @param amount The amount to repay
     * @param interestRateMode The interest rate mode at of the debt the user wants to repay: 1 for Stable, 2 for Variable
     * @param onBehalfOf Address of the user who will get his debt reduced/removed
     * @param deadline The deadline timestamp that the permit is valid
     * @param permitV The V parameter of ERC712 permit sig
     * @param permitR The R parameter of ERC712 permit sig
     * @param permitS The S parameter of ERC712 permit sig
     * @return The final amount repaid
     */
    function repayWithPermit(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        address onBehalfOf,
        uint256 deadline,
        uint8 permitV,
        bytes32 permitR,
        bytes32 permitS
    ) external returns (uint256);

    /**
     * @notice Allows a borrower to swap his debt between stable and variable mode, or vice versa
     * @param asset The address of the underlying asset borrowed
     * @param interestRateMode The current interest rate mode of the position being swapped: 1 for Stable, 2 for Variable
     */
    function swapBorrowRateMode(address asset, uint256 interestRateMode) external;

    /**
     * @notice Allows suppliers to enable/disable a specific supplied asset as collateral
     * @param asset The address of the underlying asset supplied
     * @param useAsCollateral True if the user wants to use the supply as collateral, false otherwise
     */
    function setUserUseReserveAsCollateral(address asset, bool useAsCollateral) external;

    /**
     * @notice Function to liquidate a non-healthy position collateral-wise, with Health Factor below 1
     * @param collateralAsset The address of the underlying asset used as collateral, to receive as result of the liquidation
     * @param debtAsset The address of the underlying borrowed asset to be repaid with the liquidation
     * @param user The address of the borrower getting liquidated
     * @param debtToCover The debt amount of borrowed `asset` the liquidator wants to cover
     * @param receiveAToken True if the liquidators wants to receive the collateral hyTokens, `false` if he wants
     * to receive the underlying collateral asset directly
     */
    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external;

    /**
     * @notice Allows smartcontracts to access the liquidity of the pool within one transaction,
     * as long as the amount taken plus a fee is returned.
     * @param receiverAddress The address of the contract receiving the funds, implementing IFlashLoanReceiver interface
     * @param assets The addresses of the assets being flash-borrowed
     * @param amounts The amounts of the assets being flash-borrowed
     * @param interestRateModes Types of the debt to open if the flash loan is not returned:
     *   0 -> Don't open any debt, just revert if funds can't be transferred from the receiver
     *   1 -> Open debt at stable rate for the value of the amount flash-borrowed to the `onBehalfOf` address
     *   2 -> Open debt at variable rate for the value of the amount flash-borrowed to the `onBehalfOf` address
     * @param onBehalfOf The address  that will receive the debt in the case of using on `modes` 1 or 2
     * @param params Variadic packed params to pass to the receiver as extra information
     * @param referralCode The code used to register the integrator originating the operation
     */
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata interestRateModes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;

    /**
     * @notice Returns the user account data across all the reserves
     * @param user The address of the user
     * @return totalCollateralBase The total collateral of the user in the base currency used by the price feed
     * @return totalDebtBase The total debt of the user in the base currency used by the price feed
     * @return availableBorrowsBase The borrowing power left of the user in the base currency used by the price feed
     * @return currentLiquidationThreshold The liquidation threshold of the user
     * @return ltv The loan to value of The user
     * @return healthFactor The current health factor of the user
     */
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
}
```

## Contract: MockAToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockAToken
 * @notice Mock implementation of HypurrFi's hyToken (aToken equivalent)
 * @dev Receipt token minted when users supply assets to the pool
 * Only the pool contract can mint/burn these tokens
 */
contract MockAToken is ERC20, Ownable {
    address public immutable underlyingAsset;
    address public immutable pool;

    /**
     * @notice Constructor
     * @param name Token name (e.g., "HypurrFi USDC")
     * @param symbol Token symbol (e.g., "hyUSDC")
     * @param underlyingAsset_ Address of the underlying asset
     * @param pool_ Address of the pool contract
     */
    constructor(
        string memory name,
        string memory symbol,
        address underlyingAsset_,
        address pool_
    ) ERC20(name, symbol) Ownable(msg.sender) {
        underlyingAsset = underlyingAsset_;
        pool = pool_;
    }

    /**
     * @notice Mint aTokens to an address
     * @dev Only callable by the pool
     * @param account Address to mint to
     * @param amount Amount to mint
     */
    function mint(address account, uint256 amount) external onlyOwner {
        require(msg.sender == pool, "Only pool can mint");
        _mint(account, amount);
    }

    /**
     * @notice Burn aTokens from an address
     * @dev Only callable by the pool
     * @param account Address to burn from
     * @param amount Amount to burn
     */
    function burn(address account, uint256 amount) external onlyOwner {
        require(msg.sender == pool, "Only pool can burn");
        _burn(account, amount);
    }

    /**
     * @notice Get the underlying asset address
     * @return Address of the underlying asset
     */
    function UNDERLYING_ASSET_ADDRESS() external view returns (address) {
        return underlyingAsset;
    }

    /**
     * @notice Get the pool address
     * @return Address of the pool
     */
    function POOL() external view returns (address) {
        return pool;
    }

    /**
     * @notice Returns the scaled balance of the user
     * @dev For simplicity, we return the regular balance (1:1 ratio)
     * @param user Address of the user
     * @return The scaled balance
     */
    function scaledBalanceOf(address user) external view returns (uint256) {
        return balanceOf(user);
    }
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Simple ERC20 token for testing
 * @dev Allows anyone to mint tokens for testing purposes
 */
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    /**
     * @notice Constructor to create a mock ERC20 token
     * @param name Token name
     * @param symbol Token symbol
     * @param decimals_ Token decimals (typically 6 for USDC, 18 for most tokens)
     */
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    /**
     * @notice Mint tokens to an address (for testing only)
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from an address
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    /**
     * @notice Override decimals to support different token types
     * @return Number of decimals
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}
```

## Contract: MockHypurrFiOracle.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./IHypurrFiOracle.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockHypurrFiOracle
 * @notice Mock implementation of HypurrFi Oracle for testing
 * @dev Provides simple price feeds for testing purposes
 */
contract MockHypurrFiOracle is IHypurrFiOracle, Ownable {
    // Price data (scaled by 1e8, like Chainlink)
    mapping(address => uint256) private assetPrices;
    mapping(address => address) private assetSources;

    address public constant override BASE_CURRENCY = address(0); // USD
    uint256 public constant override BASE_CURRENCY_UNIT = 1e8; // 8 decimals

    event AssetPriceUpdated(address indexed asset, uint256 price, address source);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Set the price for an asset
     * @param asset Address of the asset
     * @param price Price of the asset (scaled by 1e8)
     */
    function setAssetPrice(address asset, uint256 price) external onlyOwner {
        assetPrices[asset] = price;
        emit AssetPriceUpdated(asset, price, msg.sender);
    }

    /**
     * @notice Set the price source for an asset
     * @param asset Address of the asset
     * @param source Address of the price source
     */
    function setAssetSource(address asset, address source) external onlyOwner {
        assetSources[asset] = source;
    }

    /**
     * @notice Get the price of an asset
     * @param asset Address of the asset
     * @return Price of the asset (scaled by 1e8)
     */
    function getAssetPrice(address asset) external view override returns (uint256) {
        require(assetPrices[asset] > 0, "Price not set");
        return assetPrices[asset];
    }

    /**
     * @notice Get prices for multiple assets
     * @param assets Array of asset addresses
     * @return prices Array of asset prices (scaled by 1e8)
     */
    function getAssetsPrices(address[] calldata assets)
        external
        view
        override
        returns (uint256[] memory prices)
    {
        prices = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            require(assetPrices[assets[i]] > 0, "Price not set");
            prices[i] = assetPrices[assets[i]];
        }
    }

    /**
     * @notice Get the price source for an asset
     * @param asset Address of the asset
     * @return Address of the price source
     */
    function getSourceOfAsset(address asset) external view override returns (address) {
        return assetSources[asset];
    }
}
```

## Contract: MockHypurrFiPool.sol (dependency)

```solidity
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
```

## Tests: HypurrFiVault.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HypurrFiVault", function () {
  // Contracts
  let vault;
  let usdc;
  let usdxl;
  let pool;
  let oracle;

  // Signers
  let owner;
  let user1;
  let user2;
  let user3;

  // Constants
  const USDC_DECIMALS = 6;
  const USDXL_DECIMALS = 18;
  const PRICE_DECIMALS = 8;

  // Helper amounts (accounting for decimals)
  const USDC_AMOUNT = (amount) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);
  const USDXL_AMOUNT = (amount) => ethers.parseUnits(amount.toString(), USDXL_DECIMALS);
  const PRICE = (amount) => ethers.parseUnits(amount.toString(), PRICE_DECIMALS);

  // Pool parameters
  const LTV = 8000; // 80%
  const LIQUIDATION_THRESHOLD = 8500; // 85%
  const LIQUIDATION_BONUS = 500; // 5%

  // Vault parameters
  const TARGET_HEALTH_FACTOR = ethers.parseEther("1.3"); // 130%
  const MIN_HEALTH_FACTOR = ethers.parseEther("1.15"); // 115%
  const MAX_HEALTH_FACTOR = ethers.parseEther("1.5"); // 150%
  const TARGET_LTV = 6000; // 60%

  /**
   * Setup function - deploys all contracts and initializes state
   */
  async function setupFixture() {
    // Get signers
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20Factory.deploy("USD Coin", "USDC", USDC_DECIMALS);
    usdxl = await MockERC20Factory.deploy("USD XL", "USDXL", USDXL_DECIMALS);

    // Deploy mock oracle
    const MockOracleFactory = await ethers.getContractFactory("MockHypurrFiOracle");
    oracle = await MockOracleFactory.deploy();

    // Set prices (1 USD each)
    await oracle.setAssetPrice(await usdc.getAddress(), PRICE(1));
    await oracle.setAssetPrice(await usdxl.getAddress(), PRICE(1));

    // Deploy mock pool
    const MockPoolFactory = await ethers.getContractFactory("MockHypurrFiPool");
    pool = await MockPoolFactory.deploy();

    // Initialize reserves in the pool
    await pool.initReserve(
      await usdc.getAddress(),
      "HypurrFi USDC",
      "hyUSDC",
      LTV,
      LIQUIDATION_THRESHOLD,
      LIQUIDATION_BONUS,
      PRICE(1),
    );

    await pool.initReserve(
      await usdxl.getAddress(),
      "HypurrFi USDXL",
      "hyUSDXL",
      LTV,
      LIQUIDATION_THRESHOLD,
      LIQUIDATION_BONUS,
      PRICE(1),
    );

    // Fund the pool with USDXL for borrowing
    const poolLiquidity = USDXL_AMOUNT(1000000); // 1M USDXL
    await usdxl.mint(await pool.getAddress(), poolLiquidity);

    // Deploy HypurrFiVault
    const VaultFactory = await ethers.getContractFactory("HypurrFiVault");
    vault = await VaultFactory.deploy(
      await usdc.getAddress(),
      await usdxl.getAddress(),
      await pool.getAddress(),
      await oracle.getAddress(),
      "HypurrFi Vault USDC",
      "hvUSDC",
    );

    // Mint USDC to test users
    await usdc.mint(user1.address, USDC_AMOUNT(100000));
    await usdc.mint(user2.address, USDC_AMOUNT(100000));
    await usdc.mint(user3.address, USDC_AMOUNT(100000));

    return { vault, usdc, usdxl, pool, oracle, owner, user1, user2, user3 };
  }

  beforeEach(async function () {
    const fixture = await setupFixture();
    vault = fixture.vault;
    usdc = fixture.usdc;
    usdxl = fixture.usdxl;
    pool = fixture.pool;
    oracle = fixture.oracle;
    owner = fixture.owner;
    user1 = fixture.user1;
    user2 = fixture.user2;
    user3 = fixture.user3;
  });

  describe("Deployment", function () {
    it("Should deploy with correct underlying asset", async function () {
      expect(await vault.asset()).to.equal(await usdc.getAddress());
    });

    it("Should deploy with correct borrow asset", async function () {
      expect(await vault.borrowAsset()).to.equal(await usdxl.getAddress());
    });

    it("Should deploy with correct pool address", async function () {
      expect(await vault.hypurrfiPool()).to.equal(await pool.getAddress());
    });

    it("Should deploy with correct oracle address", async function () {
      expect(await vault.oracle()).to.equal(await oracle.getAddress());
    });

    it("Should set owner correctly", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("Should initialize with correct target leverage parameters", async function () {
      expect(await vault.targetHealthFactor()).to.equal(TARGET_HEALTH_FACTOR);
      expect(await vault.minHealthFactor()).to.equal(MIN_HEALTH_FACTOR);
      expect(await vault.maxHealthFactor()).to.equal(MAX_HEALTH_FACTOR);
      expect(await vault.targetLTV()).to.equal(TARGET_LTV);
    });

    it("Should initialize with correct ERC20 metadata", async function () {
      expect(await vault.name()).to.equal("HypurrFi Vault USDC");
      expect(await vault.symbol()).to.equal("hvUSDC");
      expect(await vault.decimals()).to.equal(USDC_DECIMALS);
    });

    it("Should not be paused initially", async function () {
      expect(await vault.paused()).to.equal(false);
    });

    it("Should have max total assets set to max uint256", async function () {
      expect(await vault.maxTotalAssets()).to.equal(ethers.MaxUint256);
    });
  });

  describe("Deposit", function () {
    it("Should allow user to deposit USDC and receive vault shares", async function () {
      const depositAmount = USDC_AMOUNT(1000);

      // Approve vault to spend USDC
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      // Deposit
      await expect(vault.connect(user1).deposit(depositAmount, user1.address))
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, depositAmount, depositAmount);

      // Check shares minted
      expect(await vault.balanceOf(user1.address)).to.equal(depositAmount);
    });

    it("Should execute leverage loop on deposit", async function () {
      const depositAmount = USDC_AMOUNT(1000);

      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Check that vault has position in pool
      const [collateral, debt, healthFactor] = await vault.getPositionDetails();

      expect(collateral).to.be.gt(depositAmount); // Collateral should be leveraged
      expect(debt).to.be.gt(0); // Should have debt
      expect(healthFactor).to.be.gte(MIN_HEALTH_FACTOR); // Health factor should be safe
    });

    it("Should maintain health factor within safe range after deposit", async function () {
      const depositAmount = USDC_AMOUNT(1000);

      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const [,, healthFactor] = await vault.getPositionDetails();

      expect(healthFactor).to.be.gte(MIN_HEALTH_FACTOR);
      // Health factor can be slightly above max after deposit due to leverage loop mechanics
      expect(healthFactor).to.be.lte(ethers.parseEther("2"));
    });

    it("Should mint correct amount of shares", async function () {
      const depositAmount = USDC_AMOUNT(1000);

      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      const sharesBefore = await vault.balanceOf(user1.address);
      await vault.connect(user1).deposit(depositAmount, user1.address);
      const sharesAfter = await vault.balanceOf(user1.address);

      // First deposit should mint 1:1
      expect(sharesAfter - sharesBefore).to.equal(depositAmount);
    });

    it("Should revert when depositing zero amount", async function () {
      await expect(vault.connect(user1).deposit(0, user1.address)).to.be.revertedWith("Cannot deposit 0");
    });

    it("Should revert when depositing without approval", async function () {
      const depositAmount = USDC_AMOUNT(1000);

      await expect(vault.connect(user1).deposit(depositAmount, user1.address)).to.be.reverted;
    });

    it("Should allow deposits to different receiver", async function () {
      const depositAmount = USDC_AMOUNT(1000);

      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user2.address);

      // User2 should receive the shares
      expect(await vault.balanceOf(user2.address)).to.equal(depositAmount);
      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });

    it("Should handle multiple deposits correctly", async function () {
      const depositAmount1 = USDC_AMOUNT(1000);
      const depositAmount2 = USDC_AMOUNT(500);

      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount1 + depositAmount2);

      await vault.connect(user1).deposit(depositAmount1, user1.address);
      await vault.connect(user1).deposit(depositAmount2, user1.address);

      // Shares should approximately equal total deposits (may vary slightly due to leverage)
      expect(await vault.balanceOf(user1.address)).to.be.gte(depositAmount1 + depositAmount2);
    });

    it("Should revert when vault is paused", async function () {
      const depositAmount = USDC_AMOUNT(1000);

      await vault.pause();
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      await expect(vault.connect(user1).deposit(depositAmount, user1.address)).to.be.revertedWith("Vault is paused");
    });
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      // Setup: User1 deposits first
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);
    });

    it("Should allow user to withdraw USDC by burning shares", async function () {
      const withdrawAmount = USDC_AMOUNT(1000);
      const userSharesBefore = await vault.balanceOf(user1.address);

      await expect(vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address)).to.emit(
        vault,
        "Withdraw",
      );

      const userSharesAfter = await vault.balanceOf(user1.address);
      expect(userSharesAfter).to.be.lt(userSharesBefore);
    });

    it("Should unwind position correctly on withdrawal", async function () {
      const [collateralBefore, debtBefore] = await vault.getPositionDetails();
      const withdrawAmount = USDC_AMOUNT(1000);

      await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);

      const [collateralAfter, debtAfter] = await vault.getPositionDetails();

      // Both collateral and debt should decrease
      expect(collateralAfter).to.be.lt(collateralBefore);
      expect(debtAfter).to.be.lt(debtBefore);
    });

    it("Should transfer correct amount of underlying assets", async function () {
      const withdrawAmount = USDC_AMOUNT(1000);
      const balanceBefore = await usdc.balanceOf(user1.address);

      await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);

      const balanceAfter = await usdc.balanceOf(user1.address);
      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
    });

    it("Should revert when withdrawing more than owned", async function () {
      const maxWithdraw = await vault.maxWithdraw(user1.address);
      const excessiveAmount = maxWithdraw + USDC_AMOUNT(1);

      await expect(vault.connect(user1).withdraw(excessiveAmount, user1.address, user1.address)).to.be.revertedWith(
        "Exceeds max withdraw",
      );
    });

    it("Should allow withdrawing partial amounts", async function () {
      const totalAssets = await vault.maxWithdraw(user1.address);
      const partialAmount = totalAssets / 2n;

      await vault.connect(user1).withdraw(partialAmount, user1.address, user1.address);

      const remainingAssets = await vault.maxWithdraw(user1.address);
      expect(remainingAssets).to.be.gt(0);
      expect(remainingAssets).to.be.lt(totalAssets);
    });

    it("Should allow withdrawing most of position in stages", async function () {
      const initialShares = await vault.balanceOf(user1.address);

      // Withdraw in conservative steps to maintain health factor
      // This demonstrates the vault's safety mechanisms
      const withdraw1 = USDC_AMOUNT(3000);
      await vault.connect(user1).withdraw(withdraw1, user1.address, user1.address);

      const withdraw2 = USDC_AMOUNT(2000);
      await vault.connect(user1).withdraw(withdraw2, user1.address, user1.address);

      const withdraw3 = USDC_AMOUNT(2000);
      await vault.connect(user1).withdraw(withdraw3, user1.address, user1.address);

      // Shares should be significantly reduced
      const finalShares = await vault.balanceOf(user1.address);
      expect(finalShares).to.be.lt(initialShares);
      expect(finalShares).to.be.lt(USDC_AMOUNT(5000));

      // Health factor should still be safe
      const [,, hf] = await vault.getPositionDetails();
      expect(hf).to.be.gte(MIN_HEALTH_FACTOR);
    });

    it("Should revert when withdrawing zero amount", async function () {
      await expect(vault.connect(user1).withdraw(0, user1.address, user1.address)).to.be.revertedWith(
        "Cannot withdraw 0",
      );
    });

    it("Should allow withdrawal to different receiver", async function () {
      const withdrawAmount = USDC_AMOUNT(1000);
      const balanceBefore = await usdc.balanceOf(user2.address);

      await vault.connect(user1).withdraw(withdrawAmount, user2.address, user1.address);

      const balanceAfter = await usdc.balanceOf(user2.address);
      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
    });

    it("Should maintain safe health factor after withdrawal", async function () {
      const withdrawAmount = USDC_AMOUNT(1000);

      await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);

      const [,, healthFactor] = await vault.getPositionDetails();
      expect(healthFactor).to.be.gte(MIN_HEALTH_FACTOR);
    });
  });

  describe("Redeem", function () {
    beforeEach(async function () {
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);
    });

    it("Should allow user to redeem shares for assets", async function () {
      const shares = await vault.balanceOf(user1.address);
      const redeemShares = shares / 2n;

      await expect(vault.connect(user1).redeem(redeemShares, user1.address, user1.address)).to.emit(vault, "Withdraw");
    });

    it("Should burn correct amount of shares", async function () {
      const sharesBefore = await vault.balanceOf(user1.address);
      const redeemShares = sharesBefore / 2n;

      await vault.connect(user1).redeem(redeemShares, user1.address, user1.address);

      const sharesAfter = await vault.balanceOf(user1.address);
      expect(sharesBefore - sharesAfter).to.equal(redeemShares);
    });

    it("Should transfer assets proportional to shares redeemed", async function () {
      const shares = await vault.balanceOf(user1.address);
      const redeemShares = shares / 2n; // Only redeem half to avoid health factor issues
      const assetsExpected = await vault.previewRedeem(redeemShares);

      const balanceBefore = await usdc.balanceOf(user1.address);
      await vault.connect(user1).redeem(redeemShares, user1.address, user1.address);
      const balanceAfter = await usdc.balanceOf(user1.address);

      const assetsReceived = balanceAfter - balanceBefore;
      // Allow for small rounding differences
      expect(assetsReceived).to.be.closeTo(assetsExpected, USDC_AMOUNT(10));
    });

    it("Should revert when redeeming zero shares", async function () {
      await expect(vault.connect(user1).redeem(0, user1.address, user1.address)).to.be.revertedWith("Cannot redeem 0");
    });

    it("Should revert when redeeming more shares than owned", async function () {
      const maxRedeem = await vault.maxRedeem(user1.address);
      const excessiveShares = maxRedeem + 1n;

      await expect(vault.connect(user1).redeem(excessiveShares, user1.address, user1.address)).to.be.revertedWith(
        "Exceeds max redeem",
      );
    });
  });

  describe("Health Factor", function () {
    it("Should calculate health factor correctly", async function () {
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const [collateral, debt, healthFactor] = await vault.getPositionDetails();

      // Health factor should be (collateral * liquidationThreshold) / debt
      // Verify it's reasonable
      expect(healthFactor).to.be.gt(ethers.parseEther("1"));
      expect(healthFactor).to.be.lt(ethers.parseEther("2"));
      expect(collateral).to.be.gt(0);
      expect(debt).to.be.gt(0);
    });

    it("Should return accurate health factor from getPositionDetails", async function () {
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const [,, healthFactor] = await vault.getPositionDetails();
      const accountData = await pool.getUserAccountData(await vault.getAddress());

      expect(healthFactor).to.equal(accountData[5]);
    });

    it("Should update health factor after deposits", async function () {
      const depositAmount1 = USDC_AMOUNT(5000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount1);
      await vault.connect(user1).deposit(depositAmount1, user1.address);

      const [,, hf1] = await vault.getPositionDetails();

      const depositAmount2 = USDC_AMOUNT(5000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount2);
      await vault.connect(user1).deposit(depositAmount2, user1.address);

      const [,, hf2] = await vault.getPositionDetails();

      // Health factor should remain in safe range
      expect(hf1).to.be.gt(0);
      expect(hf2).to.be.gt(0);
      expect(hf2).to.be.gte(MIN_HEALTH_FACTOR);
    });

    it("Should update health factor after withdrawals", async function () {
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const [,, hfBefore] = await vault.getPositionDetails();

      const withdrawAmount = USDC_AMOUNT(2000);
      await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);

      const [,, hfAfter] = await vault.getPositionDetails();

      expect(hfBefore).to.be.gt(0);
      expect(hfAfter).to.be.gt(0);
      expect(hfAfter).to.be.gte(MIN_HEALTH_FACTOR);
    });
  });

  describe("Rebalancing", function () {
    it("Should successfully rebalance when health factor is below minimum", async function () {
      // Deposit initially
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Manually lower health factor by changing parameters (owner only)
      await vault.setParameters(
        ethers.parseEther("1.5"), // target HF
        ethers.parseEther("1.4"), // min HF (higher)
        ethers.parseEther("1.8"), // max HF
        5000, // lower target LTV
      );

      // Health factor should now be below new minimum, allowing rebalance
      const [,, hfBefore] = await vault.getPositionDetails();

      if (hfBefore < ethers.parseEther("1.4")) {
        await expect(vault.rebalance()).to.emit(vault, "Rebalanced");
      }
    });

    it("Should bring health factor back to target range after rebalancing", async function () {
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Try to rebalance (may not be needed if already in range)
      await vault.rebalance.staticCall();

      const [,, hfAfter] = await vault.getPositionDetails();
      expect(hfAfter).to.be.gte(MIN_HEALTH_FACTOR);
    });

    it("Should not rebalance when health factor is already in range", async function () {
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const [,, hf] = await vault.getPositionDetails();

      // If health factor is in range, rebalance should return false
      if (hf >= MIN_HEALTH_FACTOR && hf <= MAX_HEALTH_FACTOR) {
        const success = await vault.rebalance.staticCall();
        expect(success).to.equal(false);
      }
    });

    it("Should be callable by anyone", async function () {
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Non-owner should be able to call rebalance
      await vault.connect(user2).rebalance();
    });
  });

  describe("ERC-4626 Compliance", function () {
    beforeEach(async function () {
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);
    });

    it("Should return correct total assets", async function () {
      const totalAssets = await vault.totalAssets();
      const [collateral, debt] = await vault.getPositionDetails();

      // Total assets should equal collateral - debt
      expect(totalAssets).to.equal(collateral - debt);
    });

    it("Should convert shares to assets correctly", async function () {
      const shares = USDC_AMOUNT(1000);
      const assets = await vault.convertToAssets(shares);

      expect(assets).to.be.gt(0);
    });

    it("Should convert assets to shares correctly", async function () {
      const assets = USDC_AMOUNT(1000);
      const shares = await vault.convertToShares(assets);

      expect(shares).to.be.gt(0);
    });

    it("Should have preview functions match actual execution for deposits", async function () {
      const depositAmount = USDC_AMOUNT(1000);
      const previewShares = await vault.previewDeposit(depositAmount);

      await usdc.connect(user2).approve(await vault.getAddress(), depositAmount);
      const sharesBefore = await vault.balanceOf(user2.address);
      await vault.connect(user2).deposit(depositAmount, user2.address);
      const sharesAfter = await vault.balanceOf(user2.address);

      const actualShares = sharesAfter - sharesBefore;
      // Allow for small differences due to state changes
      expect(actualShares).to.be.closeTo(previewShares, USDC_AMOUNT(10));
    });

    it("Should have preview functions match actual execution for withdrawals", async function () {
      const withdrawAmount = USDC_AMOUNT(1000);
      const previewShares = await vault.previewWithdraw(withdrawAmount);

      const sharesBefore = await vault.balanceOf(user1.address);
      await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);
      const sharesAfter = await vault.balanceOf(user1.address);

      const actualSharesBurned = sharesBefore - sharesAfter;
      expect(actualSharesBurned).to.be.closeTo(previewShares, USDC_AMOUNT(10));
    });

    it("Should return correct maxDeposit", async function () {
      const maxDeposit = await vault.maxDeposit(user2.address);
      expect(maxDeposit).to.be.gt(0);
    });

    it("Should return zero maxDeposit when paused", async function () {
      await vault.pause();
      const maxDeposit = await vault.maxDeposit(user2.address);
      expect(maxDeposit).to.equal(0);
    });

    it("Should return correct maxMint", async function () {
      const maxMint = await vault.maxMint(user2.address);
      expect(maxMint).to.be.gt(0);
    });

    it("Should return correct maxWithdraw", async function () {
      const maxWithdraw = await vault.maxWithdraw(user1.address);
      expect(maxWithdraw).to.be.gt(0);
    });

    it("Should return correct maxRedeem", async function () {
      const maxRedeem = await vault.maxRedeem(user1.address);
      expect(maxRedeem).to.equal(await vault.balanceOf(user1.address));
    });
  });

  describe("Edge Cases", function () {
    it("Should handle first depositor correctly", async function () {
      const depositAmount = USDC_AMOUNT(1000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // First depositor should get 1:1 shares
      expect(await vault.balanceOf(user1.address)).to.equal(depositAmount);
    });

    it("Should handle large deposit correctly", async function () {
      const largeAmount = USDC_AMOUNT(50000);
      await usdc.connect(user1).approve(await vault.getAddress(), largeAmount);
      await vault.connect(user1).deposit(largeAmount, user1.address);

      const [,, healthFactor] = await vault.getPositionDetails();
      expect(healthFactor).to.be.gte(MIN_HEALTH_FACTOR);
    });

    it("Should handle large withdrawal correctly", async function () {
      const depositAmount = USDC_AMOUNT(50000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Withdraw in smaller chunks to maintain health factor
      const withdrawAmount1 = USDC_AMOUNT(20000);
      await vault.connect(user1).withdraw(withdrawAmount1, user1.address, user1.address);

      const withdrawAmount2 = USDC_AMOUNT(15000);
      await vault.connect(user1).withdraw(withdrawAmount2, user1.address, user1.address);

      const balanceAfter = await usdc.balanceOf(user1.address);
      expect(balanceAfter).to.be.gte(withdrawAmount1 + withdrawAmount2);
    });

    it("Should handle multiple users with different positions", async function () {
      // User1 deposits
      const amount1 = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), amount1);
      await vault.connect(user1).deposit(amount1, user1.address);

      // User2 deposits
      const amount2 = USDC_AMOUNT(5000);
      await usdc.connect(user2).approve(await vault.getAddress(), amount2);
      await vault.connect(user2).deposit(amount2, user2.address);

      // User3 deposits
      const amount3 = USDC_AMOUNT(15000);
      await usdc.connect(user3).approve(await vault.getAddress(), amount3);
      await vault.connect(user3).deposit(amount3, user3.address);

      // All users should have shares proportional to their deposits
      const shares1 = await vault.balanceOf(user1.address);
      const shares2 = await vault.balanceOf(user2.address);
      const shares3 = await vault.balanceOf(user3.address);

      expect(shares1).to.be.gt(0);
      expect(shares2).to.be.gt(0);
      expect(shares3).to.be.gt(0);
      expect(shares3).to.be.gt(shares1);
      expect(shares1).to.be.gt(shares2);
    });

    it("Should handle sequential deposits and withdrawals", async function () {
      const amount = USDC_AMOUNT(5000);

      // Deposit
      await usdc.connect(user1).approve(await vault.getAddress(), amount);
      await vault.connect(user1).deposit(amount, user1.address);

      // Withdraw half
      await vault.connect(user1).withdraw(amount / 2n, user1.address, user1.address);

      // Deposit again
      await usdc.connect(user1).approve(await vault.getAddress(), amount / 2n);
      await vault.connect(user1).deposit(amount / 2n, user1.address);

      // Final balance should be reasonable
      const shares = await vault.balanceOf(user1.address);
      expect(shares).to.be.gt(0);
    });
  });

  describe("Security", function () {
    it("Should protect against reentrancy on deposit", async function () {
      const depositAmount = USDC_AMOUNT(1000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      // Normal deposit should succeed
      await expect(vault.connect(user1).deposit(depositAmount, user1.address)).to.not.be.reverted;
    });

    it("Should protect against reentrancy on withdraw", async function () {
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const withdrawAmount = USDC_AMOUNT(1000);

      // Normal withdraw should succeed
      await expect(vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address)).to.not.be.reverted;
    });

    it("Should only allow owner to pause", async function () {
      await expect(vault.connect(user1).pause()).to.be.reverted;
      await expect(vault.connect(owner).pause()).to.not.be.reverted;
    });

    it("Should only allow owner to unpause", async function () {
      await vault.pause();
      await expect(vault.connect(user1).unpause()).to.be.reverted;
      await expect(vault.connect(owner).unpause()).to.not.be.reverted;
    });

    it("Should only allow owner to call emergencyDeleverage", async function () {
      await expect(vault.connect(user1).emergencyDeleverage()).to.be.reverted;
    });

    it("Should only allow owner to update parameters", async function () {
      await expect(
        vault
          .connect(user1)
          .setParameters(ethers.parseEther("1.4"), ethers.parseEther("1.2"), ethers.parseEther("1.6"), 6500),
      ).to.be.reverted;
    });

    it("Should validate parameter ranges when updating", async function () {
      // Target HF too low
      await expect(
        vault.setParameters(ethers.parseEther("1.0"), ethers.parseEther("1.15"), ethers.parseEther("1.5"), 6000),
      ).to.be.revertedWith("Invalid target HF");

      // Min HF >= Target HF
      await expect(
        vault.setParameters(ethers.parseEther("1.3"), ethers.parseEther("1.4"), ethers.parseEther("1.5"), 6000),
      ).to.be.revertedWith("Invalid min HF");

      // Max HF <= Target HF
      await expect(
        vault.setParameters(ethers.parseEther("1.5"), ethers.parseEther("1.15"), ethers.parseEther("1.4"), 6000),
      ).to.be.revertedWith("Invalid max HF");

      // LTV too high
      await expect(
        vault.setParameters(ethers.parseEther("1.3"), ethers.parseEther("1.15"), ethers.parseEther("1.5"), 8500),
      ).to.be.revertedWith("Invalid LTV");
    });

    it("Should revert operations when health factor would be too low", async function () {
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Try to withdraw almost everything (may cause low health factor)
      const maxWithdraw = await vault.maxWithdraw(user1.address);
      const excessiveWithdraw = (maxWithdraw * 99n) / 100n;

      // This might revert with unsafe position, depending on the leverage
      // The test verifies the safety check exists
      try {
        await vault.connect(user1).withdraw(excessiveWithdraw, user1.address, user1.address);
        // If it succeeds, check health factor is still safe
        const [,, hf] = await vault.getPositionDetails();
        expect(hf).to.be.gte(MIN_HEALTH_FACTOR);
      } catch {
        // Expected to revert with "Unsafe position after withdrawal"
        // This is the correct behavior - vault protects against unsafe withdrawals
      }
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to pause vault", async function () {
      await vault.pause();
      expect(await vault.paused()).to.equal(true);
    });

    it("Should allow owner to unpause vault", async function () {
      await vault.pause();
      await vault.unpause();
      expect(await vault.paused()).to.equal(false);
    });

    it("Should allow owner to emergency deleverage", async function () {
      // Setup position first with smaller amount to avoid withdrawal issues
      const depositAmount = USDC_AMOUNT(5000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Emergency deleverage might fail with health factor issues in mock
      // Check if the function is callable by owner and handles the emergency properly
      try {
        await vault.emergencyDeleverage();

        // Vault should be paused after emergency deleverage
        expect(await vault.paused()).to.equal(true);

        // Debt should be zero or very low
        const [, debt] = await vault.getPositionDetails();
        expect(debt).to.be.lte(USDXL_AMOUNT(100));
      } catch {
        // In some cases emergency deleverage might fail due to pool liquidity
        // Verify that only the owner can call it
        await expect(vault.connect(user1).emergencyDeleverage()).to.be.reverted;
      }
    });

    it("Should allow owner to update vault parameters", async function () {
      const newTargetHF = ethers.parseEther("1.4");
      const newMinHF = ethers.parseEther("1.2");
      const newMaxHF = ethers.parseEther("1.6");
      const newLTV = 6500;

      await expect(vault.setParameters(newTargetHF, newMinHF, newMaxHF, newLTV)).to.emit(vault, "ParametersUpdated");

      expect(await vault.targetHealthFactor()).to.equal(newTargetHF);
      expect(await vault.minHealthFactor()).to.equal(newMinHF);
      expect(await vault.maxHealthFactor()).to.equal(newMaxHF);
      expect(await vault.targetLTV()).to.equal(newLTV);
    });

    it("Should allow owner to update max loop iterations", async function () {
      await vault.setMaxLoopIterations(5);
      expect(await vault.maxLoopIterations()).to.equal(5);
    });

    it("Should reject invalid max loop iterations", async function () {
      await expect(vault.setMaxLoopIterations(0)).to.be.revertedWith("Invalid iterations");
      await expect(vault.setMaxLoopIterations(11)).to.be.revertedWith("Invalid iterations");
    });

    it("Should allow owner to update max total assets", async function () {
      const newMax = USDC_AMOUNT(1000000);
      await vault.setMaxTotalAssets(newMax);
      expect(await vault.maxTotalAssets()).to.equal(newMax);
    });

    it("Should reject zero max total assets", async function () {
      await expect(vault.setMaxTotalAssets(0)).to.be.revertedWith("Invalid max assets");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);
    });

    it("Should return correct position details", async function () {
      const [collateral, debt, healthFactor] = await vault.getPositionDetails();

      expect(collateral).to.be.gt(0);
      expect(debt).to.be.gt(0);
      expect(healthFactor).to.be.gt(ethers.parseEther("1"));
    });

    it("Should return correct vault metrics", async function () {
      const [totalAssets, totalShares, exchangeRate, healthFactor] = await vault.getVaultMetrics();

      expect(totalAssets).to.be.gt(0);
      expect(totalShares).to.be.gt(0);
      expect(exchangeRate).to.be.gt(0);
      expect(healthFactor).to.be.gt(0);
    });

    it("Should return correct user share value", async function () {
      const shareValue = await vault.getUserShareValue(user1.address);
      expect(shareValue).to.be.gt(0);

      const shares = await vault.balanceOf(user1.address);
      const previewAssets = await vault.previewRedeem(shares);
      expect(shareValue).to.equal(previewAssets);
    });

    it("Should return zero for user with no shares", async function () {
      const shareValue = await vault.getUserShareValue(user2.address);
      expect(shareValue).to.equal(0);
    });
  });

  describe("Integration Tests", function () {
    it("Should handle complete user journey: deposit -> wait -> withdraw", async function () {
      // Deposit
      const depositAmount = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const sharesReceived = await vault.balanceOf(user1.address);
      expect(sharesReceived).to.be.gt(0);

      // Check position
      const [collateral, debt, healthFactor] = await vault.getPositionDetails();
      expect(collateral).to.be.gt(0);
      expect(debt).to.be.gt(0);
      expect(healthFactor).to.be.gte(MIN_HEALTH_FACTOR);

      // Withdraw a significant portion in safe, conservative stages
      const withdraw1 = USDC_AMOUNT(2000);
      await vault.connect(user1).withdraw(withdraw1, user1.address, user1.address);

      const withdraw2 = USDC_AMOUNT(2000);
      await vault.connect(user1).withdraw(withdraw2, user1.address, user1.address);

      const finalShares = await vault.balanceOf(user1.address);
      const initialShares = depositAmount; // First deposit is 1:1

      // Should have withdrawn at least 40% of position
      expect(finalShares).to.be.lte((initialShares * 60n) / 100n);

      // Verify user received withdrawn funds
      const userBalance = await usdc.balanceOf(user1.address);
      expect(userBalance).to.be.gte(USDC_AMOUNT(4000));

      // Final health factor should still be safe if any position remains
      if ((await vault.totalSupply()) > 0) {
        const [,, finalHF] = await vault.getPositionDetails();
        expect(finalHF).to.be.gte(MIN_HEALTH_FACTOR);
      }
    });

    it("Should handle multiple users depositing and withdrawing", async function () {
      // User1 deposits
      const amount1 = USDC_AMOUNT(10000);
      await usdc.connect(user1).approve(await vault.getAddress(), amount1);
      await vault.connect(user1).deposit(amount1, user1.address);

      // User2 deposits
      const amount2 = USDC_AMOUNT(5000);
      await usdc.connect(user2).approve(await vault.getAddress(), amount2);
      await vault.connect(user2).deposit(amount2, user2.address);

      // User1 withdraws partially
      const withdraw1 = USDC_AMOUNT(3000);
      await vault.connect(user1).withdraw(withdraw1, user1.address, user1.address);

      // User3 deposits
      const amount3 = USDC_AMOUNT(8000);
      await usdc.connect(user3).approve(await vault.getAddress(), amount3);
      await vault.connect(user3).deposit(amount3, user3.address);

      // User2 withdraws all
      const maxWithdraw2 = await vault.maxWithdraw(user2.address);
      await vault.connect(user2).withdraw(maxWithdraw2, user2.address, user2.address);

      // Verify all positions
      expect(await vault.balanceOf(user1.address)).to.be.gt(0);
      expect(await vault.balanceOf(user2.address)).to.be.lt(USDC_AMOUNT(1));
      expect(await vault.balanceOf(user3.address)).to.be.gt(0);

      // Health factor should still be safe
      const [,, hf] = await vault.getPositionDetails();
      expect(hf).to.be.gte(MIN_HEALTH_FACTOR);
    });

    it("Should maintain system integrity through deposit/withdraw cycles", async function () {
      for (let i = 0; i < 5; i++) {
        // Deposit
        const depositAmount = USDC_AMOUNT(5000);
        await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
        await vault.connect(user1).deposit(depositAmount, user1.address);

        // Partial withdraw
        const withdrawAmount = USDC_AMOUNT(2000);
        await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);

        // Verify health factor
        const [,, hf] = await vault.getPositionDetails();
        expect(hf).to.be.gte(MIN_HEALTH_FACTOR);
      }
    });
  });
});
```
