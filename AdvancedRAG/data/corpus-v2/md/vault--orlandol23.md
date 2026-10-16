# vault--orlandol23

- domain: staking-yield (yield-vault)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/orlandol23/swiss-defi-optimizer @ bed5411a57f64473350a2ba9c5efd2ca5bb3b65a
- license: MIT
- targets: Vault.sol, IStrategy.sol, MockUSDC.sol, ReenteringStrategy.sol
- validation: 61 passing tests, 0 failing; statement coverage Vault.sol 94.83 %, IStrategy.sol 100.0 %, MockUSDC.sol 75.0 %, ReenteringStrategy.sol 100.0 %

## Contract: IStrategy.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IStrategy
 * @notice Interface that any yield strategy attached to the Vault must implement.
 * @dev The Vault transfers the underlying asset to the strategy via `safeTransfer`
 *      (see Vault.allocateToStrategy) and pulls it back by calling `withdraw`.
 *      A correct strategy MUST transfer the requested amount of the underlying
 *      asset to msg.sender (the Vault) before returning. The Vault verifies the
 *      transfer by checking its balance delta.
 */
interface IStrategy {
    /// @notice Pull `amount` of the underlying asset from the strategy back to the Vault.
    /// @param amount Amount of the underlying asset to return to the caller.
    /// @return withdrawn Actual amount returned to the caller.
    function withdraw(uint256 amount) external returns (uint256 withdrawn);
}
```

## Contract: MockUSDC.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Mock USDC token for testing purposes
 * @dev Implements ERC20 with 6 decimals to match real USDC
 */
contract MockUSDC is ERC20 {
    uint8 private constant DECIMALS = 6;

    constructor() ERC20("USD Coin", "USDC") {
        // Mint 1 million USDC for testing
        _mint(msg.sender, 1_000_000 * 10 ** DECIMALS);
    }

    /**
     * @notice Returns the number of decimals (6 for USDC)
     */
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /**
     * @notice Mint tokens for testing
     * @param to Address to receive tokens
     * @param amount Amount to mint (in USDC units with 6 decimals)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from caller
     * @param amount Amount to burn
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
```

## Contract: ReenteringStrategy.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IStrategy} from "./IStrategy.sol";

interface IVaultDeposit {
    function deposit(uint256 assets, address receiver) external returns (uint256);
}

/**
 * @title ReenteringStrategy
 * @notice A strategy that re-enters the vault during `withdraw`. Test-only.
 * @dev Exists to prove that `Vault.setStrategy` is guarded. A strategy is an
 *      owner-chosen contract, but "the owner chose it" is not a security
 *      property: the strategy still runs arbitrary code while the vault waits
 *      on it. This one returns less than it was asked for and makes up the
 *      difference by depositing the vault's own assets back into the vault,
 *      which inflates the balance delta the vault measures and would mint
 *      shares that were never paid for. With `nonReentrant` on the entry point
 *      the re-entrant `deposit` reverts, so the whole call reverts.
 *
 *      Written to pass the same Slither gate as production code: an attacker
 *      mock that needs the gate relaxed to compile is a mock that quietly
 *      widens what the gate lets through.
 */
contract ReenteringStrategy is IStrategy {
    error TransferFailed();
    error ApprovalFailed();
    error ZeroAddress();

    IERC20 public immutable asset;
    address public immutable vault;

    /// @notice How much of the requested amount to actually return (0 = all).
    uint256 public returnAmount;
    /// @notice How much to deposit back into the vault mid-call (0 = none).
    uint256 public reenterAmount;
    /// @notice Shares the re-entrant deposit minted, for the test to assert on.
    uint256 public sharesStolen;

    constructor(IERC20 asset_, address vault_) {
        if (address(asset_) == address(0)) revert ZeroAddress();
        if (vault_ == address(0)) revert ZeroAddress();
        asset = asset_;
        vault = vault_;
    }

    function arm(uint256 returnAmount_, uint256 reenterAmount_) external {
        returnAmount = returnAmount_;
        reenterAmount = reenterAmount_;
    }

    // Re-entering the caller is the whole purpose of this contract, so the
    // finding is correct and the code is deliberately what it flags. Suppressed
    // rather than filtered out of the config, so the gate keeps analysing every
    // other mock in this directory.
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign,reentrancy-events
    function withdraw(uint256 amount) external override returns (uint256) {
        uint256 toReturn = returnAmount == 0 ? amount : returnAmount;
        if (!asset.transfer(vault, toReturn)) revert TransferFailed();

        if (reenterAmount > 0) {
            if (!asset.approve(vault, reenterAmount)) revert ApprovalFailed();
            sharesStolen = IVaultDeposit(vault).deposit(reenterAmount, address(this));
        }

        return toReturn;
    }
}
```

## Contract: Vault.sol (primary target)

```solidity
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
```

## Tests: Vault.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Vault", function () {
  // Fixture for deployment
  async function deployVaultFixture() {
    const [owner, user1, user2, strategy] =
      await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDCFactory.deploy();
    await usdc.waitForDeployment();

    // Deploy Vault
    const VaultFactory = await ethers.getContractFactory("Vault");
    const vault = await VaultFactory.deploy(
      await usdc.getAddress(),
      "Swiss DeFi Vault",
      "sdvUSDC"
    );
    await vault.waitForDeployment();

    // Mint USDC to users for testing (1M USDC each with 6 decimals)
    const amount = ethers.parseUnits("1000000", 6);
    await usdc.mint(user1.address, amount);
    await usdc.mint(user2.address, amount);

    return { vault, usdc, owner, user1, user2, strategy };
  }

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      const { vault } = await loadFixture(deployVaultFixture);

      expect(await vault.name()).to.equal("Swiss DeFi Vault");
      expect(await vault.symbol()).to.equal("sdvUSDC");
    });

    it("Should set the correct owner", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      expect(await vault.owner()).to.equal(owner.address);
    });

    it("Should set the correct asset", async function () {
      const { vault, usdc } = await loadFixture(deployVaultFixture);

      expect(await vault.asset()).to.equal(await usdc.getAddress());
    });

    it("Should initialize with zero total assets", async function () {
      const { vault } = await loadFixture(deployVaultFixture);

      expect(await vault.totalAssets()).to.equal(0);
    });

    it("Should initialize with max deposit limit", async function () {
      const { vault } = await loadFixture(deployVaultFixture);

      expect(await vault.depositCap()).to.equal(ethers.MaxUint256);
    });

    it("Should revert if asset address is zero", async function () {
      const VaultFactory = await ethers.getContractFactory("Vault");

      await expect(
        VaultFactory.deploy(
          ethers.ZeroAddress,
          "Swiss DeFi Vault",
          "sdvUSDC"
        )
      ).to.be.revertedWithCustomError(VaultFactory, "ZeroAddress");
    });
  });

  describe("Deposits", function () {
    it("Should allow users to deposit USDC", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6); // 1000 USDC

      // Approve vault to spend USDC
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      // Deposit
      await expect(
        vault.connect(user1).deposit(depositAmount, user1.address)
      )
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, depositAmount, depositAmount);

      // Check vault shares
      expect(await vault.balanceOf(user1.address)).to.equal(depositAmount);
    });

    it("Should mint correct amount of shares on first deposit", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // First deposit should mint 1:1 shares
      expect(await vault.balanceOf(user1.address)).to.equal(depositAmount);
      expect(await vault.totalAssets()).to.equal(depositAmount);
    });

    it("Should handle multiple deposits correctly", async function () {
      const { vault, usdc, user1, user2 } = await loadFixture(
        deployVaultFixture
      );

      const amount1 = ethers.parseUnits("1000", 6);
      const amount2 = ethers.parseUnits("500", 6);

      // User1 deposits
      await usdc.connect(user1).approve(await vault.getAddress(), amount1);
      await vault.connect(user1).deposit(amount1, user1.address);

      // User2 deposits
      await usdc.connect(user2).approve(await vault.getAddress(), amount2);
      await vault.connect(user2).deposit(amount2, user2.address);

      expect(await vault.balanceOf(user1.address)).to.equal(amount1);
      expect(await vault.balanceOf(user2.address)).to.equal(amount2);
      expect(await vault.totalAssets()).to.equal(amount1 + amount2);
    });

    it("Should revert when depositing zero amount", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).deposit(0, user1.address)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("Should revert when receiver is zero address", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      await expect(
        vault.connect(user1).deposit(depositAmount, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("Should revert when exceeding max deposit", async function () {
      const { vault, usdc, user1, owner } = await loadFixture(
        deployVaultFixture
      );

      const maxDep = ethers.parseUnits("100", 6);
      await vault.connect(owner).setDepositCap(maxDep);

      const depositAmount = ethers.parseUnits("200", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      await expect(
        vault.connect(user1).deposit(depositAmount, user1.address)
      ).to.be.revertedWithCustomError(vault, "ExceedsDepositCap");
    });

    it("Should revert deposits when emergency shutdown is active", async function () {
      const { vault, usdc, user1, owner } = await loadFixture(
        deployVaultFixture
      );

      // Trigger emergency shutdown
      await vault.connect(owner).triggerEmergencyShutdown();

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      await expect(
        vault.connect(user1).deposit(depositAmount, user1.address)
      ).to.be.revertedWithCustomError(vault, "EmergencyShutdownActive");
    });
  });

  describe("Withdrawals", function () {
    it("Should allow users to withdraw assets", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);

      // Deposit first
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const initialBalance = await usdc.balanceOf(user1.address);

      // Withdraw
      await vault
        .connect(user1)
        .withdraw(depositAmount, user1.address, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
      expect(await usdc.balanceOf(user1.address)).to.equal(
        initialBalance + depositAmount
      );
    });

    it("Should allow users to redeem shares", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const shares = await vault.balanceOf(user1.address);
      const initialBalance = await usdc.balanceOf(user1.address);

      // Redeem all shares
      await vault.connect(user1).redeem(shares, user1.address, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
      expect(await usdc.balanceOf(user1.address)).to.be.greaterThan(
        initialBalance
      );
    });

    it("Should revert when withdrawing zero amount", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).withdraw(0, user1.address, user1.address)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("Should revert when redeeming zero shares", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).redeem(0, user1.address, user1.address)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("Should allow withdrawals even during emergency shutdown", async function () {
      const { vault, usdc, user1, owner } = await loadFixture(
        deployVaultFixture
      );

      const depositAmount = ethers.parseUnits("1000", 6);

      // Deposit first
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Trigger emergency shutdown
      await vault.connect(owner).triggerEmergencyShutdown();

      // Should still allow withdrawal
      await expect(
        vault
          .connect(user1)
          .withdraw(depositAmount, user1.address, user1.address)
      ).to.not.be.reverted;
    });
  });

  describe("Minting", function () {
    it("Should allow users to mint shares", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const shares = ethers.parseUnits("1000", 6);

      // Approve enough USDC
      await usdc
        .connect(user1)
        .approve(await vault.getAddress(), ethers.parseUnits("10000", 6));

      // Mint shares
      await vault.connect(user1).mint(shares, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(shares);
    });

    it("Should revert when minting zero shares", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).mint(0, user1.address)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("Should revert minting when emergency shutdown is active", async function () {
      const { vault, usdc, user1, owner } = await loadFixture(
        deployVaultFixture
      );

      // Trigger emergency shutdown
      await vault.connect(owner).triggerEmergencyShutdown();

      const shares = ethers.parseUnits("1000", 6);
      await usdc
        .connect(user1)
        .approve(await vault.getAddress(), ethers.parseUnits("10000", 6));

      await expect(
        vault.connect(user1).mint(shares, user1.address)
      ).to.be.revertedWithCustomError(vault, "EmergencyShutdownActive");
    });
  });

  describe("Strategy Management", function () {
    it("Should allow owner to set strategy", async function () {
      const { vault, owner, strategy } = await loadFixture(deployVaultFixture);

      await expect(vault.connect(owner).setStrategy(strategy.address))
        .to.emit(vault, "StrategyUpdated")
        .withArgs(ethers.ZeroAddress, strategy.address);

      expect(await vault.strategy()).to.equal(strategy.address);
    });

    it("Should revert when non-owner tries to set strategy", async function () {
      const { vault, user1, strategy } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).setStrategy(strategy.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("Should revert when setting zero address as strategy", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(owner).setStrategy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("Should allow owner to allocate assets to strategy", async function () {
      const { vault, usdc, owner, user1, strategy } = await loadFixture(
        deployVaultFixture
      );

      // Set strategy
      await vault.connect(owner).setStrategy(strategy.address);

      // User deposits
      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Owner allocates to strategy
      const allocateAmount = ethers.parseUnits("500", 6);
      await expect(vault.connect(owner).allocateToStrategy(allocateAmount))
        .to.emit(vault, "AssetsAllocated")
        .withArgs(allocateAmount, allocateAmount);

      expect(await vault.totalAllocated()).to.equal(allocateAmount);
      expect(await usdc.balanceOf(strategy.address)).to.equal(allocateAmount);
    });

    it("Should revert allocation when no strategy is set", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(
        deployVaultFixture
      );

      // User deposits
      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Try to allocate without strategy
      const allocateAmount = ethers.parseUnits("500", 6);
      await expect(
        vault.connect(owner).allocateToStrategy(allocateAmount)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("Should revert when allocating zero amount", async function () {
      const { vault, owner, strategy } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setStrategy(strategy.address);

      await expect(
        vault.connect(owner).allocateToStrategy(0)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("Should revert when allocating more than available", async function () {
      const { vault, usdc, owner, user1, strategy } = await loadFixture(
        deployVaultFixture
      );

      await vault.connect(owner).setStrategy(strategy.address);

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const allocateAmount = ethers.parseUnits("2000", 6);
      await expect(
        vault.connect(owner).allocateToStrategy(allocateAmount)
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set max deposit", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      const newMax = ethers.parseUnits("10000", 6);

      await expect(vault.connect(owner).setDepositCap(newMax))
        .to.emit(vault, "DepositCapUpdated")
        .withArgs(ethers.MaxUint256, newMax);

      expect(await vault.depositCap()).to.equal(newMax);
    });

    it("Should revert when non-owner tries to set max deposit", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      const newMax = ethers.parseUnits("10000", 6);

      await expect(
        vault.connect(user1).setDepositCap(newMax)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("Should allow owner to trigger emergency shutdown", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      await expect(vault.connect(owner).triggerEmergencyShutdown())
        .to.emit(vault, "EmergencyShutdown")
        .withArgs(owner.address);

      expect(await vault.emergencyShutdown()).to.equal(true);
    });

    it("Should revert when non-owner tries to trigger shutdown", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).triggerEmergencyShutdown()
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("Should allow owner to harvest", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      // Fast forward time by 2 hours
      await ethers.provider.send("evm_increaseTime", [2 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      await expect(vault.connect(owner).harvest()).to.emit(vault, "Harvest");
    });

    it("Should revert harvest if called too soon", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      // Try to harvest immediately (within 1 hour)
      await expect(
        vault.connect(owner).harvest()
      ).to.be.revertedWithCustomError(vault, "HarvestTooSoon");
    });
  });

  describe("View Functions", function () {
    it("Should return correct vault info", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const [totalAssets, totalShares, pricePerShare] =
        await vault.getVaultInfo();

      expect(totalAssets).to.equal(depositAmount);
      expect(totalShares).to.equal(depositAmount);
      expect(pricePerShare).to.equal(ethers.parseEther("1")); // 1:1 ratio
    });

    it("Should return correct total assets with strategy allocation", async function () {
      const { vault, usdc, owner, user1, strategy } = await loadFixture(
        deployVaultFixture
      );

      await vault.connect(owner).setStrategy(strategy.address);

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const allocateAmount = ethers.parseUnits("500", 6);
      await vault.connect(owner).allocateToStrategy(allocateAmount);

      // Total assets should include both vault balance and allocated
      expect(await vault.totalAssets()).to.equal(depositAmount);
    });
  });

  describe("Reentrancy Protection", function () {
    // A strategy is chosen by the owner, but it still runs arbitrary code while
    // the vault waits on it. These exercise a real attacker contract rather
    // than asserting that a modifier is present in the source.
    async function deployReenteringFixture() {
      const base = await loadFixture(deployVaultFixture);
      const { vault, usdc, owner, user1 } = base;

      const Factory = await ethers.getContractFactory("ReenteringStrategy");
      const attacker = await Factory.deploy(
        await usdc.getAddress(),
        await vault.getAddress()
      );
      await attacker.waitForDeployment();

      // An honest depositor funds the vault, then the owner attaches the
      // strategy and allocates everything to it.
      const deposited = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), deposited);
      await vault.connect(user1).deposit(deposited, user1.address);
      await vault.connect(owner).setStrategy(await attacker.getAddress());
      await vault.connect(owner).allocateToStrategy(deposited);

      return { ...base, attacker, deposited };
    }

    it("Should stop a strategy that re-enters deposit() during setStrategy", async function () {
      const { vault, usdc, owner, user1, attacker, deposited } =
        await loadFixture(deployReenteringFixture);

      // Return 600 of the 1000 and cover the missing 400 by depositing the
      // vault's own assets back in. Unguarded, the balance delta reads as the
      // full 1000 and the strategy walks away holding 400 USDC worth of shares.
      const returned = ethers.parseUnits("600", 6);
      const reentered = ethers.parseUnits("400", 6);
      await attacker.arm(returned, reentered);

      const Factory = await ethers.getContractFactory("ReenteringStrategy");
      const replacement = await Factory.deploy(
        await usdc.getAddress(),
        await vault.getAddress()
      );
      await replacement.waitForDeployment();

      await expect(
        vault.connect(owner).setStrategy(await replacement.getAddress())
      ).to.be.reverted;

      // Nothing moved: the strategy holds no shares and the depositor's claim
      // is intact.
      expect(await vault.balanceOf(await attacker.getAddress())).to.equal(0);
      expect(await vault.balanceOf(user1.address)).to.equal(deposited);
      expect(await vault.totalAllocated()).to.equal(deposited);
    });

    it("Should let an honest strategy be replaced", async function () {
      const { vault, usdc, owner, user1, attacker, deposited } =
        await loadFixture(deployReenteringFixture);

      // Same path with no re-entry: returns everything, deposits nothing.
      await attacker.arm(0, 0);

      const Factory = await ethers.getContractFactory("ReenteringStrategy");
      const replacement = await Factory.deploy(
        await usdc.getAddress(),
        await vault.getAddress()
      );
      await replacement.waitForDeployment();

      await vault.connect(owner).setStrategy(await replacement.getAddress());

      expect(await vault.totalAllocated()).to.equal(0);
      expect(await vault.balanceOf(user1.address)).to.equal(deposited);
      expect(await vault.balanceOf(await attacker.getAddress())).to.equal(0);
    });
  });

  describe("Gas Optimization", function () {
    it("Should use reasonable gas for deposit", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      const tx = await vault
        .connect(user1)
        .deposit(depositAmount, user1.address);
      const receipt = await tx.wait();

      // Gas should be less than 300k (target from specs)
      expect(receipt .gasUsed).to.be.lessThan(300000);
    });
  });

  // These exercise the ERC-4626 entry point `maxDeposit(address)` itself, not
  // the `depositCap` storage variable behind it. Before the rename the public
  // variable produced a zero-arg `maxDeposit()` getter that sat alongside the
  // inherited `maxDeposit(address)`; the standard function still returned
  // type(uint256).max no matter what the cap was set to, so an integrator
  // reading the vault through the ERC-4626 interface got a limit that the
  // vault did not honour.
  describe("ERC-4626 conformance: maxDeposit(address)", function () {
    it("Should not expose a zero-argument maxDeposit() alongside the standard one", async function () {
      const { vault } = await loadFixture(deployVaultFixture);

      const overloads = vault.interface.fragments.filter(
        (f) => f.type === "function" && f.name === "maxDeposit"
      );

      expect(overloads).to.have.lengthOf(1);
      expect((overloads[0]).inputs).to.have.lengthOf(1);
      expect((overloads[0]).inputs[0].type).to.equal("address");
    });

    it("Should report the uncapped default through the standard function", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      expect(await vault.maxDeposit(user1.address)).to.equal(ethers.MaxUint256);
    });

    it("Should report the configured cap through the standard function", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      const cap = ethers.parseUnits("100", 6);
      await vault.connect(owner).setDepositCap(cap);

      expect(await vault.maxDeposit(user1.address)).to.equal(cap);
    });

    it("Should return 0 while emergency shutdown is active", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));
      await vault.connect(owner).triggerEmergencyShutdown();

      // EIP-4626: if deposits are disabled, even temporarily, maxDeposit MUST return 0.
      expect(await vault.maxDeposit(user1.address)).to.equal(0);
    });

    it("Should accept a deposit of exactly maxDeposit(receiver)", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));

      const limit = await vault.maxDeposit(user1.address);
      await usdc.connect(user1).approve(await vault.getAddress(), limit);

      await expect(vault.connect(user1).deposit(limit, user1.address)).to.not.be
        .reverted;
    });

    it("Should reject a deposit of maxDeposit(receiver) + 1", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));

      const limit = await vault.maxDeposit(user1.address);
      const overLimit = limit + 1n;
      await usdc.connect(user1).approve(await vault.getAddress(), overLimit);

      await expect(
        vault.connect(user1).deposit(overLimit, user1.address)
      ).to.be.revertedWithCustomError(vault, "ExceedsDepositCap");
    });

    it("Should track setDepositCap so the standard function never drifts", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      for (const raw of ["1", "500", "1000000"]) {
        const cap = ethers.parseUnits(raw, 6);
        await vault.connect(owner).setDepositCap(cap);
        expect(await vault.maxDeposit(user1.address)).to.equal(cap);
        expect(await vault.maxDeposit(user1.address)).to.equal(
          await vault.depositCap()
        );
      }
    });

    it("Should never revert, per EIP-4626, even with a zero cap", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(0);

      expect(await vault.maxDeposit(user1.address)).to.equal(0);
      expect(await vault.maxDeposit(ethers.ZeroAddress)).to.equal(0);
    });
  });

  // Companion to the block above, for the mint() side of the same cap.
  // maxDeposit(address) was fixed first; mint() kept going straight to
  // super.mint() without consulting any limit, and maxMint(address) was left
  // inherited, so it advertised type(uint256).max regardless of the cap. The
  // deposit cap was therefore bypassable simply by entering through mint().
  describe("ERC-4626 conformance: maxMint(address) and mint()", function () {
    it("Should not expose a zero-argument maxMint() alongside the standard one", async function () {
      const { vault } = await loadFixture(deployVaultFixture);

      const overloads = vault.interface.fragments.filter(
        (f) => f.type === "function" && f.name === "maxMint"
      );

      expect(overloads).to.have.lengthOf(1);
      expect((overloads[0]).inputs).to.have.lengthOf(1);
      expect((overloads[0]).inputs[0].type).to.equal("address");
    });

    it("Should report the uncapped default through the standard function", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      // Converting type(uint256).max would overflow, so an uncapped vault
      // reports the sentinel directly.
      expect(await vault.maxMint(user1.address)).to.equal(ethers.MaxUint256);
    });

    it("Should report the configured cap, converted to shares", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      const cap = ethers.parseUnits("100", 6);
      await vault.connect(owner).setDepositCap(cap);

      expect(await vault.maxMint(user1.address)).to.equal(
        await vault.convertToShares(cap)
      );
    });

    it("Should return 0 while emergency shutdown is active", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));
      await vault.connect(owner).triggerEmergencyShutdown();

      // Mirrors maxDeposit: if minting is disabled, maxMint MUST return 0.
      expect(await vault.maxMint(user1.address)).to.equal(0);
    });

    it("Should accept a mint of exactly maxMint(receiver)", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));

      const limit = await vault.maxMint(user1.address);
      await usdc
        .connect(user1)
        .approve(await vault.getAddress(), await vault.previewMint(limit));

      await expect(vault.connect(user1).mint(limit, user1.address)).to.not.be
        .reverted;
    });

    it("Should reject a mint of maxMint(receiver) + 1", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));

      const overLimit = (await vault.maxMint(user1.address)) + 1n;
      await usdc
        .connect(user1)
        .approve(await vault.getAddress(), await vault.previewMint(overLimit));

      await expect(
        vault.connect(user1).mint(overLimit, user1.address)
      ).to.be.revertedWithCustomError(vault, "ExceedsDepositCap");
    });

    it("Should not let mint() bypass the deposit cap that deposit() enforces", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      const cap = ethers.parseUnits("100", 6);
      await vault.connect(owner).setDepositCap(cap);

      // The exact regression: an amount of assets deposit() refuses must not
      // become reachable by converting it to shares and calling mint().
      const overCap = cap + ethers.parseUnits("1", 6);
      const sharesForOverCap = await vault.convertToShares(overCap);

      await usdc.connect(user1).approve(await vault.getAddress(), overCap * 2n);

      await expect(
        vault.connect(user1).deposit(overCap, user1.address)
      ).to.be.revertedWithCustomError(vault, "ExceedsDepositCap");

      await expect(
        vault.connect(user1).mint(sharesForOverCap, user1.address)
      ).to.be.revertedWithCustomError(vault, "ExceedsDepositCap");
    });

    it("Should never pull more assets than the cap for maxMint() shares", async function () {
      const { vault, usdc, owner, user1, user2 } = await loadFixture(
        deployVaultFixture
      );

      // Move the exchange rate off 1:1 so the share/asset conversion actually
      // rounds, then confirm the rounding cannot round *up* through the cap.
      await usdc
        .connect(user1)
        .approve(await vault.getAddress(), ethers.parseUnits("300", 6));
      await vault
        .connect(user1)
        .deposit(ethers.parseUnits("300", 6), user1.address);
      await usdc
        .connect(user2)
        .transfer(await vault.getAddress(), ethers.parseUnits("77", 6));

      for (const raw of ["1", "13", "100", "999"]) {
        const cap = ethers.parseUnits(raw, 6);
        await vault.connect(owner).setDepositCap(cap);

        const limit = await vault.maxMint(user2.address);
        expect(await vault.previewMint(limit)).to.be.lte(cap);
      }
    });

    it("Should never revert, per EIP-4626, even with a zero cap", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(0);

      expect(await vault.maxMint(user1.address)).to.equal(0);
      expect(await vault.maxMint(ethers.ZeroAddress)).to.equal(0);
    });
  });

  // The withdrawal side is deliberately NOT capped and deliberately stays open
  // during emergency shutdown — the shutdown blocks new deposits only. These
  // tests pin that intent down so a future "consistency" change cannot quietly
  // trap depositors' funds.
  describe("ERC-4626 conformance: maxWithdraw / maxRedeem", function () {
    it("Should report the holder's full balance", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const assets = ethers.parseUnits("250", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), assets);
      await vault.connect(user1).deposit(assets, user1.address);

      expect(await vault.maxRedeem(user1.address)).to.equal(
        await vault.balanceOf(user1.address)
      );
      expect(await vault.maxWithdraw(user1.address)).to.equal(
        await vault.convertToAssets(await vault.balanceOf(user1.address))
      );
    });

    it("Should stay open during emergency shutdown", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      const assets = ethers.parseUnits("250", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), assets);
      await vault.connect(user1).deposit(assets, user1.address);

      await vault.connect(owner).triggerEmergencyShutdown();

      // Withdrawals remain allowed, so these must NOT drop to 0.
      expect(await vault.maxRedeem(user1.address)).to.be.gt(0);
      expect(await vault.maxWithdraw(user1.address)).to.be.gt(0);

      await expect(
        vault
          .connect(user1)
          .redeem(
            await vault.maxRedeem(user1.address),
            user1.address,
            user1.address
          )
      ).to.not.be.reverted;
    });

    it("Should not revert for an address holding nothing", async function () {
      const { vault, user2 } = await loadFixture(deployVaultFixture);

      expect(await vault.maxWithdraw(user2.address)).to.equal(0);
      expect(await vault.maxRedeem(user2.address)).to.equal(0);
      expect(await vault.maxWithdraw(ethers.ZeroAddress)).to.equal(0);
      expect(await vault.maxRedeem(ethers.ZeroAddress)).to.equal(0);
    });
  });

  // EIP-4626: preview functions MUST NOT revert because of vault-specific
  // user or global limits. They answer "what would this trade give me", which
  // stays meaningful even when the cap would refuse the trade.
  describe("ERC-4626 conformance: preview functions ignore the cap", function () {
    it("Should quote amounts above the deposit cap without reverting", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      const cap = ethers.parseUnits("100", 6);
      await vault.connect(owner).setDepositCap(cap);

      const overCap = cap * 10n;
      expect(await vault.previewDeposit(overCap)).to.be.gt(0);
      expect(await vault.previewMint(await vault.convertToShares(overCap))).to.be.gt(
        0
      );
    });

    it("Should quote without reverting while emergency shutdown is active", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).triggerEmergencyShutdown();

      const assets = ethers.parseUnits("10", 6);
      expect(await vault.previewDeposit(assets)).to.be.gt(0);
      expect(await vault.previewMint(assets)).to.be.gt(0);
      expect(await vault.previewWithdraw(assets)).to.be.gt(0);
      expect(await vault.previewRedeem(assets)).to.be.gt(0);
    });
  });
});
```
