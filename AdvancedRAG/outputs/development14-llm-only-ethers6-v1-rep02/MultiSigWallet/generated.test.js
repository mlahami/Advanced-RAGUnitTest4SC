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
      for (let i = 0; i < owners.length; i++) {
        expect(await wallet.isOwner(owners[i])).to.be.true;
      }
      expect(await wallet.owners(0)).to.equal(owners[0]);
      expect(await wallet.owners(1)).to.equal(owners[1]);
      expect(await wallet.owners(2)).to.equal(owners[2]);
    });

    it("should set the correct required confirmations", async function () {
      expect(await wallet.required()).to.equal(required);
    });

    it("should revert if required is zero", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(owners, 0n)).to.be.revertedWith("bad threshold");
    });

    it("should revert if required exceeds owners count", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(owners, 4n)).to.be.revertedWith("bad threshold");
    });

    it("should revert if owner is zero address", async function () {
      const badOwners = [owner1.address, ethers.ZeroAddress, owner3.address];
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(badOwners, required)).to.be.revertedWith("bad owner");
    });

    it("should revert if duplicate owners", async function () {
      const badOwners = [owner1.address, owner1.address, owner3.address];
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(Wallet.deploy(badOwners, required)).to.be.revertedWith("bad owner");
    });
  });

  describe("submit", function () {
    it("should allow owner to submit transaction", async function () {
      const to = ethers.Wallet.createRandom().address;
      const value = ethers.parseEther("1");
      await expect(wallet.connect(owner1).submit(to, value))
        .to.emit(wallet, "TransactionSubmitted")
        .withArgs(0n, to, value);
    });

    it("should revert if non-owner tries to submit", async function () {
      const to = ethers.Wallet.createRandom().address;
      const value = ethers.parseEther("1");
      await expect(wallet.connect(nonOwner).submit(to, value)).to.be.revertedWith("not owner");
    });
  });

  describe("confirm", function () {
    let txId;

    beforeEach(async function () {
      const to = ethers.Wallet.createRandom().address;
      const value = ethers.parseEther("1");
      const tx = await wallet.connect(owner1).submit(to, value);
      const receipt = await tx.wait();
      txId = receipt.logs[0].args[0];
    });

    it("should allow owner to confirm transaction", async function () {
      await expect(wallet.connect(owner2).confirm(txId))
        .to.emit(wallet, "TransactionConfirmed")
        .withArgs(txId, owner2.address);
    });

    it("should revert if non-owner tries to confirm", async function () {
      await expect(wallet.connect(nonOwner).confirm(txId)).to.be.revertedWith("not owner");
    });

    it("should revert if owner confirms twice", async function () {
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
    let to;
    let value;

    beforeEach(async function () {
      to = ethers.Wallet.createRandom().address;
      value = ethers.parseEther("1");
      const tx = await wallet.connect(owner1).submit(to, value);
      const receipt = await tx.wait();
      txId = receipt.logs[0].args[0];
    });

    it("should allow execution after sufficient confirmations", async function () {
      await wallet.connect(owner2).confirm(txId);
      await wallet.connect(owner3).confirm(txId);

      const initialBalance = await ethers.provider.getBalance(to);
      await expect(wallet.connect(owner1).execute(txId))
        .to.emit(wallet, "TransactionExecuted")
        .withArgs(txId);

      const finalBalance = await ethers.provider.getBalance(to);
      expect(finalBalance - initialBalance).to.equal(value);
    });

    it("should revert if non-owner tries to execute", async function () {
      await wallet.connect(owner2).confirm(txId);
      await wallet.connect(owner3).confirm(txId);
      await expect(wallet.connect(nonOwner).execute(txId)).to.be.revertedWith("not owner");
    });

    it("should revert if not enough confirmations", async function () {
      await wallet.connect(owner2).confirm(txId);
      await expect(wallet.connect(owner1).execute(txId)).to.be.revertedWith("not enough confirmations");
    });

    it("should revert if transaction is already executed", async function () {
      await wallet.connect(owner2).confirm(txId);
      await wallet.connect(owner3).confirm(txId);
      await wallet.connect(owner1).execute(txId);
      await expect(wallet.connect(owner1).execute(txId)).to.be.revertedWith("executed");
    });

    it("should revert if transfer fails", async function () {
      // Create a contract that will revert on receive
      const FailingContract = await ethers.getContractFactory("BenchmarkTarget");
      const failingContract = await FailingContract.deploy();
      await failingContract.waitForDeployment();

      const tx = await wallet.connect(owner1).submit(await failingContract.getAddress(), 0n);
      const receipt = await tx.wait();
      const failTxId = receipt.logs[0].args[0];

      await wallet.connect(owner2).confirm(failTxId);
      await wallet.connect(owner3).confirm(failTxId);

      await expect(wallet.connect(owner1).execute(failTxId)).to.be.revertedWith("transfer failed");
    });
  });

  describe("receive", function () {
    it("should accept ether", async function () {
      const value = ethers.parseEther("1");
      const initialBalance = await ethers.provider.getBalance(await wallet.getAddress());

      await expect(owner1.sendTransaction({
        to: await wallet.getAddress(),
        value: value
      })).to.changeEtherBalances(
        [owner1, wallet],
        [-value, value]
      );

      const finalBalance = await ethers.provider.getBalance(await wallet.getAddress());
      expect(finalBalance - initialBalance).to.equal(value);
    });
  });
});