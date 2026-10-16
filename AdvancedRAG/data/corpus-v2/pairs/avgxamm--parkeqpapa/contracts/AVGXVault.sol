
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Roles} from "./Roles.sol";

/**
 * @title AVGXVault
 * @dev Vault contract for holding base asset reserves
 * @notice Manages protocol liquidity and collects fees
 */
contract AVGXVault is AccessControl {
    using SafeERC20 for IERC20;
    using Roles for address;

    IERC20 public immutable baseAsset;
    address public amm;

    event AmmSet(address indexed amm);


    event Deposit(address indexed from, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);

    error OnlyAMM();
    error InsufficientBalance();


    /**
     * @dev Constructor initializes the vault
     * @param baseAsset_ Address of the base asset
     */
    constructor(address baseAsset_) {
        baseAsset_.validateAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        baseAsset = IERC20(baseAsset_);
    }

    function setAmm(address amm_) external onlyRole(Roles.GOVERNOR_ROLE) {
        require(amm == address(0), "AVGXVault: AMM already set");
        amm_.validateAddress();
        amm = amm_;
        emit AmmSet(amm_);
    }

    /**
     * @dev Deposits base asset into the vault
     * @param amount Amount to deposit
     */
    function deposit(uint256 amount) external onlyRole(Roles.GOVERNOR_ROLE) {
        require(amount > 0, "AVGXVault: Invalid amount");
        baseAsset.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(msg.sender, amount);
    }

    /**
     * @dev Withdraws base asset from the vault (governor only)
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function withdraw(address to, uint256 amount) external {
        if (msg.sender != amm && !hasRole(Roles.GOVERNOR_ROLE, msg.sender)) {
            revert OnlyAMM();
        }
        
        to.validateAddress();
        require(amount > 0, "AVGXVault: Invalid amount");
        
        uint256 balance = baseAsset.balanceOf(address(this));
        if (balance < amount) revert InsufficientBalance();
        
        baseAsset.safeTransfer(to, amount);
        emit Withdraw(to, amount);
    }

    /**
     * @dev Gets current vault balance
     * @return balance Current balance of base asset
     */
    function getBalance() external view returns (uint256 balance) {
        return baseAsset.balanceOf(address(this));
    }
}
