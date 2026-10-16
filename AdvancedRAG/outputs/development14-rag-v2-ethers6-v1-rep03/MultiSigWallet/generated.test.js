const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  let wallet;
  let owners;
  let nonOwner;
  let required;

  beforeEach(async function () {
    [owner1, owner2, owner3, nonOwner] = await ethers.getSigners();
    owners = [owner1, owner2, owner3];
    required = 2n;

    const Wallet = await ethers.getContractFactory("MultiSigWallet");
    wallet = await Wallet.deploy(owners.map(o => o.address), required);
    await wallet.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owners and required confirmations", async function () {
      expect(await wallet.owners(0)).to.equal(owner1.address);
      expect(await wallet.owners(1)).to.equal(owner2.address);
      expect(await wallet.owners(2)).to.equal(owner3.address);
      expect(await wallet.required()).to.equal(required);
    });

    it("Should revert if required is zero", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(owners.map(o => o.address), 0n))
        .to.be.revertedWith("bad threshold");
    });

    it("Should revert if required exceeds owners count", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(owners.map(o => o.address), 4n))
        .to.be.revertedWith("bad threshold");
    });

    it("Should revert if owner is zero address", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy([ethers.ZeroAddress, owner2.address, owner3.address], required))
        .to.be.revertedWith("bad owner");
    });

    it("Should revert if duplicate owners", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy([owner1.address, owner1.address, owner3.address], required))
        .to.be.revertedWith("bad owner");
    });
  });

  describe("submit", function () {
    it("Should allow owner to submit transaction", async function () {
      const tx = await wallet.connect(owner1).submit(nonOwner.address, ethers.parseEther("1"));
      await expect(tx).to.emit(wallet, "TransactionSubmitted").withArgs(0n, nonOwner.address, ethers.parseEther("1"));
    });

    it("Should revert if non-owner tries to submit", async function () {
      await expect(wallet.connect(nonOwner).submit(nonOwner.address, ethers.parseEther("1")))
        .to.be.revertedWith("not owner");
    });
  });

  describe("confirm", function () {
    let txId;

    beforeEach(async function () {
      const tx = await wallet.connect(owner1).submit(nonOwner.address, ethers.parseEther("1"));
      const receipt = await tx.wait();
      txId = receipt.logs[0].args[0];
    });

    it("Should allow owner to confirm transaction", async function () {
      await expect(wallet.connect(owner2).confirm(txId))
        .to.emit(wallet, "Confirmation").withArgs(txId, owner2.address);
    });

    it("Should revert if non-owner tries to confirm", async function () {
      await expect(wallet.connect(nonOwner).confirm(txId))
        .to.be.revertedWith("not owner");
    });

    it("Should revert if owner tries to confirm twice", async function () {
      await wallet.connect(owner2).confirm(txId);
      await expect(wallet.connect(owner2).confirm(txId))
        .to.be.revertedWith("already confirmed");
    });

    it("Should revert if transaction is already executed", async function () {
      await wallet.connect(owner2).confirm(txId);
      await wallet.connect(owner3).confirm(txId);
      await wallet.connect(owner1).execute(txId);
      await expect(wallet.connect(owner1).confirm(txId))
        .to.be.revertedWith("executed");
    });
  });

  describe("execute", function () {
    let txId;

    beforeEach(async function () {
      const tx = await wallet.connect(owner1).submit(nonOwner.address, ethers.parseEther("1"));
      const receipt = await tx.wait();
      txId = receipt.logs[0].args[0];
      await wallet.connect(owner2).confirm(txId);
      await wallet.connect(owner3).confirm(txId);
    });

    it("Should allow owner to execute transaction", async function () {
      const initialBalance = await ethers.provider.getBalance(nonOwner.address);
      await expect(wallet.connect(owner1).execute(txId))
        .to.emit(wallet, "Execution").withArgs(txId);
      const finalBalance = await ethers.provider.getBalance(nonOwner.address);
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1"));
    });

    it("Should revert if non-owner tries to execute", async function () {
      await expect(wallet.connect(nonOwner).execute(txId))
        .to.be.revertedWith("not owner");
    });

    it("Should revert if transaction is already executed", async function () {
      await wallet.connect(owner1).execute(txId);
      await expect(wallet.connect(owner1).execute(txId))
        .to.be.revertedWith("executed");
    });

    it("Should revert if not enough confirmations", async function () {
      const tx = await wallet.connect(owner1).submit(nonOwner.address, ethers.parseEther("1"));
      const receipt = await tx.wait();
      const newTxId = receipt.logs[0].args[0];
      await wallet.connect(owner2).confirm(newTxId);
      await expect(wallet.connect(owner1).execute(newTxId))
        .to.be.revertedWith("not enough confirmations");
    });

    it("Should revert if transfer fails", async function () {
      const FailingContract = await ethers.getContractFactory("BenchmarkTarget");
      const failingContract = await FailingContract.deploy();
      await failingContract.waitForDeployment();

      const tx = await wallet.connect(owner1).submit(await failingContract.getAddress(), 0n);
      const receipt = await tx.wait();
      const failTxId = receipt.logs[0].args[0];
      await wallet.connect(owner2).confirm(failTxId);
      await wallet.connect(owner3).confirm(failTxId);

      await expect(wallet.connect(owner1).execute(failTxId))
        .to.be.revertedWith("transfer failed");
    });
  });

  describe("receive", function () {
    it("Should accept ETH deposits", async function () {
      const initialBalance = await ethers.provider.getBalance(await wallet.getAddress());
      await owner1.sendTransaction({
        to: await wallet.getAddress(),
        value: ethers.parseEther("1")
      });
      const finalBalance = await ethers.provider.getBalance(await wallet.getAddress());
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1"));
    });
  });
});