
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAVGXAMM} from "./IAVGXAMM.sol";
import {IAVGXToken} from "./IAVGXToken.sol";
import {IAVGXCalculator} from "./IAVGXCalculator.sol";
import {AVGXVault} from "./AVGXVault.sol";
import {Roles} from "./Roles.sol";
import {FixedPointMath} from "./FixedPointMath.sol";

/**
 * @title AVGXAMM
 * @dev Automated Market Maker for AVGX token minting and redemption
 * @notice Enables users to mint AVGX with base assets and redeem AVGX for base assets
 */
contract AVGXAMM is AccessControl, Pausable, ReentrancyGuard, IAVGXAMM {
    using SafeERC20 for IERC20;
    using FixedPointMath for uint256;
    using Roles for uint256;
    using Roles for address;

    IAVGXToken public immutable avgxToken;
    IAVGXCalculator public immutable calculator;
    IERC20 public immutable baseAsset;
    AVGXVault public vault;

    AMMParams private _params;

    /**
     * @dev Constructor initializes the AMM
     * @param avgxToken_ Address of the AVGX token
     * @param calculator_ Address of the AVGX calculator
     * @param baseAsset_ Address of the base asset (e.g., USDC)
     */
    constructor(
        address avgxToken_,
        address calculator_,
        address baseAsset_
    ) {
        avgxToken_.validateAddress();
        calculator_.validateAddress();
        baseAsset_.validateAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        
        avgxToken = IAVGXToken(avgxToken_);
        calculator = IAVGXCalculator(calculator_);
        baseAsset = IERC20(baseAsset_);

        // Set default parameters
        _params = AMMParams({
            feeBps: Roles.DEFAULT_FEE_BPS,
            spreadBps: Roles.DEFAULT_SPREAD_BPS,
            feeRecipient: msg.sender,
            treasury: msg.sender
        });
    }

    function setVault(address vault_) external onlyRole(Roles.GOVERNOR_ROLE) {
        require(address(vault) == address(0), "AVGXAMM: Vault already set");
        vault_.validateAddress();
        vault = AVGXVault(vault_);
    }

    /**
     * @dev Mints AVGX tokens with base asset
     * @param baseIn Amount of base asset to deposit
     * @param minAvgxOut Minimum AVGX tokens to receive
     * @param to Address to receive AVGX tokens
     * @return avgxOut Amount of AVGX tokens minted
     */
    function mintWithBase(
        uint256 baseIn, 
        uint256 minAvgxOut, 
        address to
    ) external nonReentrant whenNotPaused returns (uint256 avgxOut) {
        if (baseIn == 0) revert InvalidAmount();
        to.validateAddress();

        uint256 fee;
        (avgxOut, fee) = getQuoteMint(baseIn);
        if (avgxOut < minAvgxOut) revert SlippageExceeded();

        // Transfer base asset from user
        baseAsset.safeTransferFrom(msg.sender, address(vault), baseIn - fee);
        
        // Handle fees
        if (fee > 0) {
            uint256 feeRecipientAmount = fee / 2;
            uint256 treasuryAmount = fee - feeRecipientAmount;
            
            if (feeRecipientAmount > 0) {
                baseAsset.safeTransferFrom(msg.sender, _params.feeRecipient, feeRecipientAmount);
            }
            if (treasuryAmount > 0) {
                baseAsset.safeTransferFrom(msg.sender, _params.treasury, treasuryAmount);
            }
        }

        // Mint AVGX tokens
        avgxToken.mint(to, avgxOut);

        emit MintedWithBase(msg.sender, baseIn, avgxOut, fee);
    }

    /**
     * @dev Redeems AVGX tokens for base asset
     * @param avgxIn Amount of AVGX tokens to redeem
     * @param minBaseOut Minimum base asset to receive
     * @param to Address to receive base asset
     * @return baseOut Amount of base asset received
     */
    function redeemForBase(
        uint256 avgxIn, 
        uint256 minBaseOut, 
        address to
    ) external nonReentrant whenNotPaused returns (uint256 baseOut) {
        if (avgxIn == 0) revert InvalidAmount();
        to.validateAddress();

        uint256 fee;
        (baseOut, fee) = getQuoteRedeem(avgxIn);
        if (baseOut < minBaseOut) revert SlippageExceeded();

        // Calculate net base amount after fees
        uint256 netBaseOut = baseOut - fee;
        // Check vault has sufficient liquidity
        if (vault.getBalance() < netBaseOut) revert InsufficientLiquidity();


        // Burn AVGX tokens
        avgxToken.burnFrom(msg.sender, avgxIn);

        // Transfer base asset to user
        vault.withdraw(to, netBaseOut);

        // Handle fees
        if (fee > 0) {
            uint256 feeRecipientAmount = fee / 2;
            uint256 treasuryAmount = fee - feeRecipientAmount;
            
            if (feeRecipientAmount > 0) {
                vault.withdraw(_params.feeRecipient, feeRecipientAmount);
            }
            if (treasuryAmount > 0) {
                vault.withdraw(_params.treasury, treasuryAmount);
            }
        }

        emit RedeemedForBase(msg.sender, avgxIn, baseOut, fee);
    }

    /**
     * @dev Gets quote for minting AVGX with base asset
     * @param baseIn Amount of base asset
     * @return avgxOut Amount of AVGX tokens to receive
     * @return fee Fee amount in base asset
     */
    function getQuoteMint(uint256 baseIn) public view returns (uint256 avgxOut, uint256 fee) {
        uint256 avgxPrice = calculator.currentIndex();
        
        // Calculate fee
        fee = (baseIn * _params.feeBps) / Roles.BPS;
        
        // Calculate AVGX amount with spread
        uint256 effectivePrice = avgxPrice + (avgxPrice * _params.spreadBps) / Roles.BPS;
        avgxOut = (baseIn - fee).div(effectivePrice);
    }

    /**
     * @dev Gets quote for redeeming AVGX for base asset
     * @param avgxIn Amount of AVGX tokens
     * @return baseOut Amount of base asset to receive
     * @return fee Fee amount in base asset
     */
    function getQuoteRedeem(uint256 avgxIn) public view returns (uint256 baseOut, uint256 fee) {
        uint256 avgxPrice = calculator.currentIndex();
        
        // Calculate base amount with spread
        uint256 effectivePrice = avgxPrice - (avgxPrice * _params.spreadBps) / Roles.BPS;
        uint256 grossBaseOut = avgxIn.mul(effectivePrice);
        
        // Calculate fee
        fee = (grossBaseOut * _params.feeBps) / Roles.BPS;
        baseOut = grossBaseOut - fee;
    }

    /**
     * @dev Updates AMM parameters
     * @param params New AMM parameters
     */
    function updateParams(AMMParams memory params) external onlyRole(Roles.GOVERNOR_ROLE) {
        params.feeBps.validateBPS();
        params.spreadBps.validateBPS();
        params.feeRecipient.validateAddress();
        params.treasury.validateAddress();
        
        _params = params;
        emit ParamsUpdated(params);
    }

    /**
     * @dev Gets current AMM parameters
     * @return params Current AMM parameters
     */
    function getParams() external view returns (AMMParams memory params) {
        return _params;
    }

    /**
     * @dev Pauses the AMM
     */
    function pause() external onlyRole(Roles.PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses the AMM
     */
    function unpause() external onlyRole(Roles.PAUSER_ROLE) {
        _unpause();
    }
}
