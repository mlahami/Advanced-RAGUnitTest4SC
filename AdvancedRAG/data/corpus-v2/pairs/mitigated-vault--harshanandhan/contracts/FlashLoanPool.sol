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
