# mitigated-vault--harshanandhan

- domain: lending-collateral (flash-loan)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Harshanandhan/flash-loan-risk-lab @ 1f24ff345e3799614a11dcecbe7f8da20a74146c
- license: MIT
- targets: MitigatedVault.sol, FlashLoanPool.sol, LabAttacker.sol, LabOracle.sol, MockERC20.sol, VulnerableVault.sol
- validation: 6 passing tests, 0 failing; statement coverage MitigatedVault.sol 76.19 %, FlashLoanPool.sol 100.0 %, LabAttacker.sol 100.0 %, LabOracle.sol 100.0 %, MockERC20.sol 92.86 %, VulnerableVault.sol 82.35 %

## Contract: FlashLoanPool.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

/// @title FlashLoanPool — unsecured lab flash loan (demo funds only)
contract FlashLoanPool {
    MockERC20 public immutable asset;
    uint256 public constant FEE_BPS = 0; // zero fee for clearer teaching demo

    constructor(MockERC20 asset_) {
        asset = asset_;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        uint256 balBefore = asset.balanceOf(address(this));
        require(balBefore >= amount, "FlashLoanPool: liquidity");
        require(asset.transfer(msg.sender, amount), "FlashLoanPool: transfer");
        IFlashLoanReceiver(msg.sender).onFlashLoan(address(asset), amount, 0, data);
        uint256 balAfter = asset.balanceOf(address(this));
        require(balAfter >= balBefore, "FlashLoanPool: not repaid");
    }
}
```

## Contract: LabAttacker.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockERC20.sol";
import "./LabOracle.sol";
import "./FlashLoanPool.sol";
import "./VulnerableVault.sol";
import "./MitigatedVault.sol";

/// @title LabAttacker — educational same-tx flash loan + oracle spike harness
/// @dev Lab-only. Demo tokens. Not a mainnet exploit toolkit.
contract LabAttacker is IFlashLoanReceiver {
    FlashLoanPool public immutable pool;
    LabOracle public immutable oracle;
    MockERC20 public immutable collateral;
    MockERC20 public immutable debtAsset;
    VulnerableVault public immutable vuln;
    MitigatedVault public immutable mit;

    uint256 public lastBorrowed;
    bool public lastSuccess;
    string public lastReason;

    constructor(
        FlashLoanPool pool_,
        LabOracle oracle_,
        MockERC20 collateral_,
        MockERC20 debtAsset_,
        VulnerableVault vuln_,
        MitigatedVault mit_
    ) {
        pool = pool_;
        oracle = oracle_;
        collateral = collateral_;
        debtAsset = debtAsset_;
        vuln = vuln_;
        mit = mit_;
    }

    function attackVulnerable(uint256 flashAmount, uint256 depositAmount, uint256 spikePrice) external {
        bytes memory data = abi.encode(uint8(0), depositAmount, spikePrice);
        pool.flashLoan(flashAmount, data);
    }

    function attackMitigated(uint256 flashAmount, uint256 depositAmount, uint256 spikePrice) external {
        bytes memory data = abi.encode(uint8(1), depositAmount, spikePrice);
        pool.flashLoan(flashAmount, data);
    }

    function onFlashLoan(address, uint256 amount, uint256, bytes calldata data) external override {
        require(msg.sender == address(pool), "LabAttacker: pool only");
        (uint8 mode, uint256 depositAmount, uint256 spikePrice) = abi.decode(data, (uint8, uint256, uint256));
        require(collateral.balanceOf(address(this)) >= amount + depositAmount, "LabAttacker: seed collateral");

        oracle.setSpotPrice(spikePrice);

        if (mode == 0) {
            collateral.approve(address(vuln), depositAmount);
            vuln.depositCollateral(depositAmount);
            uint256 canBorrow = vuln.maxBorrow(address(this));
            uint256 vaultLiq = debtAsset.balanceOf(address(vuln));
            uint256 take = canBorrow < vaultLiq ? canBorrow : vaultLiq;
            if (take > 0) {
                vuln.borrow(take);
                lastBorrowed = take;
                lastSuccess = true;
                lastReason = "vulnerable lab drain succeeded";
            } else {
                lastBorrowed = 0;
                lastSuccess = false;
                lastReason = "no borrow capacity";
            }
        } else {
            collateral.approve(address(mit), depositAmount);
            mit.depositCollateral(depositAmount);
            uint256 want = mit.maxBorrow(address(this));
            if (want == 0) want = 1;
            try mit.borrow(want) {
                lastBorrowed = want;
                lastSuccess = true;
                lastReason = "unexpected: mitigated allowed borrow";
            } catch Error(string memory reason) {
                lastBorrowed = 0;
                lastSuccess = false;
                lastReason = reason;
            } catch {
                lastBorrowed = 0;
                lastSuccess = false;
                lastReason = "MitigatedVault: blocked";
            }
        }

        require(collateral.transfer(address(pool), amount), "LabAttacker: repay flash");
    }
}
```

## Contract: LabOracle.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LabOracle — intentionally manipulable single-spot price feed (lab only)
/// @notice Models an unsecured / single-source price that can move in one block.
contract LabOracle {
    uint256 public spotPrice; // 1e18 = $1
    address public labController;

    event SpotUpdated(uint256 oldPrice, uint256 newPrice, address indexed by);

    constructor(uint256 initialPrice) {
        spotPrice = initialPrice;
        labController = msg.sender;
    }

    /// @notice Anyone can set the lab spot — simulates thin DEX / single-block manipulation
    function setSpotPrice(uint256 newPrice) external {
        require(newPrice > 0, "LabOracle: zero");
        uint256 old = spotPrice;
        spotPrice = newPrice;
        emit SpotUpdated(old, newPrice, msg.sender);
    }

    function latestPrice() external view returns (uint256) {
        return spotPrice;
    }
}
```

## Contract: MitigatedVault.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockERC20.sol";
import "./LabOracle.sol";

/// @title MitigatedVault — TWAP-style oracle window + circuit breaker
/// @notice EDUCATIONAL mitigation of same-block spot manipulation.
///         Lab-only demo funds — not production DeFi.
contract MitigatedVault {
    MockERC20 public immutable collateral;
    MockERC20 public immutable debtAsset;
    LabOracle public immutable oracle;
    address public owner;

    uint256 public constant LTV_BPS = 9000;
    uint256 public constant MAX_DEVIATION_BPS = 500;
    uint256 public constant WINDOW = 5;

    uint256[WINDOW] public priceSamples;
    uint256 public sampleCount;
    uint256 public sampleIndex;
    bool public circuitOpen;

    mapping(address => uint256) public collateralOf;
    mapping(address => uint256) public debtOf;

    event Deposit(address indexed user, uint256 amount);
    event Borrow(address indexed user, uint256 amount, uint256 twapUsed);
    event SampleRecorded(uint256 price, uint256 index);
    event CircuitOpened(uint256 spot, uint256 twap, string reason);
    event CircuitClosed();

    modifier onlyOwner() {
        require(msg.sender == owner, "MitigatedVault: owner");
        _;
    }

    constructor(MockERC20 collateral_, MockERC20 debtAsset_, LabOracle oracle_, uint256 seedPrice) {
        collateral = collateral_;
        debtAsset = debtAsset_;
        oracle = oracle_;
        owner = msg.sender;
        for (uint256 i = 0; i < WINDOW; i++) {
            priceSamples[i] = seedPrice;
        }
        sampleCount = WINDOW;
    }

    function depositCollateral(uint256 amount) external {
        require(collateral.transferFrom(msg.sender, address(this), amount), "transfer");
        collateralOf[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    function recordSample() external {
        uint256 p = oracle.latestPrice();
        priceSamples[sampleIndex] = p;
        sampleIndex = (sampleIndex + 1) % WINDOW;
        if (sampleCount < WINDOW) sampleCount++;
        emit SampleRecorded(p, sampleIndex);
    }

    function twap() public view returns (uint256) {
        require(sampleCount > 0, "MitigatedVault: no samples");
        uint256 sum;
        for (uint256 i = 0; i < sampleCount; i++) {
            sum += priceSamples[i];
        }
        return sum / sampleCount;
    }

    function spotDeviationBps() public view returns (uint256) {
        uint256 spot = oracle.latestPrice();
        uint256 avg = twap();
        uint256 hi = spot > avg ? spot : avg;
        uint256 lo = spot > avg ? avg : spot;
        if (hi == 0) return 0;
        return ((hi - lo) * 10_000) / hi;
    }

    function tripCircuitIfDeviated() external returns (bool tripped) {
        uint256 bps = spotDeviationBps();
        if (bps > MAX_DEVIATION_BPS) {
            circuitOpen = true;
            emit CircuitOpened(oracle.latestPrice(), twap(), "spot vs TWAP deviation");
            return true;
        }
        return false;
    }

    function closeCircuit() external onlyOwner {
        circuitOpen = false;
        emit CircuitClosed();
    }

    function maxBorrow(address user) public view returns (uint256) {
        if (circuitOpen) return 0;
        uint256 price = twap();
        uint256 value = (collateralOf[user] * price) / 1e18;
        uint256 maxDebt = (value * LTV_BPS) / 10_000;
        if (maxDebt <= debtOf[user]) return 0;
        return maxDebt - debtOf[user];
    }

    function borrow(uint256 amount) external {
        require(!circuitOpen, "MitigatedVault: circuit open");
        require(spotDeviationBps() <= MAX_DEVIATION_BPS, "MitigatedVault: circuit breaker");
        uint256 avg = twap();
        uint256 value = (collateralOf[msg.sender] * avg) / 1e18;
        uint256 maxDebt = (value * LTV_BPS) / 10_000;
        require(debtOf[msg.sender] + amount <= maxDebt, "MitigatedVault: LTV");
        require(debtAsset.balanceOf(address(this)) >= amount, "MitigatedVault: liquidity");
        debtOf[msg.sender] += amount;
        require(debtAsset.transfer(msg.sender, amount), "transfer");
        emit Borrow(msg.sender, amount, avg);
    }

    function repay(uint256 amount) external {
        require(debtAsset.transferFrom(msg.sender, address(this), amount), "transfer");
        debtOf[msg.sender] -= amount;
    }
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockERC20 — lab-only demo token (not a real asset)
/// @notice Deterministic balances for educational flash-loan risk demos.
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint256 initialSupply) {
        name = name_;
        symbol = symbol_;
        _mint(msg.sender, initialSupply);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "MockERC20: allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    /// @dev Lab helper — mint demo tokens (anyone may call; not production)
    function labMint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "MockERC20: balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
```

## Contract: VulnerableVault.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockERC20.sol";
import "./LabOracle.sol";

/// @title VulnerableVault — collateralized borrow using ONLY a single-spot oracle
/// @notice EDUCATIONAL: shows how a same-block price spike can over-borrow / drain.
///         Not a mainnet product. Demo tokens only.
contract VulnerableVault {
    MockERC20 public immutable collateral; // e.g. LAB-COLL
    MockERC20 public immutable debtAsset;  // e.g. LAB-USD
    LabOracle public immutable oracle;

    uint256 public constant LTV_BPS = 9000; // 90% LTV — aggressive for demo clarity
    mapping(address => uint256) public collateralOf;
    mapping(address => uint256) public debtOf;

    event Deposit(address indexed user, uint256 amount);
    event Borrow(address indexed user, uint256 amount, uint256 priceUsed);
    event Repay(address indexed user, uint256 amount);

    constructor(MockERC20 collateral_, MockERC20 debtAsset_, LabOracle oracle_) {
        collateral = collateral_;
        debtAsset = debtAsset_;
        oracle = oracle_;
    }

    function depositCollateral(uint256 amount) external {
        require(collateral.transferFrom(msg.sender, address(this), amount), "transfer");
        collateralOf[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    /// @dev Uses live spot only — no TWAP, no circuit breaker
    function maxBorrow(address user) public view returns (uint256) {
        uint256 price = oracle.latestPrice();
        uint256 value = (collateralOf[user] * price) / 1e18;
        uint256 maxDebt = (value * LTV_BPS) / 10_000;
        if (maxDebt <= debtOf[user]) return 0;
        return maxDebt - debtOf[user];
    }

    function borrow(uint256 amount) external {
        uint256 price = oracle.latestPrice();
        uint256 value = (collateralOf[msg.sender] * price) / 1e18;
        uint256 maxDebt = (value * LTV_BPS) / 10_000;
        require(debtOf[msg.sender] + amount <= maxDebt, "VulnerableVault: LTV");
        require(debtAsset.balanceOf(address(this)) >= amount, "VulnerableVault: liquidity");
        debtOf[msg.sender] += amount;
        require(debtAsset.transfer(msg.sender, amount), "transfer");
        emit Borrow(msg.sender, amount, price);
    }

    function repay(uint256 amount) external {
        require(debtAsset.transferFrom(msg.sender, address(this), amount), "transfer");
        debtOf[msg.sender] -= amount;
        emit Repay(msg.sender, amount);
    }
}
```

## Tests: FlashLoanRiskLab.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

const ONE = ethers.parseEther("1");
const HUNDRED = ethers.parseEther("100");
const THOUSAND = ethers.parseEther("1000");
const TEN_THOUSAND = ethers.parseEther("10000");

describe("Flash Loan Risk Lab (educational)", function () {
  let coll, debt, oracle, pool, vuln, mit, attacker, deployer, user;

  beforeEach(async function () {
    [deployer, user] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("MockERC20");
    coll = await ERC20.deploy("Lab Collateral", "LAB-COLL", TEN_THOUSAND);
    debt = await ERC20.deploy("Lab USD", "LAB-USD", TEN_THOUSAND);

    const Oracle = await ethers.getContractFactory("LabOracle");
    oracle = await Oracle.deploy(ONE);

    const Pool = await ethers.getContractFactory("FlashLoanPool");
    pool = await Pool.deploy(coll);
    await coll.transfer(await pool.getAddress(), THOUSAND);

    const Vuln = await ethers.getContractFactory("VulnerableVault");
    vuln = await Vuln.deploy(coll, debt, oracle);
    await debt.transfer(await vuln.getAddress(), THOUSAND);

    const Mit = await ethers.getContractFactory("MitigatedVault");
    mit = await Mit.deploy(coll, debt, oracle, ONE);
    await debt.transfer(await mit.getAddress(), THOUSAND);

    const Att = await ethers.getContractFactory("LabAttacker");
    attacker = await Att.deploy(pool, oracle, coll, debt, vuln, mit);
  });

  it("VulnerableVault: spot spike enables oversized borrow (lab drain)", async function () {
    await coll.transfer(user.address, HUNDRED);
    await coll.connect(user).approve(await vuln.getAddress(), HUNDRED);
    await vuln.connect(user).depositCollateral(HUNDRED);

    expect(await vuln.maxBorrow(user.address)).to.equal(ethers.parseEther("90"));

    await oracle.setSpotPrice(ethers.parseEther("10"));
    expect(await vuln.maxBorrow(user.address)).to.equal(ethers.parseEther("900"));

    await vuln.connect(user).borrow(ethers.parseEther("900"));
    expect(await debt.balanceOf(user.address)).to.equal(ethers.parseEther("900"));
    expect(await debt.balanceOf(await vuln.getAddress())).to.equal(ethers.parseEther("100"));
  });

  it("MitigatedVault: TWAP + circuit breaker blocks spiked borrow", async function () {
    await coll.transfer(user.address, HUNDRED);
    await coll.connect(user).approve(await mit.getAddress(), HUNDRED);
    await mit.connect(user).depositCollateral(HUNDRED);

    expect(await mit.twap()).to.equal(ONE);
    expect(await mit.maxBorrow(user.address)).to.equal(ethers.parseEther("90"));

    await oracle.setSpotPrice(ethers.parseEther("10"));
    expect(await mit.spotDeviationBps()).to.be.gt(500);

    await expect(mit.connect(user).borrow(ethers.parseEther("50"))).to.be.revertedWith(
      "MitigatedVault: circuit breaker"
    );

    await mit.tripCircuitIfDeviated();
    expect(await mit.circuitOpen()).to.equal(true);
    expect(await debt.balanceOf(await mit.getAddress())).to.equal(THOUSAND);
  });

  it("MitigatedVault: honest borrow at TWAP still works", async function () {
    await coll.transfer(user.address, HUNDRED);
    await coll.connect(user).approve(await mit.getAddress(), HUNDRED);
    await mit.connect(user).depositCollateral(HUNDRED);

    await mit.connect(user).borrow(ethers.parseEther("50"));
    expect(await debt.balanceOf(user.address)).to.equal(ethers.parseEther("50"));
    expect(await mit.circuitOpen()).to.equal(false);
  });

  it("LabAttacker flash path: Vulnerable succeeds, Mitigated blocked", async function () {
    const flashAmount = ethers.parseEther("200");
    const depositAmount = ethers.parseEther("100");
    const spike = ethers.parseEther("10");

    await coll.transfer(await attacker.getAddress(), flashAmount + depositAmount + flashAmount + depositAmount);

    await attacker.attackVulnerable(flashAmount, depositAmount, spike);
    expect(await attacker.lastSuccess()).to.equal(true);
    expect(await attacker.lastBorrowed()).to.equal(ethers.parseEther("900"));
    expect(await debt.balanceOf(await attacker.getAddress())).to.equal(ethers.parseEther("900"));

    await attacker.attackMitigated(flashAmount, depositAmount, spike);
    expect(await attacker.lastSuccess()).to.equal(false);
    const reason = await attacker.lastReason();
    expect(reason).to.match(/circuit breaker|circuit open|blocked|MitigatedVault/i);
  });

  it("FlashLoanPool requires full repayment (insufficient seed reverts)", async function () {
    await expect(
      attacker.attackVulnerable(HUNDRED, ethers.parseEther("10"), ethers.parseEther("10"))
    ).to.be.revertedWith("LabAttacker: seed collateral");
  });

  it("LabOracle starts at $1 and is freely settable (lab model)", async function () {
    expect(await oracle.latestPrice()).to.equal(ONE);
    await oracle.connect(user).setSpotPrice(ethers.parseEther("2"));
    expect(await oracle.latestPrice()).to.equal(ethers.parseEther("2"));
  });
});
```
