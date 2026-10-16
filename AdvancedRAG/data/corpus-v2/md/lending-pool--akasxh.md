# lending-pool--akasxh

- domain: lending-collateral (lending)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Akasxh/polkalend @ 63a9bab21dce964eadc6a07539add72f896439ec
- license: MIT
- targets: LendingPool.sol, FlashLoan.sol, InterestRateModel.sol, PolkaToken.sol, PriceOracle.sol, IFlashLoanReceiver.sol, ILendingPool.sol, FailingFlashLoanReceiver.sol, MockFlashLoanReceiver.sol
- validation: 24 passing tests, 0 failing; statement coverage LendingPool.sol 98.31 %, FlashLoan.sol 100.0 %, InterestRateModel.sol 85.71 %, PolkaToken.sol 66.67 %, PriceOracle.sol 100.0 %, IFlashLoanReceiver.sol 100.0 %, ILendingPool.sol 100.0 %, FailingFlashLoanReceiver.sol 100.0 %, MockFlashLoanReceiver.sol 100.0 %

## Contract: FailingFlashLoanReceiver.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IFlashLoanReceiver.sol";

/**
 * @dev Test-only flash-loan receiver that always returns false (simulates callback failure).
 */
contract FailingFlashLoanReceiver is IFlashLoanReceiver {
    function executeOperation(
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bool) {
        return false;
    }
}
```

## Contract: FlashLoan.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IFlashLoanReceiver.sol";

/**
 * @title FlashLoan
 * @notice Mixin that adds flash-loan capability to the LendingPool.
 *         Inheriting contract must expose `_getPoolBalance` and hold tokens.
 */
abstract contract FlashLoan {
    using SafeERC20 for IERC20;

    uint256 public constant FLASH_LOAN_FEE_BPS = 9; // 0.09 %
    uint256 private constant BPS = 10_000;

    event FlashLoanExecuted(
        address indexed receiver,
        address indexed token,
        uint256 amount,
        uint256 fee
    );

    /**
     * @dev Execute a flash loan. The receiver must repay amount + fee
     *      within the same transaction.
     */
    function _executeFlashLoan(
        address receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(balanceBefore >= amount, "FlashLoan: insufficient liquidity");

        uint256 fee = (amount * FLASH_LOAN_FEE_BPS) / BPS;

        // Transfer tokens to receiver
        IERC20(token).safeTransfer(receiver, amount);

        // Invoke callback
        require(
            IFlashLoanReceiver(receiver).executeOperation(token, amount, fee, data),
            "FlashLoan: callback failed"
        );

        // Verify repayment
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        require(
            balanceAfter >= balanceBefore + fee,
            "FlashLoan: not repaid"
        );

        emit FlashLoanExecuted(receiver, token, amount, fee);
    }
}
```

## Contract: IFlashLoanReceiver.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFlashLoanReceiver {
    /**
     * @dev Called by the LendingPool after transferring flash-loaned tokens.
     * @param token  The ERC-20 token address that was borrowed.
     * @param amount The amount that was borrowed.
     * @param fee    The fee that must be repaid on top of `amount`.
     * @param data   Arbitrary data forwarded from the flash-loan caller.
     * @return True if the operation succeeded and the pool can pull repayment.
     */
    function executeOperation(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bool);
}
```

## Contract: ILendingPool.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILendingPool {
    // ---- Events ----
    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    event Borrow(address indexed user, address indexed token, uint256 amount);
    event Repay(address indexed user, address indexed token, uint256 amount);
    event Liquidate(
        address indexed liquidator,
        address indexed borrower,
        address indexed collateralToken,
        uint256 debtRepaid,
        uint256 collateralSeized
    );
    event FlashLoan(
        address indexed receiver,
        address indexed token,
        uint256 amount,
        uint256 fee
    );

    // ---- Core functions ----
    function deposit(address token, uint256 amount) external;
    function withdraw(address token, uint256 amount) external;
    function borrow(address token, uint256 amount) external;
    function repay(address token, uint256 amount) external;
    function flashLoan(
        address receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external;
}
```

## Contract: InterestRateModel.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title InterestRateModel
 * @notice Dynamic interest-rate model based on pool utilization.
 *
 *  Utilization U = totalBorrows / totalDeposits  (scaled 1e18 = 100 %)
 *
 *  Below the kink (optimal utilization):
 *      borrowRate = baseRate + U * slope1 / 1e18
 *
 *  Above the kink:
 *      borrowRate = baseRate + kink * slope1 / 1e18
 *                   + (U - kink) * slope2 / 1e18
 *
 *  Supply rate = borrowRate * U / 1e18 * (1 - reserveFactor)
 *
 *  All rates are per-second, scaled by 1e18.
 */
contract InterestRateModel {
    uint256 public constant SCALE = 1e18;

    uint256 public baseRate;       // per-second base borrow rate
    uint256 public slope1;         // slope below kink
    uint256 public slope2;         // slope above kink (steeper)
    uint256 public optimalUtilization; // kink point (e.g. 0.8e18 = 80 %)

    constructor(
        uint256 _baseRate,
        uint256 _slope1,
        uint256 _slope2,
        uint256 _optimalUtilization
    ) {
        baseRate = _baseRate;
        slope1 = _slope1;
        slope2 = _slope2;
        optimalUtilization = _optimalUtilization;
    }

    /**
     * @notice Calculate the current borrow rate (per second, 1e18 scaled).
     */
    function getBorrowRate(
        uint256 totalDeposits,
        uint256 totalBorrows
    ) external view returns (uint256) {
        if (totalDeposits == 0) return baseRate;

        uint256 utilization = (totalBorrows * SCALE) / totalDeposits;

        if (utilization <= optimalUtilization) {
            return baseRate + (utilization * slope1) / SCALE;
        }

        uint256 normalRate = baseRate + (optimalUtilization * slope1) / SCALE;
        uint256 excessUtil = utilization - optimalUtilization;
        return normalRate + (excessUtil * slope2) / SCALE;
    }

    /**
     * @notice Calculate the current supply (deposit) rate.
     * @param reserveFactor Protocol reserve share (1e18 = 100 %).
     */
    function getSupplyRate(
        uint256 totalDeposits,
        uint256 totalBorrows,
        uint256 reserveFactor
    ) external view returns (uint256) {
        if (totalDeposits == 0) return 0;

        uint256 utilization = (totalBorrows * SCALE) / totalDeposits;
        uint256 borrowRate = this.getBorrowRate(totalDeposits, totalBorrows);

        uint256 rateToSuppliers = (borrowRate * (SCALE - reserveFactor)) / SCALE;
        return (rateToSuppliers * utilization) / SCALE;
    }
}
```

## Contract: LendingPool.sol (primary target)

```solidity
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
```

## Contract: MockFlashLoanReceiver.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IFlashLoanReceiver.sol";

/**
 * @dev Test-only flash-loan receiver that simply repays the loan + fee.
 */
contract MockFlashLoanReceiver is IFlashLoanReceiver {
    address public pool;

    constructor(address _pool) {
        pool = _pool;
    }

    function executeOperation(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata /* data */
    ) external override returns (bool) {
        // Repay: approve pool to pull amount + fee
        IERC20(token).approve(pool, amount + fee);
        IERC20(token).transfer(pool, amount + fee);
        return true;
    }
}
```

## Contract: PolkaToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PolkaToken
 * @notice ERC-20 governance token for the PolkaLend protocol.
 *         Used for fee discounts, governance voting, and liquidity mining rewards.
 */
contract PolkaToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 100_000_000 ether; // 100 M

    constructor() ERC20("PolkaLend Token", "PLEND") Ownable(msg.sender) {
        // Mint initial supply to deployer (treasury)
        _mint(msg.sender, 10_000_000 ether); // 10 M initial
    }

    /**
     * @notice Mint new tokens (capped at MAX_SUPPLY). Owner-only.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "PolkaToken: cap exceeded");
        _mint(to, amount);
    }
}
```

## Contract: PriceOracle.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PriceOracle
 * @notice Simple price oracle for the PolkaLend protocol.
 *         In production this would be replaced by a Chainlink / DIA feed.
 *         Prices are stored as USD value with 18 decimals (1e18 = $1).
 */
contract PriceOracle is Ownable {
    mapping(address => uint256) private _prices;

    event PriceUpdated(address indexed token, uint256 price);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Set the USD price for a token.
     */
    function setPrice(address token, uint256 price) external onlyOwner {
        require(price > 0, "Oracle: price must be > 0");
        _prices[token] = price;
        emit PriceUpdated(token, price);
    }

    /**
     * @notice Batch-set prices for multiple tokens.
     */
    function setPrices(
        address[] calldata tokens,
        uint256[] calldata prices
    ) external onlyOwner {
        require(tokens.length == prices.length, "Oracle: length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            require(prices[i] > 0, "Oracle: price must be > 0");
            _prices[tokens[i]] = prices[i];
            emit PriceUpdated(tokens[i], prices[i]);
        }
    }

    /**
     * @notice Get the USD price for a token.
     */
    function getPrice(address token) external view returns (uint256) {
        uint256 price = _prices[token];
        require(price > 0, "Oracle: price not set");
        return price;
    }
}
```

## Tests: EdgeCases.test.js

```javascript
const { expect } = require("chai");
const hre = require("hardhat");

describe("PolkaLend — Edge Cases", function () {
  let owner, alice, bob;
  let tokenA, tokenB, tokenC, oracle, irm, pool;

  const SCALE = 10n ** 18n;

  beforeEach(async function () {
    [owner, alice, bob] = await hre.ethers.getSigners();

    const Token = await hre.ethers.getContractFactory("PolkaToken");
    tokenA = await Token.deploy();
    await tokenA.waitForDeployment();
    tokenB = await Token.deploy();
    await tokenB.waitForDeployment();
    tokenC = await Token.deploy();
    await tokenC.waitForDeployment();

    await tokenA.transfer(alice.address, hre.ethers.parseEther("100000"));
    await tokenB.transfer(bob.address, hre.ethers.parseEther("100000"));
    await tokenB.transfer(alice.address, hre.ethers.parseEther("10000"));
    await tokenC.transfer(alice.address, hre.ethers.parseEther("100000"));

    const Oracle = await hre.ethers.getContractFactory("PriceOracle");
    oracle = await Oracle.deploy();
    await oracle.waitForDeployment();

    await oracle.setPrice(await tokenA.getAddress(), SCALE);
    await oracle.setPrice(await tokenB.getAddress(), SCALE);
    await oracle.setPrice(await tokenC.getAddress(), SCALE);

    const IRM = await hre.ethers.getContractFactory("InterestRateModel");
    irm = await IRM.deploy(
      634195839n,
      3170979198n,
      31709791983n,
      hre.ethers.parseEther("0.8")
    );
    await irm.waitForDeployment();

    const Pool = await hre.ethers.getContractFactory("LendingPool");
    pool = await Pool.deploy(await irm.getAddress(), await oracle.getAddress());
    await pool.waitForDeployment();

    await pool.addMarket(
      await tokenA.getAddress(),
      hre.ethers.parseEther("0.75"),
      hre.ethers.parseEther("0.1")
    );
    await pool.addMarket(
      await tokenB.getAddress(),
      hre.ethers.parseEther("0.75"),
      hre.ethers.parseEther("0.1")
    );
    await pool.addMarket(
      await tokenC.getAddress(),
      hre.ethers.parseEther("0.75"),
      hre.ethers.parseEther("0.1")
    );
  });

  // --- Test 13: PriceOracle batch pricing ---
  it("13. should batch-set prices via setPrices()", async function () {
    const addrA = await tokenA.getAddress();
    const addrB = await tokenB.getAddress();
    const addrC = await tokenC.getAddress();

    const priceA = hre.ethers.parseEther("2.5");
    const priceB = hre.ethers.parseEther("0.01");
    const priceC = hre.ethers.parseEther("1500");

    await oracle.setPrices(
      [addrA, addrB, addrC],
      [priceA, priceB, priceC]
    );

    expect(await oracle.getPrice(addrA)).to.equal(priceA);
    expect(await oracle.getPrice(addrB)).to.equal(priceB);
    expect(await oracle.getPrice(addrC)).to.equal(priceC);
  });

  // --- Test 14: PolkaToken supply cap ---
  it("14. should revert minting beyond MAX_SUPPLY", async function () {
    // tokenA is a PolkaToken with 10M initial supply, MAX_SUPPLY = 100M
    // Try to mint 91M more (would exceed 100M cap)
    const excess = hre.ethers.parseEther("91000000");
    await expect(
      tokenA.mint(owner.address, excess)
    ).to.be.revertedWith("PolkaToken: cap exceeded");
  });

  // --- Test 15: PolkaToken unauthorized mint ---
  it("15. should revert non-owner mint on PolkaToken", async function () {
    await expect(
      tokenA.connect(alice).mint(alice.address, hre.ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(tokenA, "OwnableUnauthorizedAccount");
  });

  // --- Test 16: Zero deposit rejection ---
  it("16. should reject deposit of zero amount", async function () {
    await expect(
      pool.connect(alice).deposit(await tokenA.getAddress(), 0)
    ).to.be.revertedWith("Pool: zero amount");
  });

  // --- Test 17: Zero borrow rejection ---
  it("17. should reject borrow of zero amount", async function () {
    await expect(
      pool.connect(alice).borrow(await tokenB.getAddress(), 0)
    ).to.be.revertedWith("Pool: zero amount");
  });

  // --- Test 18: Flash loan insufficient liquidity ---
  it("18. should revert flash loan exceeding pool balance", async function () {
    // Deposit 1000 tokenA into pool
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    const MockReceiver = await hre.ethers.getContractFactory("MockFlashLoanReceiver");
    const receiver = await MockReceiver.deploy(await pool.getAddress());
    await receiver.waitForDeployment();

    // Try to flash loan 5000 (more than pool has)
    await expect(
      pool.flashLoan(
        await receiver.getAddress(),
        await tokenA.getAddress(),
        hre.ethers.parseEther("5000"),
        "0x"
      )
    ).to.be.revertedWith("FlashLoan: insufficient liquidity");
  });

  // --- Test 19: Flash loan callback failure ---
  it("19. should revert flash loan when callback returns false", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    const FailReceiver = await hre.ethers.getContractFactory("FailingFlashLoanReceiver");
    const failReceiver = await FailReceiver.deploy();
    await failReceiver.waitForDeployment();

    await expect(
      pool.flashLoan(
        await failReceiver.getAddress(),
        await tokenA.getAddress(),
        hre.ethers.parseEther("100"),
        "0x"
      )
    ).to.be.revertedWith("FlashLoan: callback failed");
  });

  // --- Test 20: Liquidation of healthy position ---
  it("20. should revert liquidation of a healthy borrower", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    // Alice borrows 500 against 1000 collateral (healthy)
    await pool.connect(alice).borrow(await tokenB.getAddress(), hre.ethers.parseEther("500"));
    expect(await pool.isHealthy(alice.address)).to.be.true;

    const repayAmt = hre.ethers.parseEther("100");
    await tokenB.connect(bob).approve(await pool.getAddress(), repayAmt);
    await expect(
      pool.connect(bob).liquidate(
        alice.address,
        await tokenB.getAddress(),
        await tokenA.getAddress(),
        repayAmt
      )
    ).to.be.revertedWith("Pool: borrower is healthy");
  });

  // --- Test 21: Liquidation exceeding 50% of debt ---
  it("21. should revert liquidation repaying more than 50% of debt", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    await pool.connect(alice).borrow(await tokenB.getAddress(), hre.ethers.parseEther("700"));

    // Make alice undercollateralized
    await oracle.setPrice(await tokenA.getAddress(), hre.ethers.parseEther("0.5"));
    expect(await pool.isHealthy(alice.address)).to.be.false;

    // Try to repay 400 (> 50% of 700 = 350)
    const repayAmt = hre.ethers.parseEther("400");
    await tokenB.connect(bob).approve(await pool.getAddress(), repayAmt);
    await expect(
      pool.connect(bob).liquidate(
        alice.address,
        await tokenB.getAddress(),
        await tokenA.getAddress(),
        repayAmt
      )
    ).to.be.revertedWith("Pool: repay > 50%");
  });

  // --- Test 22: Supply rate calculation ---
  it("22. should calculate supply rate correctly", async function () {
    const totalDeposits = hre.ethers.parseEther("1000");
    const totalBorrows = hre.ethers.parseEther("500");
    const reserveFactor = hre.ethers.parseEther("0.1");

    const supplyRate = await irm.getSupplyRate(totalDeposits, totalBorrows, reserveFactor);
    const borrowRate = await irm.getBorrowRate(totalDeposits, totalBorrows);

    // supplyRate = borrowRate * (1 - reserveFactor) * utilization / SCALE
    // utilization = 500/1000 = 0.5
    const utilization = (totalBorrows * SCALE) / totalDeposits;
    const expectedSupply = (borrowRate * (SCALE - reserveFactor) / SCALE) * utilization / SCALE;

    expect(supplyRate).to.equal(expectedSupply);
    expect(supplyRate).to.be.gt(0n);
  });

  // --- Test 23: Multiple market deposits ---
  it("23. should track deposits across multiple markets", async function () {
    const amountA = hre.ethers.parseEther("500");
    const amountC = hre.ethers.parseEther("300");

    await tokenA.connect(alice).approve(await pool.getAddress(), amountA);
    await pool.connect(alice).deposit(await tokenA.getAddress(), amountA);

    await tokenC.connect(alice).approve(await pool.getAddress(), amountC);
    await pool.connect(alice).deposit(await tokenC.getAddress(), amountC);

    expect(await pool.userDeposits(alice.address, await tokenA.getAddress())).to.equal(amountA);
    expect(await pool.userDeposits(alice.address, await tokenC.getAddress())).to.equal(amountC);

    // Collateral value = (500 * 1 * 0.75) + (300 * 1 * 0.75) = 375 + 225 = 600
    const expectedCollateral = hre.ethers.parseEther("600");
    expect(await pool.getCollateralValue(alice.address)).to.equal(expectedCollateral);
  });

  // --- Test 24: Market re-listing rejection ---
  it("24. should reject adding an already listed market", async function () {
    await expect(
      pool.addMarket(
        await tokenA.getAddress(),
        hre.ethers.parseEther("0.75"),
        hre.ethers.parseEther("0.1")
      )
    ).to.be.revertedWith("Pool: already listed");
  });
});
```

## Tests: LendingPool.test.js

```javascript
const { expect } = require("chai");
const hre = require("hardhat");

describe("PolkaLend", function () {
  let owner, alice, bob;
  let tokenA, tokenB, oracle, irm, pool;

  const SCALE = 10n ** 18n;

  beforeEach(async function () {
    [owner, alice, bob] = await hre.ethers.getSigners();

    // Deploy two PolkaToken instances as test tokens
    const Token = await hre.ethers.getContractFactory("PolkaToken");
    tokenA = await Token.deploy();
    await tokenA.waitForDeployment();
    tokenB = await Token.deploy();
    await tokenB.waitForDeployment();

    // Transfer tokens to alice & bob
    await tokenA.transfer(alice.address, hre.ethers.parseEther("100000"));
    await tokenB.transfer(bob.address, hre.ethers.parseEther("100000"));

    // Deploy oracle
    const Oracle = await hre.ethers.getContractFactory("PriceOracle");
    oracle = await Oracle.deploy();
    await oracle.waitForDeployment();

    // Both tokens = $1
    await oracle.setPrice(await tokenA.getAddress(), SCALE);
    await oracle.setPrice(await tokenB.getAddress(), SCALE);

    // Deploy interest rate model
    const IRM = await hre.ethers.getContractFactory("InterestRateModel");
    irm = await IRM.deploy(
      634195839n,      // ~2 % APR base (per sec)
      3170979198n,     // ~10 % APR slope1
      31709791983n,    // ~100 % APR slope2
      hre.ethers.parseEther("0.8")
    );
    await irm.waitForDeployment();

    // Deploy pool
    const Pool = await hre.ethers.getContractFactory("LendingPool");
    pool = await Pool.deploy(await irm.getAddress(), await oracle.getAddress());
    await pool.waitForDeployment();

    // List both markets (75 % CF, 10 % reserve)
    await pool.addMarket(
      await tokenA.getAddress(),
      hre.ethers.parseEther("0.75"),
      hre.ethers.parseEther("0.1")
    );
    await pool.addMarket(
      await tokenB.getAddress(),
      hre.ethers.parseEther("0.75"),
      hre.ethers.parseEther("0.1")
    );
  });

  it("1. should allow deposits", async function () {
    const amount = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), amount);
    await pool.connect(alice).deposit(await tokenA.getAddress(), amount);

    expect(await pool.userDeposits(alice.address, await tokenA.getAddress())).to.equal(amount);
    const market = await pool.markets(await tokenA.getAddress());
    expect(market.totalDeposits).to.equal(amount);
  });

  it("2. should allow withdrawals", async function () {
    const amount = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), amount);
    await pool.connect(alice).deposit(await tokenA.getAddress(), amount);

    await pool.connect(alice).withdraw(await tokenA.getAddress(), hre.ethers.parseEther("500"));
    expect(await pool.userDeposits(alice.address, await tokenA.getAddress())).to.equal(
      hre.ethers.parseEther("500")
    );
  });

  it("3. should allow borrowing against collateral", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    const borrowAmt = hre.ethers.parseEther("500");
    await pool.connect(alice).borrow(await tokenB.getAddress(), borrowAmt);

    expect(await pool.userBorrows(alice.address, await tokenB.getAddress())).to.equal(borrowAmt);
  });

  it("4. should reject borrow exceeding collateral factor", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    await expect(
      pool.connect(alice).borrow(await tokenB.getAddress(), hre.ethers.parseEther("800"))
    ).to.be.revertedWith("Pool: undercollateralized");
  });

  it("5. should allow repayment", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    const borrowAmt = hre.ethers.parseEther("500");
    await pool.connect(alice).borrow(await tokenB.getAddress(), borrowAmt);

    await tokenB.connect(alice).approve(await pool.getAddress(), hre.ethers.parseEther("200"));
    await pool.connect(alice).repay(await tokenB.getAddress(), hre.ethers.parseEther("200"));

    expect(await pool.userBorrows(alice.address, await tokenB.getAddress())).to.equal(
      hre.ethers.parseEther("300")
    );
  });

  it("6. should report correct collateral and borrow values", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    expect(await pool.getCollateralValue(alice.address)).to.equal(
      hre.ethers.parseEther("750")
    );
    expect(await pool.getBorrowValue(alice.address)).to.equal(0);
  });

  it("7. should prevent withdrawal that would undercollateralize", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    await pool.connect(alice).borrow(await tokenB.getAddress(), hre.ethers.parseEther("700"));

    await expect(
      pool.connect(alice).withdraw(await tokenA.getAddress(), hre.ethers.parseEther("100"))
    ).to.be.revertedWith("Pool: undercollateralized");
  });

  it("8. should execute flash loans", async function () {
    const MockReceiver = await hre.ethers.getContractFactory("MockFlashLoanReceiver");
    const receiver = await MockReceiver.deploy(await pool.getAddress());
    await receiver.waitForDeployment();

    const depositAmt = hre.ethers.parseEther("10000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    // Give receiver tokens to pay fee
    await tokenA.transfer(await receiver.getAddress(), hre.ethers.parseEther("100"));

    const flashAmt = hre.ethers.parseEther("5000");
    await pool.flashLoan(
      await receiver.getAddress(),
      await tokenA.getAddress(),
      flashAmt,
      "0x"
    );

    const poolBal = await tokenA.balanceOf(await pool.getAddress());
    expect(poolBal).to.be.gt(depositAmt);
  });

  it("9. should calculate interest rates correctly", async function () {
    const baseRate = await irm.getBorrowRate(hre.ethers.parseEther("1000"), 0);
    expect(baseRate).to.equal(634195839n);

    const midRate = await irm.getBorrowRate(
      hre.ethers.parseEther("1000"),
      hre.ethers.parseEther("500")
    );
    expect(midRate).to.be.gt(baseRate);

    const highRate = await irm.getBorrowRate(
      hre.ethers.parseEther("1000"),
      hre.ethers.parseEther("900")
    );
    expect(highRate).to.be.gt(midRate);
  });

  it("10. should allow liquidation of undercollateralized positions", async function () {
    const depositAmt = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), depositAmt);
    await pool.connect(alice).deposit(await tokenA.getAddress(), depositAmt);

    await tokenB.connect(bob).approve(await pool.getAddress(), depositAmt);
    await pool.connect(bob).deposit(await tokenB.getAddress(), depositAmt);

    await pool.connect(alice).borrow(await tokenB.getAddress(), hre.ethers.parseEther("700"));

    // Price of tokenA drops -> alice becomes undercollateralized
    await oracle.setPrice(await tokenA.getAddress(), hre.ethers.parseEther("0.5"));

    expect(await pool.isHealthy(alice.address)).to.be.false;

    const repayAmt = hre.ethers.parseEther("200");
    await tokenB.connect(bob).approve(await pool.getAddress(), repayAmt);
    await pool.connect(bob).liquidate(
      alice.address,
      await tokenB.getAddress(),
      await tokenA.getAddress(),
      repayAmt
    );

    expect(await pool.userBorrows(alice.address, await tokenB.getAddress())).to.equal(
      hre.ethers.parseEther("500")
    );
  });

  it("11. should reject deposit of unlisted token", async function () {
    const fakeAddr = "0x0000000000000000000000000000000000000001";
    await expect(
      pool.deposit(fakeAddr, hre.ethers.parseEther("100"))
    ).to.be.revertedWith("Pool: not listed");
  });

  it("12. should emit correct events on deposit", async function () {
    const amount = hre.ethers.parseEther("1000");
    await tokenA.connect(alice).approve(await pool.getAddress(), amount);

    await expect(pool.connect(alice).deposit(await tokenA.getAddress(), amount))
      .to.emit(pool, "Deposit")
      .withArgs(alice.address, await tokenA.getAddress(), amount);
  });
});
```
