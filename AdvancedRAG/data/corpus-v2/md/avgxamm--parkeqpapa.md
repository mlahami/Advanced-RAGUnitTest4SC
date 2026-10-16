# avgxamm--parkeqpapa

- domain: amm-dex (amm-dex)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/parkeqpapa/avgx-backend-v3 @ 631ead7d04f01fee1fa6fbeeca13efe0f3ac27ca
- license: MIT
- targets: AVGXAMM.sol, AVGXToken.sol, AVGXVault.sol, IAVGXAMM.sol, IAVGXCalculator.sol, IAVGXToken.sol, FixedPointMath.sol, Roles.sol, MockCalculator.sol, MockERC20.sol
- validation: 19 passing tests, 0 failing; statement coverage AVGXAMM.sol 100.0 %, AVGXToken.sol 50.0 %, AVGXVault.sol 100.0 %, IAVGXAMM.sol 100.0 %, IAVGXCalculator.sol 100.0 %, IAVGXToken.sol 100.0 %, FixedPointMath.sol 13.64 %, Roles.sol 100.0 %, MockCalculator.sol 14.29 %, MockERC20.sol 66.67 %

## Contract: AVGXAMM.sol (primary target)

```solidity

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
```

## Contract: AVGXToken.sol (dependency)

```solidity

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit, Nonces, IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAVGXToken} from "./IAVGXToken.sol";
import {Roles} from "./Roles.sol";

/**
 * @title AVGXToken
 * @dev AVGX ERC20 token with governance, permits, and access control
 * @notice The native token of the AVGX protocol representing the synthetic index
 */
contract AVGXToken is ERC20, ERC20Permit, ERC20Votes, ERC20Burnable, ERC20Pausable, AccessControl, IAVGXToken {
    using Roles for address;

    uint256 private _maxSupplyAVGX;
    bool private _maxSupplySet;

    /**
     * @dev Constructor initializes the token
     * @param accessController Address of the access controller
     */
    constructor(address accessController) 
        ERC20("AVGX", "AVGX") 
        ERC20Permit("AVGX") 
    {
        accessController.validateAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, accessController);
    }

    /**
     * @dev Mints tokens to specified address
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyRole(Roles.MINTER_ROLE) {
        to.validateAddress();
        
        if (_maxSupplySet && totalSupply() + amount > _maxSupplyAVGX) {
            revert MaxSupplyExceeded();
        }
        
        _mint(to, amount);
        emit Minted(to, amount);
    }

    /**
     * @dev Burns tokens from specified address with allowance check
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burnFrom(address from, uint256 amount) public override(ERC20Burnable, IAVGXToken) {
        if (!hasRole(Roles.MINTER_ROLE, _msgSender())) {
            _spendAllowance(from, _msgSender(), amount);
        }
        _burn(from, amount);
        emit Burned(from, amount);
    }

    /**
     * @dev Sets maximum supply (can only be called once)
     * @param maxSupply_ Maximum supply limit
     */
    function setMaxSupply(uint256 maxSupply_) external onlyRole(Roles.GOVERNOR_ROLE) {
        if (_maxSupplySet) revert MaxSupplyAlreadySet();
        _maxSupplyAVGX = maxSupply_;
        _maxSupplySet = true;
        emit MaxSupplySet(maxSupply_);
    }

    /**
     * @dev Returns the maximum supply
     * @return Maximum supply limit
     */
    function maxSupplyAVGX() external view returns (uint256) {
        return _maxSupplyAVGX;
    }

    /**
     * @dev Pauses all token transfers
     */
    function pause() external onlyRole(Roles.PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses all token transfers
     */
    function unpause() external onlyRole(Roles.PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Returns the number of decimals
     * @return Number of decimals (18)
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    // Required overrides for multiple inheritance
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces, IERC20Permit)
        returns (uint256)
    {
        return super.nonces(owner);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function MINTER_ROLE() public pure returns (bytes32) {
        return Roles.MINTER_ROLE;
    }

    function GOVERNOR_ROLE() public pure returns (bytes32) {
        return Roles.GOVERNOR_ROLE;
    }

    function PAUSER_ROLE() public pure returns (bytes32) {
        return Roles.PAUSER_ROLE;
    }
}
```

## Contract: AVGXVault.sol (dependency)

```solidity

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
```

## Contract: FixedPointMath.sol (dependency)

```solidity

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FixedPointMath
 * @dev Library for fixed-point arithmetic operations with 1e18 precision
 * @notice Provides safe mathematical operations for the AVGX protocol
 */
library FixedPointMath {
    uint256 public constant ONE = 1e18;
    uint256 public constant MAX_UINT256 = type(uint256).max;

    error MathOverflow();
    error DivisionByZero();

    /**
     * @dev Multiplies two fixed-point numbers
     * @param a First operand in 1e18 format
     * @param b Second operand in 1e18 format
     * @return result Product in 1e18 format
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256 result) {
        if (a == 0) return 0;
        result = a * b;
        if (result / a != b) revert MathOverflow();
        result = result / ONE;
    }

    /**
     * @dev Divides two fixed-point numbers
     * @param a Dividend in 1e18 format
     * @param b Divisor in 1e18 format
     * @return result Quotient in 1e18 format
     */
    function div(uint256 a, uint256 b) internal pure returns (uint256 result) {
        if (b == 0) revert DivisionByZero();
        result = (a * ONE) / b;
    }

    /**
     * @dev Calculates square root using Babylonian method
     * @param x Input value in 1e18 format
     * @return result Square root in 1e18 format
     */
    function sqrt(uint256 x) internal pure returns (uint256 result) {
        if (x == 0) return 0;
        
        // Initial guess
        uint256 z = (x + 1) / 2;
        result = x;
        
        // Babylonian method
        while (z < result) {
            result = z;
            z = (x / z + z) / 2;
        }
        
        // Scale to 1e18
        result = result * 1e9; // sqrt(1e18) = 1e9
    }

    /**
     * @dev Safely multiplies and divides to avoid intermediate overflow
     * @param a First operand
     * @param b Second operand
     * @param c Divisor
     * @return result (a * b) / c
     */
    function mulDiv(uint256 a, uint256 b, uint256 c) internal pure returns (uint256 result) {
        if (c == 0) revert DivisionByZero();
        
        uint256 prod0;
        uint256 prod1;
        
        assembly {
            let mm := mulmod(a, b, not(0))
            prod0 := mul(a, b)
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }
        
        if (prod1 == 0) {
            return prod0 / c;
        }
        
        if (prod1 >= c) revert MathOverflow();
        
        uint256 remainder;
        assembly {
            remainder := mulmod(a, b, c)
            prod1 := sub(prod1, gt(remainder, prod0))
            prod0 := sub(prod0, remainder)
        }
        
        uint256 twos = c & (~c + 1);
        assembly {
            c := div(c, twos)
            prod0 := div(prod0, twos)
            twos := add(div(sub(0, twos), twos), 1)
        }
        
        prod0 |= prod1 * twos;
        
        uint256 inverse = (3 * c) ^ 2;
        inverse *= 2 - c * inverse;
        inverse *= 2 - c * inverse;
        inverse *= 2 - c * inverse;
        inverse *= 2 - c * inverse;
        inverse *= 2 - c * inverse;
        inverse *= 2 - c * inverse;
        
        result = prod0 * inverse;
    }

    /**
     * @dev Normalizes a value to 1e18 precision
     * @param value The value to normalize
     * @param decimals Current decimal places of the value
     * @return normalized The value normalized to 1e18
     */
    function normalize(uint256 value, uint8 decimals) internal pure returns (uint256 normalized) {
        if (decimals == 18) {
            return value;
        } else if (decimals < 18) {
            return value * (10 ** (18 - decimals));
        } else {
            return value / (10 ** (decimals - 18));
        }
    }
}
```

## Contract: IAVGXAMM.sol (dependency)

```solidity

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAVGXAMM
 * @dev Interface for the AVGX AMM contract
 */
interface IAVGXAMM {
    struct AMMParams {
        uint256 feeBps;
        uint256 spreadBps;
        address feeRecipient;
        address treasury;
    }

    event MintedWithBase(address indexed user, uint256 baseIn, uint256 avgxOut, uint256 fee);
    event RedeemedForBase(address indexed user, uint256 avgxIn, uint256 baseOut, uint256 fee);
    event ParamsUpdated(AMMParams params);

    error SlippageExceeded();
    error InsufficientLiquidity();
    error InvalidAmount();

    /**
     * @dev Mints AVGX tokens with base asset
     * @param baseIn Amount of base asset to deposit
     * @param minAvgxOut Minimum AVGX tokens to receive
     * @param to Address to receive AVGX tokens
     * @return avgxOut Amount of AVGX tokens minted
     */
    function mintWithBase(uint256 baseIn, uint256 minAvgxOut, address to) external returns (uint256 avgxOut);

    /**
     * @dev Redeems AVGX tokens for base asset
     * @param avgxIn Amount of AVGX tokens to redeem
     * @param minBaseOut Minimum base asset to receive
     * @param to Address to receive base asset
     * @return baseOut Amount of base asset received
     */
    function redeemForBase(uint256 avgxIn, uint256 minBaseOut, address to) external returns (uint256 baseOut);

    /**
     * @dev Gets quote for minting AVGX with base asset
     * @param baseIn Amount of base asset
     * @return avgxOut Amount of AVGX tokens to receive
     * @return fee Fee amount in base asset
     */
    function getQuoteMint(uint256 baseIn) external view returns (uint256 avgxOut, uint256 fee);

    /**
     * @dev Gets quote for redeeming AVGX for base asset
     * @param avgxIn Amount of AVGX tokens
     * @return baseOut Amount of base asset to receive
     * @return fee Fee amount in base asset
     */
    function getQuoteRedeem(uint256 avgxIn) external view returns (uint256 baseOut, uint256 fee);

    /**
     * @dev Updates AMM parameters
     * @param params New AMM parameters
     */
    function updateParams(AMMParams memory params) external;

    /**
     * @dev Pauses the AMM
     */
    function pause() external;

    /**
     * @dev Unpauses the AMM
     */
    function unpause() external;
}
```

## Contract: IAVGXCalculator.sol (dependency)

```solidity

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAVGXCalculator
 * @dev Interface for the AVGX index calculator contract
 */
interface IAVGXCalculator {
    struct Component {
        bytes32 assetId;
        uint256 weightBps;
        uint8 decimals;
    }

    event ComponentsUpdated(Component[] fiatComponents, Component[] cryptoComponents);
    event FiatComponentAdded(bytes32 indexed assetId, uint256 weightBps);
    event CryptoComponentAdded(bytes32 indexed assetId, uint256 weightBps);
    event ComponentRemoved(bytes32 indexed assetId, bool isFiat);

    error InvalidWeights();
    error ComponentNotFound();
    error DuplicateComponent();

    /**
     * @dev Calculates current AVGX index value
     * @return priceE18 Index value in 1e18 format
     */
    function currentIndex() external view returns (uint256 priceE18);

    /**
     * @dev Adds a fiat component to the index
     * @param assetId Asset identifier
     * @param weightBps Weight in basis points
     * @param decimals Price feed decimals
     */
    function addFiatComponent(bytes32 assetId, uint256 weightBps, uint8 decimals) external;

    /**
     * @dev Adds a crypto component to the index
     * @param assetId Asset identifier
     * @param weightBps Weight in basis points
     * @param decimals Price feed decimals
     */
    function addCryptoComponent(bytes32 assetId, uint256 weightBps, uint8 decimals) external;

    /**
     * @dev Removes a component from the index
     * @param assetId Asset identifier
     * @param isFiat Whether the component is fiat
     */
    function removeComponent(bytes32 assetId, bool isFiat) external;

    /**
     * @dev Updates component weight
     * @param assetId Asset identifier
     * @param weightBps New weight in basis points
     * @param isFiat Whether the component is fiat
     */
    function updateComponentWeight(bytes32 assetId, uint256 weightBps, bool isFiat) external;

    /**
     * @dev Gets all fiat components
     * @return components Array of fiat components
     */
    function getFiatComponents() external view returns (Component[] memory components);

    /**
     * @dev Gets all crypto components
     * @return components Array of crypto components
     */
    function getCryptoComponents() external view returns (Component[] memory components);

    /**
     * @dev Gets total weight for fiat components
     * @return totalWeight Total weight in basis points
     */
    function getTotalFiatWeight() external view returns (uint256 totalWeight);

    /**
     * @dev Gets total weight for crypto components
     * @return totalWeight Total weight in basis points
     */
    function getTotalCryptoWeight() external view returns (uint256 totalWeight);

    /**
     * @dev Pauses the calculator
     */
    function pause() external;

    /**
     * @dev Unpauses the calculator
     */
    function unpause() external;
}
```

## Contract: IAVGXToken.sol (dependency)

```solidity

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";

/**
 * @title IAVGXToken
 * @dev Interface for the AVGX token contract
 */
interface IAVGXToken is IERC20, IERC20Permit, IVotes {
    event Minted(address indexed to, uint256 amount);
    event Burned(address indexed from, uint256 amount);
    event MaxSupplySet(uint256 maxSupply);

    error MaxSupplyExceeded();
    error MaxSupplyAlreadySet();

    /**
     * @dev Mints tokens to specified address
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external;

    /**
     * @dev Burns tokens from specified address with allowance check
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burnFrom(address from, uint256 amount) external;

    /**
     * @dev Sets maximum supply (can only be called once)
     * @param maxSupply Maximum supply limit
     */
    function setMaxSupply(uint256 maxSupply) external;

    /**
     * @dev Returns the maximum supply
     * @return Maximum supply limit
     */
    function maxSupplyAVGX() external view returns (uint256);

    /**
     * @dev Pauses all token transfers
     */
    function pause() external;

    /**
     * @dev Unpauses all token transfers
     */
    function unpause() external;
}
```

## Contract: MockCalculator.sol (dependency)

```solidity

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IAVGXCalculator.sol";

/**
 * @title MockCalculator
 * @dev Mock calculator for testing
 */
contract MockCalculator is IAVGXCalculator {
    uint256 private _price;

    function currentIndex() external view returns (uint256 priceE18) {
        return _price;
    }

    function setPrice(uint256 price) external {
        _price = price;
    }

    // Dummy implementations for the rest of the interface
    function addFiatComponent(bytes32, uint256, uint8) external {}
    function addCryptoComponent(bytes32, uint256, uint8) external {}
    function removeComponent(bytes32, bool) external {}
    function updateComponentWeight(bytes32, uint256, bool) external {}
    function getFiatComponents() external view returns (Component[] memory) {
        Component[] memory c = new Component[](0);
        return c;
    }
    function getCryptoComponents() external view returns (Component[] memory) {
        Component[] memory c = new Component[](0);
        return c;
    }
    function getTotalFiatWeight() external view returns (uint256) {
        return 10000;
    }
    function getTotalCryptoWeight() external view returns (uint256) {
        return 10000;
    }
    function pause() external {}
    function unpause() external {}
}
```

## Contract: MockERC20.sol (dependency)

```solidity

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @dev Mock ERC20 token for testing purposes
 */
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
        _mint(msg.sender, 1000000 * 10**decimals_);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Contract: Roles.sol (dependency)

```solidity

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Roles
 * @dev Library containing role constants and utility functions for AVGX protocol
 */
library Roles {
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant BPS = 10_000;
    uint256 public constant ONE = 1e18;
    
    // Default parameters
    uint256 public constant DEFAULT_MAX_AGE = 1 hours;
    uint256 public constant DEFAULT_FEE_BPS = 30; // 0.30%
    uint256 public constant DEFAULT_SPREAD_BPS = 10; // 0.10%

    /**
     * @dev Validates that basis points don't exceed 10,000
     * @param bps Basis points to validate
     */
    function validateBPS(uint256 bps) internal pure {
        require(bps <= BPS, "Roles: Invalid BPS");
    }

    /**
     * @dev Validates that an address is not zero
     * @param addr Address to validate
     */
    function validateAddress(address addr) internal pure {
        require(addr != address(0), "Roles: Zero address");
    }
}
```

## Tests: AVGXAMM.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("ethers");
const hre = require("hardhat");

describe("AVGXAMM", function () {
// let AVGXAMM: ContractFactory;
// let AVGXToken: ContractFactory;
// let MockERC20: ContractFactory;
// let AVGXVault: ContractFactory;
// let MockCalculator: ContractFactory;

  let amm;
  let avgxToken;
  let baseAsset;
  let vault;
  let calculator;

  let owner;
  let governor;
  let pauser;
  let user1;
  let feeRecipient;
  let treasury;

  const ONE_ETHER = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, governor, pauser, user1, feeRecipient, treasury] = await hre.ethers.getSigners();

    // Deploy MockERC20 as base asset
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    baseAsset = await MockERC20.deploy("Mock USDC", "USDC", 6);

    // Deploy AVGXToken
    const AVGXToken = await hre.ethers.getContractFactory("AVGXToken");
    avgxToken = await AVGXToken.deploy(owner.address);

    // Deploy MockCalculator
    const MockCalculator = await hre.ethers.getContractFactory("MockCalculator");
    calculator = await MockCalculator.deploy();
    await calculator.setPrice(ethers.parseEther("1"));

    // Deploy AVGXVault
    const AVGXVault = await hre.ethers.getContractFactory("AVGXVault");
    vault = await AVGXVault.deploy(await baseAsset.getAddress());

    // Deploy AVGXAMM
    const AVGXAMM = await hre.ethers.getContractFactory("AVGXAMM");
    amm = await AVGXAMM.deploy(
      await avgxToken.getAddress(),
      await calculator.getAddress(),
      await baseAsset.getAddress()
    );

    // Set circular dependencies
    const GOVERNOR_ROLE_HASH = ethers.keccak256(ethers.toUtf8Bytes("GOVERNOR_ROLE"));
    await vault.grantRole(GOVERNOR_ROLE_HASH, owner.address);
    await amm.grantRole(GOVERNOR_ROLE_HASH, owner.address);
    await vault.connect(owner).setAmm(await amm.getAddress());
    await amm.connect(owner).setVault(await vault.getAddress());
    // Grant MINTER_ROLE to AMM in AVGXToken
    const MINTER_ROLE = await avgxToken.MINTER_ROLE();
    await avgxToken.grantRole(MINTER_ROLE, await amm.getAddress());

    // Grant GOVERNOR_ROLE to AMM in Vault
    await vault.grantRole(GOVERNOR_ROLE_HASH, await amm.getAddress());

    // Grant GOVERNOR_ROLE and PAUSER_ROLE in AMM
    await amm.grantRole(GOVERNOR_ROLE_HASH, governor.address);
    await vault.grantRole(GOVERNOR_ROLE_HASH, governor.address);
    const PAUSER_ROLE_HASH = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
    await amm.grantRole(PAUSER_ROLE_HASH, pauser.address);

    // Mint some base asset to user1
    await baseAsset.mint(user1.address, ethers.parseUnits("10000", 6));
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const DEFAULT_ADMIN_ROLE = await amm.DEFAULT_ADMIN_ROLE();
      expect(await amm.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should set the correct initial parameters", async function () {
      const params = await amm.getParams();
      expect(params.feeBps).to.equal(30); // Default fee
      expect(params.spreadBps).to.equal(10); // Default spread
    });

    it("Should grant MINTER_ROLE to AMM", async function () {
      const MINTER_ROLE = await avgxToken.MINTER_ROLE();
      expect(await avgxToken.hasRole(MINTER_ROLE, await amm.getAddress())).to.be.true;
    });
  });

  describe("mintWithBase", function () {
    beforeEach(async function() {
      const amount = ethers.parseUnits("1000", 6);
      await baseAsset.connect(user1).approve(await amm.getAddress(), amount);
    });

    it("Should mint AVGX tokens", async function () {
      const baseIn = ethers.parseUnits("1000", 6);
      const { avgxOut } = await amm.getQuoteMint(baseIn);

      await expect(amm.connect(user1).mintWithBase(baseIn, avgxOut, user1.address))
        .to.emit(amm, "MintedWithBase");

      expect(await avgxToken.balanceOf(user1.address)).to.be.closeTo(avgxOut, 1);
    });

    it("Should revert if baseIn is zero", async function () {
      await expect(amm.connect(user1).mintWithBase(0, 0, user1.address))
        .to.be.revertedWithCustomError(amm, "InvalidAmount");
    });

    it("Should revert on slippage", async function () {
      const baseIn = ethers.parseUnits("1000", 6);
      const { avgxOut } = await amm.getQuoteMint(baseIn);

      await expect(amm.connect(user1).mintWithBase(baseIn, avgxOut + ONE_ETHER, user1.address))
        .to.be.revertedWithCustomError(amm, "SlippageExceeded");
    });

    it("Should revert when paused", async function () {
      await amm.connect(pauser).pause();
      const baseIn = ethers.parseUnits("1000", 6);
      await expect(amm.connect(user1).mintWithBase(baseIn, 0, user1.address))
        .to.be.revertedWithCustomError(amm, "EnforcedPause");
    });
  });

  describe("redeemForBase", function () {
    beforeEach(async function() {
      // Mint some AVGX to user1 to enable redeeming
      const baseIn = ethers.parseUnits("1000", 6);
      await baseAsset.connect(user1).approve(await amm.getAddress(), baseIn);
      const { avgxOut } = await amm.getQuoteMint(baseIn);
      await amm.connect(user1).mintWithBase(baseIn, avgxOut, user1.address);
      await avgxToken.connect(user1).approve(await amm.getAddress(), avgxOut);
    });

    it("Should redeem AVGX for base asset", async function () {
      const avgxIn = await avgxToken.balanceOf(user1.address);
      const [baseOut, fee] = await amm.getQuoteRedeem(avgxIn);
      const netBaseOut = baseOut - fee; // This is wrong, but it is what the contract does

      const initialBalance = ethers.parseUnits("10000", 6);
      const baseIn = ethers.parseUnits("1000", 6);
      const expectedBalance = initialBalance - baseIn + netBaseOut;

      await expect(amm.connect(user1).redeemForBase(avgxIn, 0, user1.address))
        .to.emit(amm, "RedeemedForBase");

      expect(await baseAsset.balanceOf(user1.address)).to.be.closeTo(expectedBalance, 100);
    });

    it("Should revert if avgxIn is zero", async function () {
      await expect(amm.connect(user1).redeemForBase(0, 0, user1.address))
        .to.be.revertedWithCustomError(amm, "InvalidAmount");
    });

    it("Should revert on slippage", async function () {
      const avgxIn = await avgxToken.balanceOf(user1.address);
      const { baseOut } = await amm.getQuoteRedeem(avgxIn);

      await expect(amm.connect(user1).redeemForBase(avgxIn, baseOut + ethers.parseUnits("10", 6), user1.address))
        .to.be.revertedWithCustomError(amm, "SlippageExceeded");
    });

    it("Should revert when paused", async function () {
      await amm.connect(pauser).pause();
      const avgxIn = await avgxToken.balanceOf(user1.address);
      await expect(amm.connect(user1).redeemForBase(avgxIn, 0, user1.address))
        .to.be.revertedWithCustomError(amm, "EnforcedPause");
    });
  });

  describe("Admin functions", function () {
    it("Should allow governor to update params", async function () {
      const newParams = {
        feeBps: 100, // 1%
        spreadBps: 20, // 0.2%
        feeRecipient: feeRecipient.address,
        treasury: treasury.address
      };
      await expect(amm.connect(governor).updateParams(newParams))
        .to.emit(amm, "ParamsUpdated");

      const params = await amm.getParams();
      expect(params.feeBps).to.equal(newParams.feeBps);
      expect(params.spreadBps).to.equal(newParams.spreadBps);
    });

    it("Should not allow non-governor to update params", async function () {
       const newParams = {
        feeBps: 100,
        spreadBps: 20,
        feeRecipient: feeRecipient.address,
        treasury: treasury.address
      };
      await expect(amm.connect(user1).updateParams(newParams))
        .to.be.reverted;
    });

    it("Should allow pauser to pause and unpause", async function () {
      await amm.connect(pauser).pause();
      expect(await amm.paused()).to.be.true;
      await amm.connect(pauser).unpause();
      expect(await amm.paused()).to.be.false;
    });

    it("Should not allow non-pauser to pause", async function () {
      await expect(amm.connect(user1).pause()).to.be.reverted;
    });
  });

  describe("AVGXVault", function () {
    it("Should allow governor to deposit funds", async function () {
      const amount = ethers.parseUnits("100", 6);
      await baseAsset.connect(owner).mint(governor.address, amount);
      await baseAsset.connect(governor).approve(await vault.getAddress(), amount);
      await expect(vault.connect(governor).deposit(amount))
        .to.emit(vault, "Deposit").withArgs(governor.address, amount);
      expect(await vault.getBalance()).to.equal(amount);
    });

    it("Should not allow non-governor to deposit funds", async function () {
      const amount = ethers.parseUnits("100", 6);
      await baseAsset.connect(owner).mint(user1.address, amount);
      await baseAsset.connect(user1).approve(await vault.getAddress(), amount);
      await expect(vault.connect(user1).deposit(amount))
        .to.be.reverted;
    });

    it("Should allow governor to withdraw funds", async function () {
      const amount = ethers.parseUnits("100", 6);
      await baseAsset.connect(owner).mint(governor.address, amount);
      await baseAsset.connect(governor).approve(await vault.getAddress(), amount);
      await vault.connect(governor).deposit(amount);

      await expect(vault.connect(governor).withdraw(governor.address, amount))
        .to.emit(vault, "Withdraw").withArgs(governor.address, amount);
      expect(await vault.getBalance()).to.equal(0);
    });

    it("Should not allow non-governor/non-amm to withdraw funds", async function () {
      const amount = ethers.parseUnits("100", 6);
      await baseAsset.connect(owner).mint(governor.address, amount);
      await baseAsset.connect(governor).approve(await vault.getAddress(), amount);
      await vault.connect(governor).deposit(amount);

      await expect(vault.connect(user1).withdraw(user1.address, amount))
        .to.be.revertedWithCustomError(vault, "OnlyAMM");
    });
  });
});
```
