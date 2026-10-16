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
