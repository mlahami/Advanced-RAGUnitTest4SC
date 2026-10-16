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
