// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IStrategy.sol";

/**
 * @title Vault
 * @notice ERC-4626 compliant vault for DeFi yield optimization
 * @dev Main vault contract that accepts USDC and allocates to yield strategies
 *
 * Features:
 * - ERC-4626 standard implementation for tokenized vaults
 * - Reentrancy protection on all state-changing functions
 * - Owner-controlled strategy management
 * - Support for multiple yield strategies
 *
 * Security:
 * - ReentrancyGuard prevents reentrancy attacks
 * - Ownable restricts strategy management to owner only
 * - SafeERC20 prevents token transfer issues
 * - Input validation on all public functions
 */
contract Vault is ERC4626, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                            STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice Address of the active yield strategy
    address public strategy;

    /// @notice Maximum assets accepted in a single deposit call (0 = deposits disabled)
    /// @dev Renamed from `maxDeposit` so it no longer shadows the ERC-4626
    ///      `maxDeposit(address)` entry point. Read the standard function for
    ///      the effective limit; this is the raw configured cap.
    uint256 public depositCap;

    /// @notice Total assets allocated to strategy
    uint256 public totalAllocated;

    /// @notice Minimum time between harvests (in seconds)
    uint256 public constant MIN_HARVEST_DELAY = 1 hours;

    /// @notice Last harvest timestamp
    uint256 public lastHarvest;

    /// @notice Emergency shutdown flag
    bool public emergencyShutdown;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when a new strategy is set
    event StrategyUpdated(address indexed oldStrategy, address indexed newStrategy);

    /// @notice Emitted when assets are allocated to strategy
    event AssetsAllocated(uint256 amount, uint256 totalAllocated);

    /// @notice Emitted when assets are withdrawn from strategy
    event AssetsWithdrawn(uint256 amount, uint256 totalAllocated);

    /// @notice Emitted when the deposit cap is updated
    event DepositCapUpdated(uint256 oldCap, uint256 newCap);

    /// @notice Emitted when emergency shutdown is triggered
    event EmergencyShutdown(address indexed caller);

    /// @notice Emitted when harvest is executed
    event Harvest(uint256 profit, uint256 timestamp);

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();
    error ExceedsDepositCap();
    error EmergencyShutdownActive();
    error HarvestTooSoon();
    error InsufficientBalance();
    error InvalidAmount();

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Initialize the Vault
     * @param asset_ Address of the underlying asset (USDC)
     * @param name_ Name of the vault token
     * @param symbol_ Symbol of the vault token
     */
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_
    ) ERC4626(asset_) ERC20(name_, symbol_) Ownable(msg.sender) {
        if (address(asset_) == address(0)) revert ZeroAddress();

        // Set reasonable defaults
        depositCap = type(uint256).max; // No limit initially
        lastHarvest = block.timestamp;
    }

    /*//////////////////////////////////////////////////////////////
                        DEPOSIT/WITHDRAWAL LOGIC
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Deposit assets and receive vault shares
     * @param assets Amount of assets to deposit
     * @param receiver Address to receive vault shares
     * @return shares Amount of shares minted
     */
    function deposit(
        uint256 assets,
        address receiver
    ) public override nonReentrant returns (uint256 shares) {
        if (emergencyShutdown) revert EmergencyShutdownActive();
        if (assets == 0) revert InvalidAmount();
        // Enforce the limit through the ERC-4626 entry point so the advertised
        // maximum and the enforced maximum can never drift apart.
        if (assets > maxDeposit(receiver)) revert ExceedsDepositCap();
        if (receiver == address(0)) revert ZeroAddress();

        shares = super.deposit(assets, receiver);
        // A deposit that rounds down to zero shares must revert rather than
        // succeed: the assets are already in the vault at this point, so
        // returning normally would hand the depositor nothing and quietly
        // donate their balance to everyone else. This costs nothing to any
        // depositor who receives shares, and it is a separate concern from the
        // virtual-offset arithmetic that decides how many shares that is.
        if (shares == 0) revert InvalidAmount();

        return shares;
    }

    /**
     * @notice Mint vault shares by depositing assets
     * @param shares Amount of shares to mint
     * @param receiver Address to receive vault shares
     * @return assets Amount of assets deposited
     */
    function mint(
        uint256 shares,
        address receiver
    ) public override nonReentrant returns (uint256 assets) {
        if (emergencyShutdown) revert EmergencyShutdownActive();
        if (shares == 0) revert InvalidAmount();
        // Enforce the limit through the ERC-4626 entry point so the advertised
        // maximum and the enforced maximum can never drift apart. Without this
        // the deposit cap was bypassable by entering through mint().
        if (shares > maxMint(receiver)) revert ExceedsDepositCap();
        if (receiver == address(0)) revert ZeroAddress();

        assets = super.mint(shares, receiver);

        return assets;
    }

    /**
     * @notice Withdraw assets by burning shares
     * @param assets Amount of assets to withdraw
     * @param receiver Address to receive assets
     * @param owner_ Address that owns the shares
     * @return shares Amount of shares burned
     */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner_
    ) public override nonReentrant returns (uint256 shares) {
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0)) revert ZeroAddress();

        // Check if we need to withdraw from strategy
        uint256 availableAssets = IERC20(asset()).balanceOf(address(this));
        if (assets > availableAssets && strategy != address(0)) {
            _withdrawFromStrategy(assets - availableAssets);
        }

        shares = super.withdraw(assets, receiver, owner_);

        return shares;
    }

    /**
     * @notice Redeem shares for assets
     * @param shares Amount of shares to redeem
     * @param receiver Address to receive assets
     * @param owner_ Address that owns the shares
     * @return assets Amount of assets withdrawn
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner_
    ) public override nonReentrant returns (uint256 assets) {
        if (shares == 0) revert InvalidAmount();
        if (receiver == address(0)) revert ZeroAddress();

        assets = previewRedeem(shares);

        // Check if we need to withdraw from strategy
        uint256 availableAssets = IERC20(asset()).balanceOf(address(this));
        if (assets > availableAssets && strategy != address(0)) {
            _withdrawFromStrategy(assets - availableAssets);
        }

        assets = super.redeem(shares, receiver, owner_);

        return assets;
    }

    /*//////////////////////////////////////////////////////////////
                        VAULT ACCOUNTING LOGIC
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Total assets under management (vault + strategy)
     * @return Total assets in the vault
     */
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + totalAllocated;
    }

    /**
     * @notice Maximum amount of assets that can be deposited for `receiver`
     *         in a single call without reverting
     * @dev ERC-4626 override. Reflects both the configured deposit cap and the
     *      emergency shutdown flag, per EIP-4626: when deposits are disabled
     *      (even temporarily) this MUST return 0. MUST NOT revert.
     * @return Maximum depositable assets
     */
    function maxDeposit(address) public view override returns (uint256) {
        if (emergencyShutdown) return 0;
        return depositCap;
    }

    /**
     * @notice Maximum amount of shares that can be minted for `receiver`
     *         in a single call without reverting
     * @dev ERC-4626 override, and the share-denominated mirror of
     *      {maxDeposit}. The cap is configured in assets, so it is converted
     *      here; an uncapped vault is reported as `type(uint256).max` directly
     *      because converting that value would overflow.
     *
     *      Rounding is safe in the direction that matters: `convertToShares`
     *      rounds down and `previewMint` rounds back up, so the assets pulled
     *      for `maxMint()` shares never exceed the configured cap.
     *
     *      Like {maxDeposit}, this returns 0 during emergency shutdown and
     *      MUST NOT revert, per EIP-4626.
     * @return Maximum mintable shares
     */
    function maxMint(address) public view override returns (uint256) {
        if (emergencyShutdown) return 0;
        if (depositCap == type(uint256).max) return type(uint256).max;
        return convertToShares(depositCap);
    }

    /*//////////////////////////////////////////////////////////////
                        STRATEGY MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Set a new yield strategy
     * @param newStrategy Address of the new strategy contract
     * @dev Only owner can call this function
     */
    // The old strategy must be drained before `strategy` can point elsewhere, so
    // the assignment is necessarily after that external call. `nonReentrant` is
    // what makes that ordering safe, and it is not optional: being owner-gated
    // says nothing about what the strategy being called does with control while
    // it holds it. Without the guard, a strategy can re-enter `deposit()` during
    // the drain, which inflates the measured delta below and mints itself shares
    // it never paid for.
    // slither-disable-next-line reentrancy-no-eth
    function setStrategy(address newStrategy) external onlyOwner nonReentrant {
        if (newStrategy == address(0)) revert ZeroAddress();

        address oldStrategy = strategy;

        // If there's an old strategy, withdraw all assets first
        if (oldStrategy != address(0) && totalAllocated > 0) {
            _withdrawFromStrategy(totalAllocated);
        }

        strategy = newStrategy;

        emit StrategyUpdated(oldStrategy, newStrategy);
    }

    /**
     * @notice Allocate assets to the active strategy
     * @param amount Amount of assets to allocate
     * @dev Only owner can call this function
     */
    function allocateToStrategy(uint256 amount) external onlyOwner nonReentrant {
        if (strategy == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        uint256 availableAssets = IERC20(asset()).balanceOf(address(this));
        if (amount > availableAssets) revert InsufficientBalance();

        // Transfer assets to strategy
        IERC20(asset()).safeTransfer(strategy, amount);
        totalAllocated += amount;

        emit AssetsAllocated(amount, totalAllocated);
    }

    /**
     * @notice Withdraw assets from strategy
     * @param amount Amount to withdraw
     */
    // Measuring the balance across the call is deliberate: the vault trusts the
    // delta it observes, not what the owner-set strategy reports, and reverts
    // unless the delta covers `amount`. That invariant only holds while the
    // strategy cannot move the vault's balance from inside the call, so every
    // caller of this function is `nonReentrant`: `withdraw`, `redeem`,
    // `allocateToStrategy` and `setStrategy`. Dropping the guard from any of
    // them makes the delta forgeable and this comment false.
    // slither-disable-next-line reentrancy-balance,reentrancy-no-eth
    function _withdrawFromStrategy(uint256 amount) internal {
        if (strategy == address(0)) revert ZeroAddress();
        // A zero-amount withdrawal is a no-op, not a balance comparison.
        // slither-disable-next-line incorrect-equality
        if (amount == 0) return;
        if (amount > totalAllocated) revert InsufficientBalance();

        uint256 balanceBefore = IERC20(asset()).balanceOf(address(this));
        // The return value is ignored on purpose: `received` below is the
        // authoritative amount, measured from the vault's own balance.
        // slither-disable-next-line unused-return
        IStrategy(strategy).withdraw(amount);
        uint256 received = IERC20(asset()).balanceOf(address(this)) - balanceBefore;

        if (received < amount) revert InsufficientBalance();

        totalAllocated -= amount;

        emit AssetsWithdrawn(amount, totalAllocated);
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Update the per-call deposit cap
     * @param newDepositCap New cap in asset units. 0 disables deposits
     *        (`maxDeposit(address)` then returns 0); use type(uint256).max
     *        for no limit.
     */
    function setDepositCap(uint256 newDepositCap) external onlyOwner {
        uint256 oldCap = depositCap;
        depositCap = newDepositCap;

        emit DepositCapUpdated(oldCap, newDepositCap);
    }

    /**
     * @notice Trigger emergency shutdown
     * @dev Prevents new deposits but allows withdrawals
     */
    function triggerEmergencyShutdown() external onlyOwner {
        emergencyShutdown = true;

        emit EmergencyShutdown(msg.sender);
    }

    /**
     * @notice Placeholder harvest: records the time and reports zero profit
     * @dev This function harvests nothing. It enforces {MIN_HARVEST_DELAY},
     *      sets `lastHarvest` to now and emits {Harvest} with a profit of 0.
     *      It never calls the strategy — {IStrategy} does not even declare a
     *      harvest entry point — moves no assets, and leaves `totalAllocated`
     *      and {totalAssets} untouched. No yield is realised or accounted for
     *      by calling it, so read the {Harvest} event as a timestamp, not as a
     *      profit report.
     *
     *      A real implementation would call the strategy, measure the assets
     *      actually received and account for profit *and* loss. See "Known
     *      limitations" in the README.
     */
    function harvest() external onlyOwner nonReentrant {
        if (block.timestamp < lastHarvest + MIN_HARVEST_DELAY) {
            revert HarvestTooSoon();
        }

        // Nothing to harvest from: the timestamp is the only state this
        // placeholder owns.
        lastHarvest = block.timestamp;

        emit Harvest(0, block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                        VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get vault info for UI
     * @return totalAssets_ Total assets under management
     * @return totalShares Total shares minted
     * @return pricePerShare Price per share (in asset decimals)
     */
    function getVaultInfo() external view returns (
        uint256 totalAssets_,
        uint256 totalShares,
        uint256 pricePerShare
    ) {
        totalAssets_ = totalAssets();
        totalShares = totalSupply();
        pricePerShare = totalShares > 0 ? (totalAssets_ * 1e18) / totalShares : 1e18;
    }
}
