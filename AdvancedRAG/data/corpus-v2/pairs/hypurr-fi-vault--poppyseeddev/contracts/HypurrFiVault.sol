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
