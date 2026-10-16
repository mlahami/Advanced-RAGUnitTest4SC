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
