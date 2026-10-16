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
      const badOwners = [owner1.address, ethers.ZeroAddress, owner3.address];
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(badOwners, required)).to.be.revertedWith("bad owner");
    });

    it("should revert if duplicate owners exist", async function () {
      const badOwners = [owner1.address, owner1.address, owner3.address];
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(badOwners, required)).to.be.revertedWith("bad owner");
    });
  });

  describe("submit", function () {
    it("should allow owner to submit a transaction", async function () {
      const to = ethers.Wallet.createRandom().address;
      const value = ethers.parseEther("1.0");
      await expect(wallet.connect(owner1).submit(to, value))
        .to.emit(wallet, "TransactionSubmitted")
        .withArgs(0n, to, value, owner1.address);
    });

    it("should revert if non-owner tries to submit", async function () {
      const to = ethers.Wallet.createRandom().address;
      const value = ethers.parseEther("1.0");
      await expect(wallet.connect(nonOwner).submit(to, value)).to.be.revertedWith("not owner");
    });

    it("should return the correct transaction ID", async function () {
      const to = ethers.Wallet.createRandom().address;
      const value = ethers.parseEther("1.0");
      const tx = await wallet.connect(owner1).submit(to, value);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "TransactionSubmitted");
      expect(event.args[0]).to.equal(0n);
    });
  });

  describe("confirm", function () {
    let txId;

    beforeEach(async function () {
      const to = ethers.Wallet.createRandom().address;
      const value = ethers.parseEther("1.0");
      const tx = await wallet.connect(owner1).submit(to, value);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "TransactionSubmitted");
      txId = event.args[0];
    });

    it("should allow owner to confirm a transaction", async function () {
      await expect(wallet.connect(owner2).confirm(txId))
        .to.emit(wallet, "Confirmation")
        .withArgs(txId, owner2.address);
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

    it("should update confirmation count", async function () {
      await wallet.connect(owner2).confirm(txId);
      const tx = await wallet.transactions(txId);
      expect(tx.confirmations).to.equal(1n);
    });
  });

  describe("execute", function () {
    let txId;
    let to;
    let value;

    beforeEach(async function () {
      to = ethers.Wallet.createRandom().address;
      value = ethers.parseEther("1.0");
      const tx = await wallet.connect(owner1).submit(to, value);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "TransactionSubmitted");
      txId = event.args[0];
      await wallet.connect(owner2).confirm(txId);
      await wallet.connect(owner3).confirm(txId);
    });

    it("should allow owner to execute a transaction with sufficient confirmations", async function () {
      const initialBalance = await ethers.provider.getBalance(to);
      await expect(wallet.connect(owner1).execute(txId))
        .to.emit(wallet, "Execution")
        .withArgs(txId, to, value, owner1.address);
      const finalBalance = await ethers.provider.getBalance(to);
      expect(finalBalance - initialBalance).to.equal(value);
    });

    it("should revert if non-owner tries to execute", async function () {
      await expect(wallet.connect(nonOwner).execute(txId)).to.be.revertedWith("not owner");
    });

    it("should revert if transaction is already executed", async function () {
      await wallet.connect(owner1).execute(txId);
      await expect(wallet.connect(owner1).execute(txId)).to.be.revertedWith("executed");
    });

    it("should revert if not enough confirmations", async function () {
      const newTx = await wallet.connect(owner1).submit(to, value);
      const receipt = await newTx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "TransactionSubmitted");
      const newTxId = event.args[0];
      await wallet.connect(owner2).confirm(newTxId);
      await expect(wallet.connect(owner1).execute(newTxId)).to.be.revertedWith("not enough confirmations");
    });

    it("should mark transaction as executed", async function () {
      await wallet.connect(owner1).execute(txId);
      const tx = await wallet.transactions(txId);
      expect(tx.executed).to.be.true;
    });
  });

  describe("receive", function () {
    it("should accept ETH deposits", async function () {
      const amount = ethers.parseEther("1.0");
      const initialBalance = await ethers.provider.getBalance(await wallet.getAddress());
      await owner1.sendTransaction({
        to: await wallet.getAddress(),
        value: amount
      });
      const finalBalance = await ethers.provider.getBalance(await wallet.getAddress());
      expect(finalBalance - initialBalance).to.equal(amount);
    });
  });
});