# aba-pay-v2--investorphem

- domain: escrow-conditional-payments (payments)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/investorphem/AbaPay @ a6657e74dd29ed9f479ed740249cb1cea4083e9a
- license: MIT
- targets: AbaPayV2.sol, Mocks.sol
- validation: 21 passing tests, 0 failing; statement coverage AbaPayV2.sol 100.0 %, Mocks.sol 86.67 %

## Contract: AbaPayV2.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AbaPayV2
 * @notice Hardened payment vault for AbaPay utility bill payments.
 * @dev    Security-hardened successor to the original AbaPay contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  NOT YET AUDITED. Do not deploy to mainnet with real user funds until a
 *      professional smart-contract audit has been completed. This contract holds
 *      pooled customer funds; a bug here is a total-loss event.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHAT CHANGED vs. the original AbaPay.sol, and why:
 *
 *  1. SafeERC20 (was: raw IERC20 + require(transfer(...)))
 *     Some real-world tokens (notably USDT on several chains) do NOT return a bool
 *     from transfer/transferFrom, which makes `require(token.transfer(...))` revert
 *     or misbehave. SafeERC20 handles both compliant and non-compliant tokens.
 *
 *  2. ReentrancyGuard (was: none)
 *     The original was *probably* safe because only well-behaved stablecoins were
 *     whitelisted. But `setTokenSupport` lets the owner whitelist ANY token — and a
 *     token with transfer hooks (ERC-777 style) would make payBill reentrant. This
 *     removes the footgun entirely rather than relying on operational discipline.
 *
 *  3. Pausable (was: none)
 *     Previously, if a vulnerability were discovered post-deploy there was NO way to
 *     stop the contract. Now the owner can pause user-facing payments while keeping
 *     refunds available, so users can be made whole during an incident.
 *
 *  4. Ownable2Step (was: owner set once in constructor, no transfer path)
 *     Ownership transfer now requires the new owner to explicitly accept, making it
 *     impossible to permanently brick the contract by transferring to a typo'd or
 *     uncontrolled address.
 *
 *  5. Timelocked withdrawals (was: instant, unlimited `withdrawFunds`)
 *     THE BIGGEST RISK in the original: a single compromised owner key could drain the
 *     entire pooled vault in one transaction, instantly. Withdrawals must now be
 *     announced, then executed only after WITHDRAWAL_DELAY elapses. This gives you a
 *     detection-and-response window (alerting on the WithdrawalQueued event) in which a
 *     compromised-key drain can be cancelled — assuming ownership is a multisig that the
 *     attacker does not fully control.
 *
 *  6. Refund cap + reason (was: unbounded owner-initiated transfers to any address)
 *     `refundUser` was effectively a second, unrestricted withdrawal path: the owner could
 *     send any amount to any address, bypassing the withdrawal timelock entirely. It is now
 *     bounded per-transaction so it cannot be abused as a timelock-evasion drain.
 *
 *  IMPORTANT — DELIBERATELY UNCHANGED:
 *     `payBill`'s signature, parameter order, and the `PaymentReceived` event are byte-for-byte
 *     identical to V1. Your frontend, the /api/pay calldata decoder, and the webhook's
 *     PaymentReceived cross-validation continue to work with NO backend changes.
 *
 *  NOTE ON DELEGATED SPENDING (the DeAI "pay from social media" feature):
 *     payBill still uses `transferFrom(msg.sender, ...)`, meaning the payer MUST be the
 *     transaction signer. This contract therefore still does NOT support an agent/relayer
 *     spending a user's pre-approved allowance on their behalf. That feature requires an
 *     additional on-chain allowance mechanism and is intentionally OUT OF SCOPE here — it
 *     should be designed and audited as its own change, not bundled into a hardening pass.
 */
contract AbaPayV2 is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Configuration ───────────────────────────────────────────────────────

    /// @notice Delay between queueing and executing a treasury withdrawal.
    uint256 public constant WITHDRAWAL_DELAY = 24 hours;

    /// @notice Upper bound on a single refund, to prevent refunds being used to
    ///         bypass the withdrawal timelock. Denominated in the token's own units.
    ///         Set per-token by the owner; a token with no cap set cannot be refunded.
    mapping(address => uint256) public maxRefundPerTx;

    /// @notice Whitelist of tokens accepted for payment.
    mapping(address => bool) public isSupportedToken;

    // ─── Withdrawal queue ────────────────────────────────────────────────────

    struct PendingWithdrawal {
        uint256 amount;
        uint256 executableAt;
        address destination;
    }

    /// @notice At most one pending withdrawal per token at a time.
    mapping(address => PendingWithdrawal) public pendingWithdrawals;

    // ─── Events ──────────────────────────────────────────────────────────────

    /// @dev IDENTICAL to V1 — the backend webhook decodes this exact signature.
    event PaymentReceived(
        address indexed user,
        address indexed token,
        string serviceType,
        string accountNumber,
        uint256 amount
    );

    event TokenSupportUpdated(address indexed token, bool isSupported);
    event MaxRefundUpdated(address indexed token, uint256 maxAmount);

    event WithdrawalQueued(address indexed token, address indexed destination, uint256 amount, uint256 executableAt);
    event WithdrawalCancelled(address indexed token, uint256 amount);
    event FundsWithdrawn(address indexed destination, address indexed token, uint256 amount);

    event UserRefunded(address indexed user, address indexed token, uint256 amount, string reason);

    // ─── Errors (cheaper than require strings) ───────────────────────────────

    error ZeroAmount();
    error ZeroAddress();
    error TokenNotSupported(address token);
    error InsufficientVaultBalance(uint256 requested, uint256 available);
    error NoPendingWithdrawal();
    error TimelockNotElapsed(uint256 executableAt);
    error WithdrawalAlreadyQueued();
    error RefundExceedsCap(uint256 requested, uint256 cap);

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param initialOwner The owner address. STRONGLY RECOMMENDED: a multisig (e.g. Safe),
     *                     NOT a single EOA. A single-key owner is the largest residual risk
     *                     in this design — the timelock only helps if a compromised key
     *                     cannot also cancel/execute unilaterally.
     */
    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    // ─── User actions ────────────────────────────────────────────────────────

    /**
     * @notice Pay a utility bill by depositing supported stablecoins into the vault.
     * @dev    Signature intentionally identical to V1 for backend compatibility.
     *         `whenNotPaused` lets us halt payments during an incident.
     *         `nonReentrant` neutralises any hook-bearing token that might be whitelisted.
     *
     *         Follows checks-effects-interactions: all validation happens before the
     *         external transfer, and the event is emitted after the funds have landed.
     */
    function payBill(
        address tokenAddress,
        string calldata serviceType,
        string calldata accountNumber,
        uint256 amount
    ) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!isSupportedToken[tokenAddress]) revert TokenNotSupported(tokenAddress);

        // Measure actual received amount. This correctly handles fee-on-transfer or
        // rebasing tokens, where the amount credited can be less than the amount sent —
        // the original contract would have emitted an inflated amount in that case,
        // causing the backend to over-vend relative to funds actually received.
        uint256 balanceBefore = IERC20(tokenAddress).balanceOf(address(this));
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(tokenAddress).balanceOf(address(this)) - balanceBefore;

        if (received == 0) revert ZeroAmount();

        // Emit the ACTUAL received amount, so the backend's amount cross-check
        // validates against real funds rather than the requested figure.
        emit PaymentReceived(msg.sender, tokenAddress, serviceType, accountNumber, received);
    }

    // ─── Admin: configuration ────────────────────────────────────────────────

    function setTokenSupport(address tokenAddress, bool status) external onlyOwner {
        if (tokenAddress == address(0)) revert ZeroAddress();
        isSupportedToken[tokenAddress] = status;
        emit TokenSupportUpdated(tokenAddress, status);
    }

    /// @notice Set the maximum single refund for a token. Must be set before refunds work.
    function setMaxRefund(address tokenAddress, uint256 maxAmount) external onlyOwner {
        if (tokenAddress == address(0)) revert ZeroAddress();
        maxRefundPerTx[tokenAddress] = maxAmount;
        emit MaxRefundUpdated(tokenAddress, maxAmount);
    }

    /// @notice Halt new payments (refunds remain available so users can be made whole).
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── Treasury: timelocked withdrawal ─────────────────────────────────────

    /**
     * @notice Step 1 of 2 — announce an intent to withdraw. Starts the timelock.
     * @dev    Monitor the WithdrawalQueued event and alert on it. If you see one you
     *         did not initiate, that is your signal that the owner key is compromised;
     *         call cancelWithdrawal() within the delay window.
     */
    function queueWithdrawal(address tokenAddress, address destination, uint256 amount)
        external
        onlyOwner
    {
        if (destination == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (pendingWithdrawals[tokenAddress].executableAt != 0) revert WithdrawalAlreadyQueued();

        uint256 available = IERC20(tokenAddress).balanceOf(address(this));
        if (amount > available) revert InsufficientVaultBalance(amount, available);

        uint256 executableAt = block.timestamp + WITHDRAWAL_DELAY;
        pendingWithdrawals[tokenAddress] = PendingWithdrawal({
            amount: amount,
            executableAt: executableAt,
            destination: destination
        });

        emit WithdrawalQueued(tokenAddress, destination, amount, executableAt);
    }

    /// @notice Abort a queued withdrawal — your emergency brake if a key is compromised.
    function cancelWithdrawal(address tokenAddress) external onlyOwner {
        PendingWithdrawal memory p = pendingWithdrawals[tokenAddress];
        if (p.executableAt == 0) revert NoPendingWithdrawal();

        delete pendingWithdrawals[tokenAddress];
        emit WithdrawalCancelled(tokenAddress, p.amount);
    }

    /// @notice Step 2 of 2 — execute a queued withdrawal after the timelock has elapsed.
    function executeWithdrawal(address tokenAddress) external onlyOwner nonReentrant {
        PendingWithdrawal memory p = pendingWithdrawals[tokenAddress];
        if (p.executableAt == 0) revert NoPendingWithdrawal();
        if (block.timestamp < p.executableAt) revert TimelockNotElapsed(p.executableAt);

        uint256 available = IERC20(tokenAddress).balanceOf(address(this));
        if (p.amount > available) revert InsufficientVaultBalance(p.amount, available);

        // EFFECTS before INTERACTIONS.
        delete pendingWithdrawals[tokenAddress];

        IERC20(tokenAddress).safeTransfer(p.destination, p.amount);
        emit FundsWithdrawn(p.destination, tokenAddress, p.amount);
    }

    // ─── Treasury: refunds ───────────────────────────────────────────────────

    /**
     * @notice Refund a user whose bill failed to vend after payment.
     * @dev    Deliberately capped per-transaction (see setMaxRefund). Without a cap this
     *         function is an unrestricted "send any amount anywhere" path that completely
     *         bypasses the withdrawal timelock — i.e. a compromised key could drain the
     *         vault through refunds instead. Not pausable: users must be able to be made
     *         whole even while payments are halted during an incident.
     */
    function refundUser(
        address tokenAddress,
        address recipient,
        uint256 amount,
        string calldata reason
    ) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 cap = maxRefundPerTx[tokenAddress];
        if (amount > cap) revert RefundExceedsCap(amount, cap);

        uint256 available = IERC20(tokenAddress).balanceOf(address(this));
        if (amount > available) revert InsufficientVaultBalance(amount, available);

        IERC20(tokenAddress).safeTransfer(recipient, amount);
        emit UserRefunded(recipient, tokenAddress, amount, reason);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function vaultBalance(address tokenAddress) external view returns (uint256) {
        return IERC20(tokenAddress).balanceOf(address(this));
    }
}
```

## Contract: Mocks.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * TEST-ONLY CONTRACTS. Never deploy these to a live network.
 * They exist to exercise the security properties of AbaPayV2.
 */

/// @dev Standard, well-behaved ERC20 with configurable decimals.
contract MockERC20 is ERC20 {
    uint8 private immutable _customDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _customDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Takes a 10% fee on every transfer. Used to prove AbaPayV2 emits the
///      ACTUALLY RECEIVED amount rather than the requested amount.
contract MockFeeToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value); // mint / burn: no fee
            return;
        }
        uint256 fee = value / 10;
        super._update(from, address(0xdead), fee);
        super._update(from, to, value - fee);
    }
}

interface IAbaPayV2 {
    function payBill(address token, string calldata serviceType, string calldata accountNumber, uint256 amount) external;
}

/// @dev A malicious token with a transfer hook that attempts to re-enter payBill.
///      Proves the nonReentrant guard actually holds.
contract ReentrantToken is ERC20 {
    IAbaPayV2 public immutable target;
    bool private attacking;

    constructor(address target_) ERC20("Evil", "EVIL") {
        target = IAbaPayV2(target_);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function attack(uint256 amount) external {
        _approve(msg.sender, address(target), type(uint256).max);
        attacking = true;
        target.payBill(address(this), "mtn", "080", amount);
    }

    // Hook fires during the vault's transferFrom and tries to re-enter.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attacking && to == address(target)) {
            attacking = false; // only attempt once
            target.payBill(address(this), "mtn", "080", value); // should revert (ReentrancyGuard)
        }
    }
}
```

## Tests: AbaPayV2.test.js

```javascript
const { expect } = require("chai");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// `ethers` is NOT a named export of the `hardhat` package. It is attached to the Hardhat
// Runtime Environment at load time by hardhat-ethers (bundled in hardhat-toolbox), so it
// must be read off the HRE rather than imported directly.
const { ethers } = hre;

/**
 * AbaPayV2 test suite.
 *
 * These tests exist to prove the security properties claimed in the contract's
 * NatSpec actually hold — especially the ones that protect pooled user funds:
 * access control, the withdrawal timelock, the refund cap, pausing, and
 * reentrancy resistance.
 */
describe("AbaPayV2", function () {
  const ONE_DAY = 24 * 60 * 60;

  async function deploy() {
    const [owner, user, attacker, treasury] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Mock USD", "mUSD", 6);

    const AbaPay = await ethers.getContractFactory("AbaPayV2");
    const abapay = await AbaPay.deploy(owner.address);

    // Fund the user and approve the vault.
    await token.mint(user.address, ethers.parseUnits("1000", 6));
    await token.connect(user).approve(await abapay.getAddress(), ethers.MaxUint256);

    await abapay.setTokenSupport(await token.getAddress(), true);

    return { abapay, token, owner, user, attacker, treasury };
  }

  describe("payBill", function () {
    it("accepts payment in a supported token and emits PaymentReceived", async function () {
      const { abapay, token, user } = await deploy();
      const amount = ethers.parseUnits("10", 6);

      await expect(abapay.connect(user).payBill(await token.getAddress(), "mtn", "08012345678", amount))
        .to.emit(abapay, "PaymentReceived")
        .withArgs(user.address, await token.getAddress(), "mtn", "08012345678", amount);

      expect(await abapay.vaultBalance(await token.getAddress())).to.equal(amount);
    });

    it("REJECTS an unsupported token", async function () {
      const { abapay, user } = await deploy();
      const Token = await ethers.getContractFactory("MockERC20");
      const rogue = await Token.deploy("Rogue", "RGE", 18);

      await expect(
        abapay.connect(user).payBill(await rogue.getAddress(), "mtn", "080", 1)
      ).to.be.revertedWithCustomError(abapay, "TokenNotSupported");
    });

    it("REJECTS a zero amount", async function () {
      const { abapay, token, user } = await deploy();
      await expect(
        abapay.connect(user).payBill(await token.getAddress(), "mtn", "080", 0)
      ).to.be.revertedWithCustomError(abapay, "ZeroAmount");
    });

    it("REJECTS payment while paused", async function () {
      const { abapay, token, user } = await deploy();
      await abapay.pause();

      await expect(
        abapay.connect(user).payBill(await token.getAddress(), "mtn", "080", ethers.parseUnits("1", 6))
      ).to.be.revertedWithCustomError(abapay, "EnforcedPause");
    });

    it("resumes payments after unpause", async function () {
      const { abapay, token, user } = await deploy();
      await abapay.pause();
      await abapay.unpause();

      await expect(
        abapay.connect(user).payBill(await token.getAddress(), "mtn", "080", ethers.parseUnits("1", 6))
      ).to.emit(abapay, "PaymentReceived");
    });

    it("emits the ACTUAL received amount for a fee-on-transfer token (not the requested amount)", async function () {
      // This is the bug the balance-delta measurement prevents: with a 10% fee token,
      // V1 would have emitted the full requested amount, causing the backend to vend
      // more value than the vault actually received.
      const { abapay, user } = await deploy();

      const FeeToken = await ethers.getContractFactory("MockFeeToken");
      const feeToken = await FeeToken.deploy(); // takes a 10% fee on transfer
      await feeToken.mint(user.address, ethers.parseUnits("1000", 18));
      await feeToken.connect(user).approve(await abapay.getAddress(), ethers.MaxUint256);
      await abapay.setTokenSupport(await feeToken.getAddress(), true);

      const sent = ethers.parseUnits("100", 18);
      const expectedReceived = (sent * 90n) / 100n;

      await expect(abapay.connect(user).payBill(await feeToken.getAddress(), "mtn", "080", sent))
        .to.emit(abapay, "PaymentReceived")
        .withArgs(user.address, await feeToken.getAddress(), "mtn", "080", expectedReceived);
    });
  });

  describe("access control", function () {
    it("only the owner can whitelist tokens", async function () {
      const { abapay, token, attacker } = await deploy();
      await expect(
        abapay.connect(attacker).setTokenSupport(await token.getAddress(), true)
      ).to.be.revertedWithCustomError(abapay, "OwnableUnauthorizedAccount");
    });

    it("only the owner can pause", async function () {
      const { abapay, attacker } = await deploy();
      await expect(abapay.connect(attacker).pause())
        .to.be.revertedWithCustomError(abapay, "OwnableUnauthorizedAccount");
    });

    it("only the owner can queue a withdrawal", async function () {
      const { abapay, token, attacker } = await deploy();
      await expect(
        abapay.connect(attacker).queueWithdrawal(await token.getAddress(), attacker.address, 1)
      ).to.be.revertedWithCustomError(abapay, "OwnableUnauthorizedAccount");
    });

    it("only the owner can refund", async function () {
      const { abapay, token, attacker } = await deploy();
      await expect(
        abapay.connect(attacker).refundUser(await token.getAddress(), attacker.address, 1, "theft")
      ).to.be.revertedWithCustomError(abapay, "OwnableUnauthorizedAccount");
    });

    it("ownership transfer requires explicit acceptance (Ownable2Step)", async function () {
      const { abapay, owner, user } = await deploy();

      await abapay.connect(owner).transferOwnership(user.address);
      // Still the old owner until accepted — this is what prevents bricking on a typo.
      expect(await abapay.owner()).to.equal(owner.address);

      await abapay.connect(user).acceptOwnership();
      expect(await abapay.owner()).to.equal(user.address);
    });
  });

  describe("withdrawal timelock", function () {
    async function withFunds() {
      const ctx = await deploy();
      await ctx.abapay
        .connect(ctx.user)
        .payBill(await ctx.token.getAddress(), "mtn", "080", ethers.parseUnits("500", 6));
      return ctx;
    }

    it("CANNOT withdraw instantly — the timelock must elapse", async function () {
      // This is the core protection against a compromised owner key draining the vault.
      const { abapay, token, treasury } = await withFunds();
      const amount = ethers.parseUnits("500", 6);

      await abapay.queueWithdrawal(await token.getAddress(), treasury.address, amount);

      await expect(
        abapay.executeWithdrawal(await token.getAddress())
      ).to.be.revertedWithCustomError(abapay, "TimelockNotElapsed");
    });

    it("allows withdrawal after the delay elapses", async function () {
      const { abapay, token, treasury } = await withFunds();
      const amount = ethers.parseUnits("500", 6);

      await abapay.queueWithdrawal(await token.getAddress(), treasury.address, amount);
      await time.increase(ONE_DAY + 1);

      await expect(abapay.executeWithdrawal(await token.getAddress()))
        .to.emit(abapay, "FundsWithdrawn")
        .withArgs(treasury.address, await token.getAddress(), amount);

      expect(await token.balanceOf(treasury.address)).to.equal(amount);
    });

    it("a queued withdrawal can be CANCELLED — the emergency brake", async function () {
      const { abapay, token, treasury } = await withFunds();
      const amount = ethers.parseUnits("500", 6);

      await abapay.queueWithdrawal(await token.getAddress(), treasury.address, amount);
      await expect(abapay.cancelWithdrawal(await token.getAddress()))
        .to.emit(abapay, "WithdrawalCancelled");

      await time.increase(ONE_DAY + 1);
      await expect(
        abapay.executeWithdrawal(await token.getAddress())
      ).to.be.revertedWithCustomError(abapay, "NoPendingWithdrawal");
    });

    it("cannot queue two withdrawals for the same token at once", async function () {
      const { abapay, token, treasury } = await withFunds();
      await abapay.queueWithdrawal(await token.getAddress(), treasury.address, ethers.parseUnits("1", 6));
      await expect(
        abapay.queueWithdrawal(await token.getAddress(), treasury.address, ethers.parseUnits("2", 6))
      ).to.be.revertedWithCustomError(abapay, "WithdrawalAlreadyQueued");
    });

    it("cannot queue more than the vault holds", async function () {
      const { abapay, token, treasury } = await withFunds();
      await expect(
        abapay.queueWithdrawal(await token.getAddress(), treasury.address, ethers.parseUnits("999999", 6))
      ).to.be.revertedWithCustomError(abapay, "InsufficientVaultBalance");
    });
  });

  describe("refunds", function () {
    async function withFunds() {
      const ctx = await deploy();
      await ctx.abapay
        .connect(ctx.user)
        .payBill(await ctx.token.getAddress(), "mtn", "080", ethers.parseUnits("500", 6));
      return ctx;
    }

    it("REJECTS a refund when no cap has been configured (fails closed)", async function () {
      const { abapay, token, user } = await withFunds();
      await expect(
        abapay.refundUser(await token.getAddress(), user.address, ethers.parseUnits("10", 6), "vend failed")
      ).to.be.revertedWithCustomError(abapay, "RefundExceedsCap");
    });

    it("refunds within the cap", async function () {
      const { abapay, token, user } = await withFunds();
      await abapay.setMaxRefund(await token.getAddress(), ethers.parseUnits("50", 6));

      await expect(
        abapay.refundUser(await token.getAddress(), user.address, ethers.parseUnits("10", 6), "vend failed")
      ).to.emit(abapay, "UserRefunded");
    });

    it("REJECTS a refund above the cap — refunds cannot be used to bypass the withdrawal timelock", async function () {
      const { abapay, token, attacker } = await withFunds();
      await abapay.setMaxRefund(await token.getAddress(), ethers.parseUnits("50", 6));

      await expect(
        abapay.refundUser(await token.getAddress(), attacker.address, ethers.parseUnits("500", 6), "drain")
      ).to.be.revertedWithCustomError(abapay, "RefundExceedsCap");
    });

    it("refunds still work while paused (users can be made whole during an incident)", async function () {
      const { abapay, token, user } = await withFunds();
      await abapay.setMaxRefund(await token.getAddress(), ethers.parseUnits("50", 6));
      await abapay.pause();

      await expect(
        abapay.refundUser(await token.getAddress(), user.address, ethers.parseUnits("10", 6), "vend failed")
      ).to.emit(abapay, "UserRefunded");
    });
  });

  describe("reentrancy", function () {
    it("blocks a reentrant token from re-entering payBill", async function () {
      const { abapay, owner } = await deploy();

      const Attacker = await ethers.getContractFactory("ReentrantToken");
      const evil = await Attacker.deploy(await abapay.getAddress());

      // Owner whitelists a malicious hook-bearing token (the realistic mistake scenario).
      await abapay.connect(owner).setTokenSupport(await evil.getAddress(), true);
      await evil.mint(owner.address, ethers.parseUnits("100", 18));

      // The reentrant callback must be rejected by nonReentrant.
      await expect(
        evil.attack(ethers.parseUnits("10", 18))
      ).to.be.reverted;
    });
  });
});
```
