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
