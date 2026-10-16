# invoice-vault--0xpenwright

- domain: escrow-conditional-payments (payments)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/0xPenwright/crypto-payment-gateway @ abdd06e538e1ef6faa820a015e6740ff10799c60
- license: MIT
- targets: InvoiceVault.sol, MockERC20.sol
- validation: 24 passing tests, 0 failing; statement coverage InvoiceVault.sol 96.0 %, MockERC20.sol 50.0 %

## Contract: InvoiceVault.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title  InvoiceVault
/// @author 0xPenwright
/// @notice Non-custodial ERC-20 invoice processor. A merchant creates an
///         invoice on-chain; the payer settles it with `pay(id)`, which
///         pulls the exact expected token+amount and forwards to the
///         payee atomically. Off-chain services index `Paid` events to
///         confirm receipts and fire webhooks.
/// @dev    Vault never holds user funds beyond the duration of `pay()`.
///         If the off-chain webhook fails, the on-chain truth (Paid event)
///         is still the source of record.
contract InvoiceVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Stored invoice. Packed into two storage slots.
    /// @param payee          Address that receives the payment.
    /// @param token          ERC-20 expected for settlement.
    /// @param expectedAmount Exact amount required (no over/underpayment).
    /// @param createdAt      Block timestamp at creation.
    /// @param expiresAt      Block timestamp after which `pay()` reverts.
    /// @param paid           True once the invoice is settled.
    struct Invoice {
        address payee;
        address token;
        uint96  expectedAmount;
        uint32  createdAt;
        uint32  expiresAt;
        bool    paid;
    }

    /// @notice invoice id (bytes32) → invoice record.
    mapping(bytes32 => Invoice) public invoices;

    /// @notice Owner-managed allowlist of acceptable tokens.
    mapping(address => bool) public tokenAllowed;

    event TokenAllowed(address indexed token, bool allowed);
    event InvoiceCreated(
        bytes32 indexed id,
        address indexed payee,
        address indexed token,
        uint256 expectedAmount,
        uint32 expiresAt
    );
    event Paid(
        bytes32 indexed id,
        address indexed payer,
        address indexed payee,
        address token,
        uint256 amount
    );

    error InvoiceAlreadyExists(bytes32 id);
    error InvoiceNotFound(bytes32 id);
    error InvoiceAlreadyPaid(bytes32 id);
    error InvoiceExpired(bytes32 id);
    error TokenNotAllowed(address token);
    error InvalidPayee();
    error InvalidAmount();

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ─── Admin ───────────────────────────────────────────────────────────

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        tokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function setTokensAllowed(address[] calldata tokens, bool allowed) external onlyOwner {
        for (uint256 i; i < tokens.length; ++i) {
            tokenAllowed[tokens[i]] = allowed;
            emit TokenAllowed(tokens[i], allowed);
        }
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── Invoice lifecycle ───────────────────────────────────────────────

    /// @notice Create an invoice. `id` is caller-supplied — typically a hash
    ///         of (merchant, order_id, nonce) so off-chain systems can derive
    ///         it deterministically.
    /// @param id       Unique invoice identifier. Reverts if already used.
    /// @param payee    Destination address for the payment.
    /// @param token    Expected ERC-20 (must be on the allowlist).
    /// @param amount   Exact amount of `token` required.
    /// @param ttl      Seconds after which the invoice expires. Must be > 0.
    function createInvoice(
        bytes32 id,
        address payee,
        address token,
        uint96 amount,
        uint32 ttl
    ) external whenNotPaused {
        if (payee == address(0)) revert InvalidPayee();
        if (amount == 0 || ttl == 0) revert InvalidAmount();
        if (!tokenAllowed[token]) revert TokenNotAllowed(token);
        if (invoices[id].createdAt != 0) revert InvoiceAlreadyExists(id);

        uint32 created = uint32(block.timestamp);
        uint32 expires = created + ttl;
        invoices[id] = Invoice({
            payee:          payee,
            token:          token,
            expectedAmount: amount,
            createdAt:      created,
            expiresAt:      expires,
            paid:           false
        });

        emit InvoiceCreated(id, payee, token, amount, expires);
    }

    /// @notice Settle an invoice. The caller must have approved the vault
    ///         to spend `invoice.expectedAmount` of `invoice.token`.
    ///         The vault pulls the funds and forwards to the payee in one tx.
    function pay(bytes32 id) external nonReentrant whenNotPaused {
        Invoice storage inv = invoices[id];

        if (inv.createdAt == 0) revert InvoiceNotFound(id);
        if (inv.paid) revert InvoiceAlreadyPaid(id);
        if (block.timestamp > inv.expiresAt) revert InvoiceExpired(id);

        // Cache for event + cheaper SLOADs.
        address payer  = msg.sender;
        address payee  = inv.payee;
        address token  = inv.token;
        uint256 amount = inv.expectedAmount;

        inv.paid = true;

        IERC20(token).safeTransferFrom(payer, payee, amount);

        emit Paid(id, payer, payee, token, amount);
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function getInvoice(bytes32 id) external view returns (Invoice memory) {
        return invoices[id];
    }

    function isOpen(bytes32 id) external view returns (bool) {
        Invoice memory inv = invoices[id];
        return inv.createdAt != 0 && !inv.paid && block.timestamp <= inv.expiresAt;
    }
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal mintable ERC-20 used only in unit tests.
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

## Tests: InvoiceVault.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const id = (s) => ethers.id(s);
const HOUR = 3600;

describe("InvoiceVault", () => {
  let owner;
  let merchant;
  let payer;
  let stranger;
  let usdt;
  let usdc;
  let vault;

  beforeEach(async () => {
    [owner, merchant, payer, stranger] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    usdt = (await Token.deploy("Tether USD", "USDT", 6));
    usdc = (await Token.deploy("USD Coin", "USDC", 6));

    const Vault = await ethers.getContractFactory("InvoiceVault");
    vault = (await Vault.deploy(owner.address));

    await vault.setTokenAllowed(await usdt.getAddress(), true);
    await usdt.mint(payer.address, ethers.parseUnits("10000", 6));
    await usdc.mint(payer.address, ethers.parseUnits("10000", 6));
  });

  // ─── Admin ──────────────────────────────────────────────────────────

  describe("admin", () => {
    it("only owner can allow a token", async () => {
      await expect(vault.connect(stranger).setTokenAllowed(await usdc.getAddress(), true))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("setTokenAllowed flips the flag and emits", async () => {
      await expect(vault.setTokenAllowed(await usdc.getAddress(), true))
        .to.emit(vault, "TokenAllowed").withArgs(await usdc.getAddress(), true);
      expect(await vault.tokenAllowed(await usdc.getAddress())).to.be.true;
    });

    it("setTokensAllowed flips many at once", async () => {
      await vault.setTokensAllowed([await usdc.getAddress(), await usdt.getAddress()], true);
      expect(await vault.tokenAllowed(await usdc.getAddress())).to.be.true;
      expect(await vault.tokenAllowed(await usdt.getAddress())).to.be.true;
    });

    it("only owner can pause", async () => {
      await expect(vault.connect(stranger).pause())
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // ─── createInvoice ──────────────────────────────────────────────────

  describe("createInvoice", () => {
    it("stores fields and emits", async () => {
      const invId = id("order:1");
      const amount = ethers.parseUnits("25", 6);
      await expect(
        vault.connect(merchant).createInvoice(invId, merchant.address, await usdt.getAddress(), amount, HOUR)
      ).to.emit(vault, "InvoiceCreated");

      const inv = await vault.getInvoice(invId);
      expect(inv.payee).to.equal(merchant.address);
      expect(inv.token).to.equal(await usdt.getAddress());
      expect(inv.expectedAmount).to.equal(amount);
      expect(inv.paid).to.be.false;
    });

    it("rejects zero payee", async () => {
      await expect(
        vault.createInvoice(id("a"), ethers.ZeroAddress, await usdt.getAddress(), 100n, HOUR)
      ).to.be.revertedWithCustomError(vault, "InvalidPayee");
    });

    it("rejects zero amount and zero ttl", async () => {
      const tok = await usdt.getAddress();
      await expect(vault.createInvoice(id("a"), merchant.address, tok, 0n, HOUR))
        .to.be.revertedWithCustomError(vault, "InvalidAmount");
      await expect(vault.createInvoice(id("a"), merchant.address, tok, 100n, 0))
        .to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("rejects non-allowed token", async () => {
      await expect(
        vault.createInvoice(id("a"), merchant.address, await usdc.getAddress(), 100n, HOUR)
      ).to.be.revertedWithCustomError(vault, "TokenNotAllowed");
    });

    it("rejects duplicate id", async () => {
      const invId = id("dup");
      await vault.createInvoice(invId, merchant.address, await usdt.getAddress(), 100n, HOUR);
      await expect(
        vault.createInvoice(invId, merchant.address, await usdt.getAddress(), 100n, HOUR)
      ).to.be.revertedWithCustomError(vault, "InvoiceAlreadyExists");
    });

    it("rejects when paused", async () => {
      await vault.pause();
      await expect(
        vault.createInvoice(id("p"), merchant.address, await usdt.getAddress(), 100n, HOUR)
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });
  });

  // ─── pay ────────────────────────────────────────────────────────────

  describe("pay", () => {
    const INV = id("order:42");
    const AMOUNT = ethers.parseUnits("100", 6);

    beforeEach(async () => {
      await vault.connect(merchant).createInvoice(
        INV, merchant.address, await usdt.getAddress(), AMOUNT, HOUR
      );
    });

    it("happy path: pulls funds from payer, forwards to payee, emits Paid", async () => {
      await usdt.connect(payer).approve(await vault.getAddress(), AMOUNT);

      const payerBefore = await usdt.balanceOf(payer.address);
      const payeeBefore = await usdt.balanceOf(merchant.address);
      const vaultBefore = await usdt.balanceOf(await vault.getAddress());

      await expect(vault.connect(payer).pay(INV))
        .to.emit(vault, "Paid")
        .withArgs(INV, payer.address, merchant.address, await usdt.getAddress(), AMOUNT);

      const payerAfter = await usdt.balanceOf(payer.address);
      const payeeAfter = await usdt.balanceOf(merchant.address);
      const vaultAfter = await usdt.balanceOf(await vault.getAddress());

      expect(payerBefore - payerAfter).to.equal(AMOUNT);
      expect(payeeAfter - payeeBefore).to.equal(AMOUNT);
      expect(vaultAfter).to.equal(vaultBefore); // non-custodial — vault keeps nothing
    });

    it("sets paid=true after settlement", async () => {
      await usdt.connect(payer).approve(await vault.getAddress(), AMOUNT);
      await vault.connect(payer).pay(INV);
      expect((await vault.getInvoice(INV)).paid).to.be.true;
    });

    it("rejects double-pay", async () => {
      await usdt.connect(payer).approve(await vault.getAddress(), AMOUNT * 2n);
      await vault.connect(payer).pay(INV);
      await expect(vault.connect(payer).pay(INV))
        .to.be.revertedWithCustomError(vault, "InvoiceAlreadyPaid");
    });

    it("rejects unknown invoice id", async () => {
      await expect(vault.connect(payer).pay(id("nope")))
        .to.be.revertedWithCustomError(vault, "InvoiceNotFound");
    });

    it("rejects after expiry", async () => {
      await time.increase(HOUR + 1);
      await usdt.connect(payer).approve(await vault.getAddress(), AMOUNT);
      await expect(vault.connect(payer).pay(INV))
        .to.be.revertedWithCustomError(vault, "InvoiceExpired");
    });

    it("rejects when paused", async () => {
      await vault.pause();
      await usdt.connect(payer).approve(await vault.getAddress(), AMOUNT);
      await expect(vault.connect(payer).pay(INV))
        .to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("reverts when payer has not approved", async () => {
      await expect(vault.connect(payer).pay(INV))
        .to.be.revertedWithCustomError(usdt, "ERC20InsufficientAllowance");
    });

    it("reverts when payer balance is insufficient", async () => {
      await usdt.connect(payer).transfer(stranger.address, await usdt.balanceOf(payer.address));
      await usdt.connect(payer).approve(await vault.getAddress(), AMOUNT);
      await expect(vault.connect(payer).pay(INV))
        .to.be.revertedWithCustomError(usdt, "ERC20InsufficientBalance");
    });
  });

  // ─── Views ──────────────────────────────────────────────────────────

  describe("views", () => {
    it("isOpen is false for unknown invoice", async () => {
      expect(await vault.isOpen(id("unknown"))).to.be.false;
    });

    it("isOpen is true between create and pay", async () => {
      const invId = id("v1");
      await vault.createInvoice(invId, merchant.address, await usdt.getAddress(), 1n, HOUR);
      expect(await vault.isOpen(invId)).to.be.true;
    });

    it("isOpen is false after paid", async () => {
      const invId = id("v2");
      const amt = 1000n;
      await vault.createInvoice(invId, merchant.address, await usdt.getAddress(), amt, HOUR);
      await usdt.connect(payer).approve(await vault.getAddress(), amt);
      await vault.connect(payer).pay(invId);
      expect(await vault.isOpen(invId)).to.be.false;
    });

    it("isOpen is false after expiry", async () => {
      const invId = id("v3");
      await vault.createInvoice(invId, merchant.address, await usdt.getAddress(), 1n, HOUR);
      await time.increase(HOUR + 1);
      expect(await vault.isOpen(invId)).to.be.false;
    });
  });

  // ─── Multi-token + multi-invoice workflow ──────────────────────────

  describe("workflow", () => {
    it("supports invoices in multiple tokens simultaneously", async () => {
      await vault.setTokenAllowed(await usdc.getAddress(), true);
      const A = id("multi:A");
      const B = id("multi:B");
      const amt = ethers.parseUnits("50", 6);

      await vault.createInvoice(A, merchant.address, await usdt.getAddress(), amt, HOUR);
      await vault.createInvoice(B, merchant.address, await usdc.getAddress(), amt, HOUR);

      await usdt.connect(payer).approve(await vault.getAddress(), amt);
      await usdc.connect(payer).approve(await vault.getAddress(), amt);

      await vault.connect(payer).pay(A);
      await vault.connect(payer).pay(B);

      expect(await usdt.balanceOf(merchant.address)).to.equal(amt);
      expect(await usdc.balanceOf(merchant.address)).to.equal(amt);
    });

    it("handles 20 sequential invoices to the same payee", async () => {
      const amount = ethers.parseUnits("1", 6);
      await usdt.connect(payer).approve(await vault.getAddress(), amount * 20n);
      for (let i = 0; i < 20; i++) {
        const invId = id(`seq:${i}`);
        await vault.createInvoice(invId, merchant.address, await usdt.getAddress(), amount, HOUR);
        await vault.connect(payer).pay(invId);
      }
      expect(await usdt.balanceOf(merchant.address)).to.equal(amount * 20n);
    });
  });
});
```
