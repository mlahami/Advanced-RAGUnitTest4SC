const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  let wallet;
  let owners;
  let nonOwner;
  let required = 2n;

  beforeEach(async function () {
    [owner1, owner2, owner3, nonOwner] = await ethers.getSigners();
    owners = [owner1.address, owner2.address, owner3.address];

    const Wallet = await ethers.getContractFactory("MultiSigWallet");
    wallet = await Wallet.deploy(owners, required);
    await wallet.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct owners", async function () {
      expect(await wallet.owners(0)).to.equal(owner1.address);
      expect(await wallet.owners(1)).to.equal(owner2.address);
      expect(await wallet.owners(2)).to.equal(owner3.address);
    });

    it("should set the correct required confirmations", async function () {
      expect(await wallet.required()).to.equal(required);
    });

    it("should mark all owners as valid", async function () {
      expect(await wallet.isOwner(owner1.address)).to.be.true;
      expect(await wallet.isOwner(owner2.address)).to.be.true;
      expect(await wallet.isOwner(owner3.address)).to.be.true;
    });

    it("should revert if required is zero", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(owners, 0n)).to.be.revertedWith("bad threshold");
    });

    it("should revert if required exceeds owners length", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(owners, 4n)).to.be.revertedWith("bad threshold");
    });

    it("should revert if owner is zero address", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy([ethers.ZeroAddress, owner2.address], required)).to.be.revertedWith("bad owner");
    });

    it("should revert if duplicate owners exist", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy([owner1.address, owner1.address], required)).to.be.revertedWith("bad owner");
    });
  });

  describe("submit", function () {
    it("should allow owner to submit a transaction", async function () {
      const to = ethers.ZeroAddress;
      const value = ethers.parseEther("1.0");
      const tx = await wallet.connect(owner1).submit(to, value);
      await expect(tx).to.emit(wallet, "TransactionSubmitted").withArgs(0n, to, value);
      const transaction = await wallet.transactions(0n);
      expect(transaction.to).to.equal(to);
      expect(transaction.value).to.equal(value);
      expect(transaction.executed).to.be.false;
      expect(transaction.confirmations).to.equal(0n);
    });

    it("should revert if non-owner tries to submit", async function () {
      await expect(wallet.connect(nonOwner).submit(ethers.ZeroAddress, 0n)).to.be.revertedWith("not owner");
    });
  });

  describe("confirm", function () {
    let txId;

    beforeEach(async function () {
      const tx = await wallet.connect(owner1).submit(ethers.ZeroAddress, 0n);
      const receipt = await tx.wait();
      txId = receipt.logs[0].args[0];
    });

    it("should allow owner to confirm a transaction", async function () {
      await expect(wallet.connect(owner2).confirm(txId))
        .to.emit(wallet, "TransactionConfirmed")
        .withArgs(txId, owner2.address);
      const confirmed = await wallet.confirmed(txId, owner2.address);
      expect(confirmed).to.be.true;
      const transaction = await wallet.transactions(txId);
      expect(transaction.confirmations).to.equal(1n);
    });

    it("should revert if non-owner tries to confirm", async function () {
      await expect(wallet.connect(nonOwner).confirm(txId)).to.be.revertedWith("not owner");
    });

    it("should revert if owner tries to confirm twice", async function () {
      await wallet.connect(owner2).confirm(txId);
      await expect(wallet.connect(owner2).confirm(txId)).to.be.revertedWith("already confirmed");
    });

    it("should revert if transaction is already executed", async function () {
      await wallet.connect(owner2).confirm(txId);
      await wallet.connect(owner3).confirm(txId);
      await wallet.connect(owner1).execute(txId);
      await expect(wallet.connect(owner1).confirm(txId)).to.be.revertedWith("executed");
    });
  });

  describe("execute", function () {
    let txId;

    beforeEach(async function () {
      const tx = await wallet.connect(owner1).submit(ethers.ZeroAddress, 0n);
      const receipt = await tx.wait();
      txId = receipt.logs[0].args[0];
      await wallet.connect(owner2).confirm(txId);
      await wallet.connect(owner3).confirm(txId);
    });

    it("should allow owner to execute a confirmed transaction", async function () {
      await expect(wallet.connect(owner1).execute(txId))
        .to.emit(wallet, "TransactionExecuted")
        .withArgs(txId);
      const transaction = await wallet.transactions(txId);
      expect(transaction.executed).to.be.true;
    });

    it("should revert if non-owner tries to execute", async function () {
      await expect(wallet.connect(nonOwner).execute(txId)).to.be.revertedWith("not owner");
    });

    it("should revert if transaction is already executed", async function () {
      await wallet.connect(owner1).execute(txId);
      await expect(wallet.connect(owner1).execute(txId)).to.be.revertedWith("executed");
    });

    it("should revert if not enough confirmations", async function () {
      const tx = await wallet.connect(owner1).submit(ethers.ZeroAddress, 0n);
      const receipt = await tx.wait();
      const newTxId = receipt.logs[0].args[0];
      await wallet.connect(owner2).confirm(newTxId);
      await expect(wallet.connect(owner1).execute(newTxId)).to.be.revertedWith("not enough confirmations");
    });
  });

  describe("receive", function () {
    it("should accept ETH deposits", async function () {
      const depositAmount = ethers.parseEther("1.0");
      const initialBalance = await ethers.provider.getBalance(wallet.getAddress());
      await owner1.sendTransaction({
        to: await wallet.getAddress(),
        value: depositAmount
      });
      const newBalance = await ethers.provider.getBalance(wallet.getAddress());
      expect(newBalance).to.equal(initialBalance + depositAmount);
    });
  });
});