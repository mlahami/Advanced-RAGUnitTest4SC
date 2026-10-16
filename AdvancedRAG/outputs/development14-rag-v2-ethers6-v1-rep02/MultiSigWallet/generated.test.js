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
    it("Should set the correct owners", async function () {
      for (let i = 0; i < owners.length; i++) {
        expect(await wallet.isOwner(owners[i].address)).to.be.true;
      }
      expect(await wallet.isOwner(nonOwner.address)).to.be.false;
    });

    it("Should set the correct required confirmations", async function () {
      expect(await wallet.required()).to.equal(required);
    });

    it("Should revert if required is zero", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(owners.map(o => o.address), 0n)).to.be.revertedWith("bad threshold");
    });

    it("Should revert if required exceeds owners count", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(owners.map(o => o.address), 4n)).to.be.revertedWith("bad threshold");
    });

    it("Should revert if owner is zero address", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy([ethers.ZeroAddress, owner2.address, owner3.address], required)).to.be.revertedWith("bad owner");
    });

    it("Should revert if duplicate owners", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy([owner1.address, owner1.address, owner3.address], required)).to.be.revertedWith("bad owner");
    });
  });

  describe("submit", function () {
    it("Should allow owner to submit transaction", async function () {
      const to = ethers.Wallet.createRandom().address;
      const value = ethers.parseEther("1");
      await expect(wallet.connect(owner1).submit(to, value))
        .to.emit(wallet, "TransactionSubmitted")
        .withArgs(0n, to, value, owner1.address);
    });

    it("Should revert if non-owner tries to submit", async function () {
      const to = ethers.Wallet.createRandom().address;
      const value = ethers.parseEther("1");
      await expect(wallet.connect(nonOwner).submit(to, value)).to.be.revertedWith("not owner");
    });

    it("Should return correct transaction ID", async function () {
      const to = ethers.Wallet.createRandom().address;
      const value = ethers.parseEther("1");
      const txId = await wallet.connect(owner1).submit.staticCall(to, value);
      expect(txId).to.equal(0n);
    });
  });

  describe("confirm", function () {
    let txId;

    beforeEach(async function () {
      const to = ethers.Wallet.createRandom().address;
      const value = ethers.parseEther("1");
      txId = await wallet.connect(owner1).submit.staticCall(to, value);
      await wallet.connect(owner1).submit(to, value);
    });

    it("Should allow owner to confirm transaction", async function () {
      await expect(wallet.connect(owner2).confirm(txId))
        .to.emit(wallet, "TransactionConfirmed")
        .withArgs(txId, owner2.address);
    });

    it("Should revert if non-owner tries to confirm", async function () {
      await expect(wallet.connect(nonOwner).confirm(txId)).to.be.revertedWith("not owner");
    });

    it("Should revert if owner confirms twice", async function () {
      await wallet.connect(owner2).confirm(txId);
      await expect(wallet.connect(owner2).confirm(txId)).to.be.revertedWith("already confirmed");
    });

    it("Should revert if transaction is already executed", async function () {
      await wallet.connect(owner2).confirm(txId);
      await wallet.connect(owner3).confirm(txId);
      await wallet.connect(owner1).execute(txId);
      await expect(wallet.connect(owner1).confirm(txId)).to.be.revertedWith("executed");
    });
  });

  describe("execute", function () {
    let txId;
    let to;
    let value;

    beforeEach(async function () {
      to = ethers.Wallet.createRandom().address;
      value = ethers.parseEther("1");
      txId = await wallet.connect(owner1).submit.staticCall(to, value);
      await wallet.connect(owner1).submit(to, value);
      await wallet.connect(owner2).confirm(txId);
    });

    it("Should allow owner to execute transaction with sufficient confirmations", async function () {
      await expect(wallet.connect(owner3).confirm(txId))
        .to.emit(wallet, "TransactionExecuted")
        .withArgs(txId, to, value, owner3.address);
    });

    it("Should revert if non-owner tries to execute", async function () {
      await expect(wallet.connect(nonOwner).execute(txId)).to.be.revertedWith("not owner");
    });

    it("Should revert if transaction is already executed", async function () {
      await wallet.connect(owner3).confirm(txId);
      await wallet.connect(owner1).execute(txId);
      await expect(wallet.connect(owner1).execute(txId)).to.be.revertedWith("executed");
    });

    it("Should revert if not enough confirmations", async function () {
      await expect(wallet.connect(owner1).execute(txId)).to.be.revertedWith("not enough confirmations");
    });

    it("Should transfer the correct amount to the recipient", async function () {
      await wallet.connect(owner3).confirm(txId);
      const initialBalance = await ethers.provider.getBalance(to);
      await wallet.connect(owner1).execute(txId);
      const finalBalance = await ethers.provider.getBalance(to);
      expect(finalBalance - initialBalance).to.equal(value);
    });

    it("Should revert if transfer fails", async function () {
      const failingContract = await ethers.deployContract("BenchmarkTarget");
      await failingContract.waitForDeployment();
      const failingAddress = await failingContract.getAddress();

      const txIdFail = await wallet.connect(owner1).submit.staticCall(failingAddress, 0n);
      await wallet.connect(owner1).submit(failingAddress, 0n);
      await wallet.connect(owner2).confirm(txIdFail);
      await wallet.connect(owner3).confirm(txIdFail);

      await expect(wallet.connect(owner1).execute(txIdFail)).to.be.revertedWith("transfer failed");
    });
  });

  describe("receive", function () {
    it("Should accept ETH deposits", async function () {
      const depositAmount = ethers.parseEther("1");
      const initialBalance = await ethers.provider.getBalance(await wallet.getAddress());

      await expect(owner1.sendTransaction({
        to: await wallet.getAddress(),
        value: depositAmount
      })).to.changeEtherBalances(
        [owner1, wallet],
        [-depositAmount, depositAmount]
      );

      const finalBalance = await ethers.provider.getBalance(await wallet.getAddress());
      expect(finalBalance - initialBalance).to.equal(depositAmount);
    });
  });
});