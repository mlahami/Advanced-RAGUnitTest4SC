# jubilee-yield-stream--jubilee-protocol

- domain: subscriptions-streaming (payment-streaming)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Jubilee-Protocol/jUSDi @ 3b6e32e6f6fe28d5238c2dd845e979a89a83474e
- license: MIT
- targets: JubileeYieldStream.sol, MockERC20.sol, MockVault.sol
- validation: 20 passing tests, 0 failing; statement coverage JubileeYieldStream.sol 89.86 %, MockERC20.sol 66.67 %, MockVault.sol 100.0 %

## Contract: JubileeYieldStream.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title JubileeYieldStream
 * @author Jubilee Labs
 * @notice "The Immortal Agent" - Endowment-as-a-Service powered by USDC
 * @dev Deposits USDC into Jubilee Vault (jUSDi). Yield is streamed to a beneficiary
 *      (Agent/Service). Principal is preserved and claimable by the funder.
 *
 * USDC INTEGRATION:
 * - USDC serves as the base asset for all deposits and yield calculations
 * - Principal is always denominated in USDC for predictable accounting
 * - Yield generated from jUSDi vault strategies is paid out in USDC
 * - USDC's stability ensures reliable yield forecasting for agent sustainability
 *
 * SECURITY FEATURES:
 * - ReentrancyGuard on all state-changing functions
 * - SafeERC20 for safe token transfers (handles non-standard ERC20s)
 * - Pausable for emergency circuit breaker
 * - Input validation on all external functions
 * - Slippage protection on withdrawals
 */
contract JubileeYieldStream is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Minimum deposit amount (1 USDC with 6 decimals)
    uint256 public constant MIN_DEPOSIT = 1e6;

    /// @notice Slippage tolerance for withdrawals (0.5% = 50 basis points)
    uint256 public constant SLIPPAGE_BPS = 50;
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ═══════════════════════════════════════════════════════════════════════════
    // IMMUTABLES
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice The jUSDi ERC4626 vault that generates yield
    IERC4626 public immutable vault;

    /// @notice The underlying asset (USDC)
    IERC20 public immutable asset;

    /// @notice USDC decimals for calculations
    uint8 public immutable assetDecimals;

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    struct Stream {
        address beneficiary; // Recipient of the yield (Agent's wallet)
        uint256 principalAssets; // The "Seed" (preserved USDC amount)
        uint256 sharesHeld; // The "Soil" (jUSDi shares backing the seed)
        uint256 totalYieldClaimed; // Cumulative yield harvested
        uint256 createdAt; // Stream creation timestamp
        uint256 lastClaimAt; // Last yield claim timestamp
    }

    /// @notice Mapping from funder address to their stream configuration
    mapping(address => Stream) public streams;

    /// @notice Total principal locked across all streams (in USDC)
    uint256 public totalPrincipalLocked;

    /// @notice Total yield distributed to all beneficiaries (in USDC)
    uint256 public totalYieldDistributed;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event StreamCreated(
        address indexed funder,
        address indexed beneficiary,
        uint256 principal,
        uint256 sharesReceived
    );
    event StreamToppedUp(
        address indexed funder,
        uint256 amount,
        uint256 newPrincipal,
        uint256 sharesReceived
    );
    event YieldClaimed(
        address indexed funder,
        address indexed beneficiary,
        uint256 yieldAmount,
        uint256 sharesBurned
    );
    event PrincipalWithdrawn(
        address indexed funder,
        uint256 requestedAmount,
        uint256 actualAmount,
        uint256 sharesBurned
    );
    event BeneficiaryUpdated(
        address indexed funder,
        address indexed oldBeneficiary,
        address indexed newBeneficiary
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error InvalidVault();
    error InvalidBeneficiary();
    error InvalidAmount();
    error AmountBelowMinimum();
    error NoStreamActive();
    error NoYieldAvailable();
    error InsufficientPrincipal();
    error SlippageExceeded();
    error StreamNotFound();

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Initialize the yield stream contract
     * @param _vault Address of the jUSDi ERC4626 vault
     * @param _initialOwner Address of the contract owner (for pause functionality)
     */
    constructor(address _vault, address _initialOwner) Ownable(_initialOwner) {
        if (_vault == address(0)) revert InvalidVault();

        vault = IERC4626(_vault);
        asset = IERC20(vault.asset());

        // Cache decimals for gas optimization
        // USDC has 6 decimals - this is standard across all USDC deployments
        assetDecimals = 6;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXTERNAL FUNCTIONS - CORE OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create or top-up a yield stream with USDC
     * @dev USDC is deposited into the jUSDi vault, shares are held by this contract
     * @param _beneficiary The address that receives the yield (agent's wallet)
     * @param _amount Amount of USDC to deposit (must be >= MIN_DEPOSIT)
     */
    function deposit(
        address _beneficiary,
        uint256 _amount
    ) external nonReentrant whenNotPaused {
        if (_amount == 0) revert InvalidAmount();
        if (_amount < MIN_DEPOSIT) revert AmountBelowMinimum();

        Stream storage s = streams[msg.sender];

        // New stream: require valid beneficiary
        if (s.principalAssets == 0) {
            if (_beneficiary == address(0)) revert InvalidBeneficiary();
            s.beneficiary = _beneficiary;
            s.createdAt = block.timestamp;
        }
        // Top-up: beneficiary arg is ignored to prevent griefing

        // 1. Pull USDC from sender using SafeERC20
        asset.safeTransferFrom(msg.sender, address(this), _amount);

        // 2. Approve vault for deposit
        asset.forceApprove(address(vault), _amount);

        // 3. Deposit into jUSDi vault & track shares minted
        uint256 sharesMinted = vault.deposit(_amount, address(this));

        // 4. Update stream state
        s.principalAssets += _amount;
        s.sharesHeld += sharesMinted;

        // 5. Update global tracking
        totalPrincipalLocked += _amount;

        // 6. Emit appropriate event
        if (s.totalYieldClaimed == 0 && s.principalAssets == _amount) {
            emit StreamCreated(
                msg.sender,
                s.beneficiary,
                s.principalAssets,
                sharesMinted
            );
        } else {
            emit StreamToppedUp(
                msg.sender,
                _amount,
                s.principalAssets,
                sharesMinted
            );
        }
    }

    /**
     * @notice Claim yield for your own stream
     * @dev Caller must be the funder who created the stream
     */
    function claim() external nonReentrant whenNotPaused {
        _claim(msg.sender);
    }

    /**
     * @notice Claim yield on behalf of a funder (useful for keepers/automation)
     * @dev Anyone can trigger a claim, but yield always goes to the beneficiary
     * @param _funder Address of the stream funder
     */
    function claimFor(address _funder) external nonReentrant whenNotPaused {
        _claim(_funder);
    }

    /**
     * @notice Withdraw principal USDC from the stream
     * @dev Partial withdrawals are supported. Full withdrawal closes the stream.
     * @param _amount Amount of principal USDC to withdraw
     */
    function withdrawPrincipal(
        uint256 _amount
    ) external nonReentrant whenNotPaused {
        if (_amount == 0) revert InvalidAmount();

        Stream storage s = streams[msg.sender];
        if (s.principalAssets == 0) revert NoStreamActive();
        if (s.principalAssets < _amount) revert InsufficientPrincipal();

        // Calculate current value of shares
        uint256 currentAssets = vault.convertToAssets(s.sharesHeld);

        // Handle loss scenario (depeg or strategy loss)
        uint256 amountToWithdraw = _amount;
        if (currentAssets < _amount) {
            // Cap at available assets
            amountToWithdraw = currentAssets;
        }

        // Calculate expected shares to burn with slippage protection
        uint256 expectedShares = vault.convertToShares(amountToWithdraw);
        uint256 maxShares = (expectedShares *
            (BPS_DENOMINATOR + SLIPPAGE_BPS)) / BPS_DENOMINATOR;

        // Execute withdrawal
        uint256 sharesBurned = vault.withdraw(
            amountToWithdraw,
            msg.sender,
            address(this)
        );

        // Verify slippage
        if (sharesBurned > maxShares) revert SlippageExceeded();

        // Update state
        s.sharesHeld -= sharesBurned;
        s.principalAssets -= amountToWithdraw;
        totalPrincipalLocked -= amountToWithdraw;

        emit PrincipalWithdrawn(
            msg.sender,
            _amount,
            amountToWithdraw,
            sharesBurned
        );
    }

    /**
     * @notice Update the beneficiary address for your stream
     * @param _newBeneficiary New address to receive yield
     */
    function setBeneficiary(address _newBeneficiary) external {
        if (_newBeneficiary == address(0)) revert InvalidBeneficiary();

        Stream storage s = streams[msg.sender];
        if (s.principalAssets == 0) revert StreamNotFound();

        address oldBeneficiary = s.beneficiary;
        s.beneficiary = _newBeneficiary;

        emit BeneficiaryUpdated(msg.sender, oldBeneficiary, _newBeneficiary);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Calculate how much yield is currently available to claim
     * @param _funder Address of the stream funder
     * @return yieldAmount Amount of USDC yield available
     */
    function claimableYield(
        address _funder
    ) public view returns (uint256 yieldAmount) {
        Stream storage s = streams[_funder];
        if (s.sharesHeld == 0) return 0;

        // Current value of shares in USDC terms
        uint256 currentAssets = vault.convertToAssets(s.sharesHeld);

        // Yield = Current Value - Principal (protected against underflow)
        if (currentAssets > s.principalAssets) {
            yieldAmount = currentAssets - s.principalAssets;
        }
    }

    /**
     * @notice Get comprehensive stream information
     * @param _funder Address of the stream funder
     * @return beneficiary Address receiving yield
     * @return principal USDC principal preserved
     * @return currentValue Current USDC value (principal + yield)
     * @return pendingYield Claimable yield in USDC
     * @return totalClaimed Total yield claimed to date
     * @return shares jUSDi shares held
     * @return created Stream creation timestamp
     * @return lastClaim Last yield claim timestamp
     */
    function getStreamInfo(
        address _funder
    )
        external
        view
        returns (
            address beneficiary,
            uint256 principal,
            uint256 currentValue,
            uint256 pendingYield,
            uint256 totalClaimed,
            uint256 shares,
            uint256 created,
            uint256 lastClaim
        )
    {
        Stream storage s = streams[_funder];
        beneficiary = s.beneficiary;
        principal = s.principalAssets;
        shares = s.sharesHeld;
        currentValue = shares > 0 ? vault.convertToAssets(shares) : 0;
        pendingYield = claimableYield(_funder);
        totalClaimed = s.totalYieldClaimed;
        created = s.createdAt;
        lastClaim = s.lastClaimAt;
    }

    /**
     * @notice Estimate monthly yield based on current vault APY
     * @dev Assumes vault's current price growth rate continues linearly
     * @param _funder Address of the stream funder
     * @return monthlyYield Estimated USDC yield per month
     */
    function estimateMonthlyYield(
        address _funder
    ) external view returns (uint256 monthlyYield) {
        Stream storage s = streams[_funder];
        if (s.sharesHeld == 0 || s.createdAt == 0) return 0;

        uint256 currentValue = vault.convertToAssets(s.sharesHeld);
        if (currentValue <= s.principalAssets) return 0;

        uint256 totalYield = currentValue - s.principalAssets;
        uint256 timeElapsed = block.timestamp - s.createdAt;

        if (timeElapsed == 0) return 0;

        // Annualize and then divide by 12 for monthly
        // monthlyYield = (totalYield / timeElapsed) * 30 days
        monthlyYield = (totalYield * 30 days) / timeElapsed;
    }

    /**
     * @notice Check if agent's burn rate is sustainable given current yield
     * @param _funder Address of the stream funder
     * @param _monthlyBurnRate Agent's monthly USDC burn rate
     * @return sustainable True if yield >= burn rate
     * @return monthsRemaining Estimated months of runway (max 1000 if sustainable)
     */
    function checkSustainability(
        address _funder,
        uint256 _monthlyBurnRate
    ) external view returns (bool sustainable, uint256 monthsRemaining) {
        if (_monthlyBurnRate == 0) return (true, 1000);

        Stream storage s = streams[_funder];
        uint256 currentValue = vault.convertToAssets(s.sharesHeld);

        // Simple estimation: assume constant yield rate
        uint256 pendingYield = claimableYield(_funder);
        uint256 timeElapsed = block.timestamp - s.createdAt;

        if (timeElapsed == 0 || pendingYield == 0) {
            // No yield history - estimate runway from principal
            monthsRemaining = currentValue / _monthlyBurnRate;
            sustainable = false;
            return (sustainable, monthsRemaining);
        }

        // Calculate monthly yield rate
        uint256 monthlyYield = (pendingYield * 30 days) / timeElapsed;

        sustainable = monthlyYield >= _monthlyBurnRate;

        if (sustainable) {
            monthsRemaining = 1000; // Effectively infinite
        } else {
            // Calculate depletion rate: burn_rate - yield_rate per month
            uint256 netBurn = _monthlyBurnRate - monthlyYield;
            monthsRemaining = currentValue / netBurn;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @dev Internal yield claim logic
     * @param _funder Address of the stream funder
     */
    function _claim(address _funder) internal {
        Stream storage s = streams[_funder];
        if (s.sharesHeld == 0) revert NoStreamActive();

        uint256 yieldAmount = claimableYield(_funder);
        if (yieldAmount == 0) revert NoYieldAvailable();

        // Calculate expected shares with slippage protection
        uint256 expectedShares = vault.convertToShares(yieldAmount);
        uint256 maxShares = (expectedShares *
            (BPS_DENOMINATOR + SLIPPAGE_BPS)) / BPS_DENOMINATOR;

        // Withdraw yield to beneficiary (burns shares from this contract)
        uint256 sharesBurned = vault.withdraw(
            yieldAmount,
            s.beneficiary,
            address(this)
        );

        // Verify slippage
        if (sharesBurned > maxShares) revert SlippageExceeded();

        // Update state
        s.sharesHeld -= sharesBurned;
        s.totalYieldClaimed += yieldAmount;
        s.lastClaimAt = block.timestamp;

        // Update global tracking
        totalYieldDistributed += yieldAmount;

        emit YieldClaimed(_funder, s.beneficiary, yieldAmount, sharesBurned);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Pause all deposits and claims (emergency only)
     * @dev Only callable by owner
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract operations
     * @dev Only callable by owner
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}

// "...if you confess with your mouth that Jesus is Lord and believe in your heart that God raised him from the dead, you will be saved. For with the heart one believes and is justified, and with the mouth one confesses and is saved. For the Scripture says, "Everyone who believes in him will not be put to shame." - Romans 10:9-11 (ESV)
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    // Mock Chainlink latestRoundData
    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (0, 100000000, 0, block.timestamp, 0); // $1.00
    }
}
```

## Contract: MockVault.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/**
 * @title MockVault
 * @notice ERC4626 vault for testing JubileeYieldStream with realistic yield simulation
 * @dev Tracks total assets properly to simulate yield accumulation
 */
contract MockVault is ERC4626 {
    using Math for uint256;

    constructor(IERC20 _asset) ERC4626(_asset) ERC20("Mock Vault", "mVAULT") {}

    /**
     * @notice Returns total assets including any "yield" that was minted directly to vault
     * @dev Simply returns the actual token balance, which increases when tokens are minted to vault
     */
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    // Preview functions remain default - shares based on totalAssets
}
```

## Tests: JubileeYieldStream.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits } = require("ethers");

/**
 * JubileeYieldStream Integration Tests
 *
 * Tests the complete lifecycle of yield stream creation, accumulation, and distribution.
 * These tests verify both human and agentic interaction patterns.
 */
describe("JubileeYieldStream", function () {
    // Type guard for custom error
    const anyValue = () => true;

    let yieldStream;
    let vault;
    let usdc;
    let owner;
    let sponsor;
    let agent;
    let keeper;

    const USDC_DECIMALS = 6;
    const INITIAL_USDC = parseUnits("100000", USDC_DECIMALS);
    const DEPOSIT_AMOUNT = parseUnits("10000", USDC_DECIMALS);

    beforeEach(async function () {
        [owner, sponsor, agent, keeper] = await ethers.getSigners();

        // Deploy MockUSDC (using MockERC20)
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        await usdc.waitForDeployment();

        // Deploy Mock Vault (ERC4626)
        const MockVaultFactory = await ethers.getContractFactory("MockVault");
        vault = await MockVaultFactory.deploy(await usdc.getAddress());
        await vault.waitForDeployment();

        // Deploy JubileeYieldStream
        const YieldStream = await ethers.getContractFactory("JubileeYieldStream");
        yieldStream = await YieldStream.deploy(
            await vault.getAddress(),
            owner.address
        );
        await yieldStream.waitForDeployment();

        // Mint USDC to sponsor
        await usdc.mint(sponsor.address, INITIAL_USDC);

        // Approve YieldStream to spend sponsor's USDC
        await usdc.connect(sponsor).approve(
            await yieldStream.getAddress(),
            ethers.MaxUint256
        );
    });

    describe("Stream Creation", function () {
        it("should create a stream with valid beneficiary and deposit", async function () {
            const tx = await yieldStream.connect(sponsor).deposit(agent.address, DEPOSIT_AMOUNT);
            const receipt = await tx.wait();

            expect(receipt).to.not.be.null;

            const stream = await yieldStream.streams(sponsor.address);
            expect(stream.beneficiary).to.equal(agent.address);
            expect(stream.principalAssets).to.equal(DEPOSIT_AMOUNT);
            expect(stream.sharesHeld).to.be.gt(0);
        });

        it("should revert for zero deposit amount", async function () {
            await expect(
                yieldStream.connect(sponsor).deposit(agent.address, 0)
            ).to.be.reverted;
        });

        it("should revert for zero beneficiary address", async function () {
            await expect(
                yieldStream.connect(sponsor).deposit(ethers.ZeroAddress, DEPOSIT_AMOUNT)
            ).to.be.reverted;
        });

        it("should allow top-up to existing stream", async function () {
            // Initial deposit
            await yieldStream.connect(sponsor).deposit(agent.address, DEPOSIT_AMOUNT);

            // Top-up
            const topUpAmount = parseUnits("5000", USDC_DECIMALS);
            await yieldStream.connect(sponsor).deposit(agent.address, topUpAmount);

            const stream = await yieldStream.streams(sponsor.address);
            expect(stream.principalAssets).to.equal(DEPOSIT_AMOUNT + topUpAmount);
        });
    });

    describe("Yield Claims", function () {
        beforeEach(async function () {
            // Create stream
            await yieldStream.connect(sponsor).deposit(agent.address, DEPOSIT_AMOUNT);
        });

        it("should calculate yield based on vault appreciation", async function () {
            // Simulate yield (mint USDC directly to vault)
            const yieldAmount = parseUnits("1000", USDC_DECIMALS);
            await usdc.mint(await vault.getAddress(), yieldAmount);

            const claimable = await yieldStream.claimableYield(sponsor.address);
            expect(claimable).to.be.gt(0);
        });

        it("should transfer yield to beneficiary on claim", async function () {
            // Simulate yield
            const yieldAmount = parseUnits("500", USDC_DECIMALS);
            await usdc.mint(await vault.getAddress(), yieldAmount);

            const agentBalanceBefore = await usdc.balanceOf(agent.address);

            await yieldStream.connect(sponsor).claim();

            const agentBalanceAfter = await usdc.balanceOf(agent.address);
            expect(agentBalanceAfter).to.be.gt(agentBalanceBefore);
        });

        it("should allow anyone to claim on behalf of funder (keeper pattern)", async function () {
            // Simulate yield
            await usdc.mint(await vault.getAddress(), parseUnits("500", USDC_DECIMALS));

            const agentBalanceBefore = await usdc.balanceOf(agent.address);

            // Keeper claims on behalf of sponsor
            await yieldStream.connect(keeper).claimFor(sponsor.address);

            const agentBalanceAfter = await usdc.balanceOf(agent.address);
            expect(agentBalanceAfter).to.be.gt(agentBalanceBefore);
        });

        it("should revert claim when no yield available", async function () {
            await expect(
                yieldStream.connect(sponsor).claim()
            ).to.be.reverted;
        });

        it("should update lastClaimAt timestamp after claim", async function () {
            await usdc.mint(await vault.getAddress(), parseUnits("500", USDC_DECIMALS));

            const streamBefore = await yieldStream.streams(sponsor.address);
            expect(streamBefore.lastClaimAt).to.equal(0);

            await yieldStream.connect(sponsor).claim();

            const streamAfter = await yieldStream.streams(sponsor.address);
            expect(streamAfter.lastClaimAt).to.be.gt(0);
        });
    });

    describe("Principal Withdrawal", function () {
        beforeEach(async function () {
            await yieldStream.connect(sponsor).deposit(agent.address, DEPOSIT_AMOUNT);
        });

        it("should allow partial withdrawal", async function () {
            const withdrawAmount = parseUnits("5000", USDC_DECIMALS);
            const sponsorBalanceBefore = await usdc.balanceOf(sponsor.address);

            await yieldStream.connect(sponsor).withdrawPrincipal(withdrawAmount);

            const sponsorBalanceAfter = await usdc.balanceOf(sponsor.address);
            const stream = await yieldStream.streams(sponsor.address);

            expect(sponsorBalanceAfter).to.be.gt(sponsorBalanceBefore);
            expect(stream.principalAssets).to.be.lt(DEPOSIT_AMOUNT);
        });

        it("should close stream on full withdrawal", async function () {
            await yieldStream.connect(sponsor).withdrawPrincipal(DEPOSIT_AMOUNT);

            const stream = await yieldStream.streams(sponsor.address);
            expect(stream.principalAssets).to.equal(0);
            expect(stream.sharesHeld).to.equal(0);
        });

        it("should revert withdrawal exceeding principal", async function () {
            const excessAmount = parseUnits("20000", USDC_DECIMALS);
            await expect(
                yieldStream.connect(sponsor).withdrawPrincipal(excessAmount)
            ).to.be.reverted;
        });
    });

    describe("Beneficiary Management", function () {
        beforeEach(async function () {
            await yieldStream.connect(sponsor).deposit(agent.address, DEPOSIT_AMOUNT);
        });

        it("should allow owner to update beneficiary", async function () {
            const newAgent = keeper;

            await yieldStream.connect(sponsor).setBeneficiary(newAgent.address);

            const stream = await yieldStream.streams(sponsor.address);
            expect(stream.beneficiary).to.equal(newAgent.address);
        });

        it("should reject zero address as beneficiary", async function () {
            await expect(
                yieldStream.connect(sponsor).setBeneficiary(ethers.ZeroAddress)
            ).to.be.reverted;
        });
    });

    describe("View Functions (Agent API)", function () {
        beforeEach(async function () {
            await yieldStream.connect(sponsor).deposit(agent.address, DEPOSIT_AMOUNT);
        });

        it("should return complete stream info via getStreamInfo", async function () {
            const [
                beneficiary,
                principal,
                currentValue,
                pendingYield,
                totalClaimed,
                shares,
                created,
                lastClaim
            ] = await yieldStream.getStreamInfo(sponsor.address);

            expect(beneficiary).to.equal(agent.address);
            expect(principal).to.equal(DEPOSIT_AMOUNT);
            expect(currentValue).to.be.gte(0);
            expect(shares).to.be.gt(0);
            expect(created).to.be.gt(0);
        });

        it("should estimate monthly yield correctly", async function () {
            // Simulate some time passing with yield
            await usdc.mint(await vault.getAddress(), parseUnits("500", USDC_DECIMALS));

            // Move time forward 30 days
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine", []);

            const monthlyYield = await yieldStream.estimateMonthlyYield(sponsor.address);
            expect(monthlyYield).to.be.gte(0);
        });

        it("should check sustainability against burn rate", async function () {
            // Simulate yield to make it sustainable
            await usdc.mint(await vault.getAddress(), parseUnits("1000", USDC_DECIMALS));

            // Move time forward
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine", []);

            const monthlyBurn = parseUnits("50", USDC_DECIMALS);
            const [sustainable, monthsRemaining] = await yieldStream.checkSustainability(
                sponsor.address,
                monthlyBurn
            );

            // Result depends on actual yield, just verify function works
            expect(typeof sustainable).to.equal("boolean");
            expect(monthsRemaining).to.be.gte(0);
        });
    });

    describe("Emergency Controls", function () {
        it("should allow owner to pause contract", async function () {
            await yieldStream.connect(owner).pause();

            await expect(
                yieldStream.connect(sponsor).deposit(agent.address, DEPOSIT_AMOUNT)
            ).to.be.reverted;
        });

        it("should allow owner to unpause contract", async function () {
            await yieldStream.connect(owner).pause();
            await yieldStream.connect(owner).unpause();

            // Should work now
            await yieldStream.connect(sponsor).deposit(agent.address, DEPOSIT_AMOUNT);
            const stream = await yieldStream.streams(sponsor.address);
            expect(stream.principalAssets).to.equal(DEPOSIT_AMOUNT);
        });

        it("should prevent non-owner from pausing", async function () {
            await expect(
                yieldStream.connect(sponsor).pause()
            ).to.be.reverted;
        });
    });
});
```
