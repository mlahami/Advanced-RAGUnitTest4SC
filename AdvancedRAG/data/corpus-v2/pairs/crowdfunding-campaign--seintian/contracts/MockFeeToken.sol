// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockFeeToken
 * @notice ERC-20 token deducting a 5% fee on transfer to test fee-on-transfer protection.
 */
contract MockFeeToken is ERC20 {
    uint256 public feePercent = 5;

    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFeePercent(uint256 _feePercent) external {
        feePercent = _feePercent;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);
        uint256 fee = (amount * feePercent) / 100;
        uint256 netAmount = amount - fee;
        if (fee > 0) {
            _transfer(from, address(this), fee);
        }
        if (netAmount > 0) {
            _transfer(from, to, netAmount);
        }
        return true;
    }
}
