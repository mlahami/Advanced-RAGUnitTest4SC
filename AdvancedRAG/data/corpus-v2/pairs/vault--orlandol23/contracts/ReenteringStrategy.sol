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
