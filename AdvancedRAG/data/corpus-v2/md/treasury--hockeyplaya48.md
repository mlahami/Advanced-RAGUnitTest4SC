# treasury--hockeyplaya48

- domain: multisig-treasury (treasury)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/HockeyPlaya48/RWAForge @ d44d18a4662200d40ece8d769d59578c2ca623fb
- license: MIT
- targets: Treasury.sol, IRWASwapRouter.sol, MockERC20.sol, MockSwapRouter.sol
- validation: 7 passing tests, 0 failing; statement coverage Treasury.sol 100.0 %, IRWASwapRouter.sol 100.0 %, MockERC20.sol 50.0 %, MockSwapRouter.sol 100.0 %

## Contract: IRWASwapRouter.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IRWASwapRouter
/// @notice Minimal interface Treasury relies on to convert fee-token balances
///         into supported RWAs (e.g. Robinhood Chain stock tokens).
/// @dev Deliberately generic so any DEX/aggregator adapter (Uniswap-style router,
///      1inch-style aggregator, an RFQ system, etc.) can implement it and be
///      plugged into Treasury without changing Treasury itself. Integrators
///      provide their own implementation of this interface.
interface IRWASwapRouter {
    /// @notice Swap an exact amount of `tokenIn` for at least `minAmountOut` of `tokenOut`.
    /// @param tokenIn Token being sold (typically an accumulated protocol-fee token).
    /// @param tokenOut Target RWA token to acquire.
    /// @param amountIn Exact amount of `tokenIn` to sell.
    /// @param minAmountOut Minimum acceptable amount of `tokenOut` (slippage bound).
    /// @param recipient Address to receive `tokenOut` (normally the calling Treasury).
    /// @return amountOut Actual amount of `tokenOut` received.
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut);
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal mintable ERC-20 used only in the test suite to simulate
///         RWA/stock tokens and fee tokens. Not part of the deployed protocol.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Contract: MockSwapRouter.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRWASwapRouter} from "./IRWASwapRouter.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Test-only IRWASwapRouter implementation: "swaps" by pulling tokenIn
///         from the caller and minting tokenOut 1:1 to the recipient. Lets the
///         test suite exercise Treasury.executeSwap without a real DEX.
contract MockSwapRouter is IRWASwapRouter {
    using SafeERC20 for IERC20;

    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        amountOut = amountIn;
        require(amountOut >= minAmountOut, "slippage");
        MockERC20(tokenOut).mint(recipient, amountOut);
    }
}
```

## Contract: Treasury.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRWASwapRouter} from "./IRWASwapRouter.sol";

/// @title Treasury
/// @notice Collects protocol fees forwarded by DistributionRouter, swaps them
///         into governance-approved RWAs, and tracks resulting holdings so
///         they can be pushed out to RewardClaimer for pro-rata distribution.
/// @dev Role-based rather than single-owner so that an automated
///      keeper/agent (OPERATOR_ROLE) can execute pre-approved swaps without
///      holding withdrawal rights, which stay with GOVERNANCE_ROLE
///      (expected to be a multisig, later a DAO governor).
contract Treasury is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice RWA tokens governance has approved as valid swap destinations.
    mapping(address => bool) public isSupportedRWA;

    /// @notice Running tally of each RWA token acquired via swaps, for portfolio tracking.
    mapping(address => uint256) public rwaHoldings;

    /// @notice Emitted when a distributor logs a fee deposit via `notifyFeeReceived`.
    event FeeReceived(address indexed token, uint256 amount, address indexed from);
    /// @notice Emitted when governance adds or removes a token from the supported-RWA list.
    event RWASupportUpdated(address indexed token, bool supported);
    /// @notice Emitted after an operator executes a fee-token -> RWA swap.
    event RWASwapExecuted(
        address indexed router,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    /// @notice Emitted when governance withdraws tokens from the treasury.
    event Withdrawal(address indexed token, address indexed to, uint256 amount);

    /// @dev Thrown when `executeSwap` targets a `tokenOut` not on the supported-RWA list.
    error UnsupportedRWA(address token);
    /// @dev Thrown when a zero address is passed where a real address is required.
    error ZeroAddress();
    /// @dev Thrown when a zero amount is passed where a positive amount is required.
    error ZeroAmount();

    /// @param governance Address granted DEFAULT_ADMIN_ROLE and GOVERNANCE_ROLE at deploy.
    constructor(address governance) {
        if (governance == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(GOVERNANCE_ROLE, governance);
    }

    /// @notice Protocol fees arrive here via plain ERC-20 transfers from
    ///         DistributionRouter. This helper lets a distributor emit an
    ///         indexable record of the deposit in the same transaction if desired;
    ///         it is optional bookkeeping, not required for funds to be usable.
    /// @param token Fee token that was deposited.
    /// @param amount Amount deposited.
    function notifyFeeReceived(address token, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        emit FeeReceived(token, amount, msg.sender);
    }

    /// @notice Add or remove a token from the supported-RWA swap-destination list.
    /// @param token RWA token to update.
    /// @param supported Whether `token` is a valid `executeSwap` destination.
    function setSupportedRWA(address token, bool supported) external onlyRole(GOVERNANCE_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        isSupportedRWA[token] = supported;
        emit RWASupportUpdated(token, supported);
    }

    /// @notice Swap accumulated fee-token balance into a supported RWA.
    /// @dev Restricted to OPERATOR_ROLE so keepers/agents can execute
    ///      governance-approved swaps without holding withdrawal rights.
    ///      `minAmountOut` is the caller's responsibility (slippage protection).
    /// @param router Swap adapter implementing IRWASwapRouter.
    /// @param tokenIn Fee token being sold.
    /// @param tokenOut Supported RWA token being acquired.
    /// @param amountIn Exact amount of `tokenIn` to sell.
    /// @param minAmountOut Minimum acceptable amount of `tokenOut` (slippage bound).
    /// @return amountOut Actual amount of `tokenOut` received.
    function executeSwap(
        IRWASwapRouter router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external onlyRole(OPERATOR_ROLE) nonReentrant returns (uint256 amountOut) {
        if (!isSupportedRWA[tokenOut]) revert UnsupportedRWA(tokenOut);
        if (amountIn == 0) revert ZeroAmount();

        IERC20(tokenIn).forceApprove(address(router), amountIn);
        amountOut = router.swapExactIn(tokenIn, tokenOut, amountIn, minAmountOut, address(this));
        IERC20(tokenIn).forceApprove(address(router), 0);

        rwaHoldings[tokenOut] += amountOut;
        emit RWASwapExecuted(address(router), tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice Withdraw tokens from the treasury — e.g. to fund a new RewardClaimer
    ///         Merkle round, or for approved operational spend.
    /// @param token Token to withdraw.
    /// @param to Recipient of the withdrawn tokens.
    /// @param amount Amount to withdraw.
    function withdraw(address token, address to, uint256 amount)
        external
        onlyRole(GOVERNANCE_ROLE)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (rwaHoldings[token] >= amount) {
            rwaHoldings[token] -= amount;
        } else if (rwaHoldings[token] > 0) {
            rwaHoldings[token] = 0;
        }

        emit Withdrawal(token, to, amount);
        IERC20(token).safeTransfer(to, amount);
    }
}
```

## Tests: Treasury.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Treasury", () => {
  async function deploy() {
    const [governance, operator, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
    await feeToken.waitForDeployment();
    const rwaToken = await MockERC20.deploy("RWA Stock", "RWAX", 18);
    await rwaToken.waitForDeployment();

    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(governance.address);
    await treasury.waitForDeployment();

    const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
    const swapRouter = await MockSwapRouter.deploy();
    await swapRouter.waitForDeployment();

    const operatorRole = await treasury.OPERATOR_ROLE();
    await treasury.connect(governance).grantRole(operatorRole, operator.address);

    await feeToken.mint(await treasury.getAddress(), ethers.parseEther("1000"));

    return { treasury, feeToken, rwaToken, swapRouter, governance, operator, other };
  }

  it("only governance can toggle supported RWAs", async () => {
    const { treasury, rwaToken, governance, other } = await deploy();
    await expect(
      treasury.connect(other).setSupportedRWA(await rwaToken.getAddress(), true)
    ).to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount");

    await treasury.connect(governance).setSupportedRWA(await rwaToken.getAddress(), true);
    expect(await treasury.isSupportedRWA(await rwaToken.getAddress())).to.equal(true);
  });

  it("only OPERATOR_ROLE can execute swaps, and only into supported RWAs", async () => {
    const { treasury, feeToken, rwaToken, swapRouter, governance, operator, other } = await deploy();

    await expect(
      treasury
        .connect(other)
        .executeSwap(
          await swapRouter.getAddress(),
          await feeToken.getAddress(),
          await rwaToken.getAddress(),
          ethers.parseEther("100"),
          0n
        )
    ).to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount");

    await expect(
      treasury
        .connect(operator)
        .executeSwap(
          await swapRouter.getAddress(),
          await feeToken.getAddress(),
          await rwaToken.getAddress(),
          ethers.parseEther("100"),
          0n
        )
    ).to.be.revertedWithCustomError(treasury, "UnsupportedRWA");

    await treasury.connect(governance).setSupportedRWA(await rwaToken.getAddress(), true);

    await expect(
      treasury
        .connect(operator)
        .executeSwap(
          await swapRouter.getAddress(),
          await feeToken.getAddress(),
          await rwaToken.getAddress(),
          ethers.parseEther("100"),
          0n
        )
    ).to.emit(treasury, "RWASwapExecuted");

    expect(await rwaToken.balanceOf(await treasury.getAddress())).to.equal(ethers.parseEther("100"));
    expect(await treasury.rwaHoldings(await rwaToken.getAddress())).to.equal(ethers.parseEther("100"));
  });

  it("only governance can withdraw", async () => {
    const { treasury, feeToken, governance, other } = await deploy();
    await expect(
      treasury.connect(other).withdraw(await feeToken.getAddress(), other.address, 1n)
    ).to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount");

    await treasury.connect(governance).withdraw(await feeToken.getAddress(), other.address, ethers.parseEther("10"));
    expect(await feeToken.balanceOf(other.address)).to.equal(ethers.parseEther("10"));
  });

  it("rejects zero recipient or zero amount on withdraw", async () => {
    const { treasury, feeToken, governance, other } = await deploy();
    await expect(
      treasury.connect(governance).withdraw(await feeToken.getAddress(), ethers.ZeroAddress, 1n)
    ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    await expect(
      treasury.connect(governance).withdraw(await feeToken.getAddress(), other.address, 0n)
    ).to.be.revertedWithCustomError(treasury, "ZeroAmount");
  });

  it("notifyFeeReceived emits an event and rejects a zero amount", async () => {
    const { treasury, feeToken, other } = await deploy();
    await expect(treasury.connect(other).notifyFeeReceived(await feeToken.getAddress(), 1n))
      .to.emit(treasury, "FeeReceived")
      .withArgs(await feeToken.getAddress(), 1n, other.address);

    await expect(
      treasury.connect(other).notifyFeeReceived(await feeToken.getAddress(), 0n)
    ).to.be.revertedWithCustomError(treasury, "ZeroAmount");
  });

  it("decrements tracked rwaHoldings when withdrawing less than the tracked balance", async () => {
    const { treasury, feeToken, rwaToken, swapRouter, governance, operator, other } = await deploy();
    await treasury.connect(governance).setSupportedRWA(await rwaToken.getAddress(), true);
    await treasury
      .connect(operator)
      .executeSwap(await swapRouter.getAddress(), await feeToken.getAddress(), await rwaToken.getAddress(), ethers.parseEther("100"), 0n);

    await treasury.connect(governance).withdraw(await rwaToken.getAddress(), other.address, ethers.parseEther("40"));
    expect(await treasury.rwaHoldings(await rwaToken.getAddress())).to.equal(ethers.parseEther("60"));
  });

  it("zeroes out tracked rwaHoldings when withdrawing more than the tracked balance", async () => {
    const { treasury, feeToken, rwaToken, swapRouter, governance, operator, other } = await deploy();
    await treasury.connect(governance).setSupportedRWA(await rwaToken.getAddress(), true);
    await treasury
      .connect(operator)
      .executeSwap(await swapRouter.getAddress(), await feeToken.getAddress(), await rwaToken.getAddress(), ethers.parseEther("100"), 0n);

    // Simulate an untracked direct deposit, so actual balance (150) exceeds tracked rwaHoldings (100).
    await rwaToken.mint(await treasury.getAddress(), ethers.parseEther("50"));

    await treasury.connect(governance).withdraw(await rwaToken.getAddress(), other.address, ethers.parseEther("120"));
    expect(await treasury.rwaHoldings(await rwaToken.getAddress())).to.equal(0n);
    expect(await rwaToken.balanceOf(other.address)).to.equal(ethers.parseEther("120"));
  });
});
```
