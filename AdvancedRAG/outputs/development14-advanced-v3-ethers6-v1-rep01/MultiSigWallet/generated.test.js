const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  let wallet;
  let owners;
  let nonOwner;
  let recipient;

  beforeEach(async function () {
    [owner1, owner2, owner3, nonOwner, recipient] = await ethers.getSigners();
    owners = [owner1, owner2, owner3];

    const Wallet = await ethers.getContractFactory("MultiSigWallet");
    wallet = await Wallet.deploy(
      [owner1.address, owner2.address, owner3.address],
      2n
    );
    await wallet.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct owners", async function () {
      expect(await wallet.owners(0)).to.equal(owner1.address);
      expect(await wallet.owners(1)).to.equal(owner2.address);
      expect(await wallet.owners(2)).to.equal(owner3.address);
    });

    it("should set the correct required confirmations", async function () {
      expect(await wallet.required()).to.equal(2n);
    });

    it("should revert if required is zero", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(
        Wallet.deploy([owner1.address, owner2.address], 0n)
      ).to.be.revertedWith("bad threshold");
    });

    it("should revert if required exceeds owners count", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(
        Wallet.deploy([owner1.address, owner2.address], 3n)
      ).to.be.revertedWith("bad threshold");
    });

    it("should revert if owner is zero address", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(
        Wallet.deploy([ethers.ZeroAddress, owner2.address], 1n)
      ).to.be.revertedWith("bad owner");
    });

    it("should revert if duplicate owners", async function () {
      const Wallet = await ethers.getContractFactory("MultiSigWallet");
      await expect(
        Wallet.deploy([owner1.address, owner1.address], 1n)
      ).to.be.revertedWith("bad owner");
    });
  });

  describe("submit", function () {
    it("should allow owner to submit transaction", async function () {
      await expect(wallet.connect(owner1).submit(recipient.address, 100n))
        .to.emit(wallet, "TransactionSubmitted")
        .withArgs(0n, recipient.address, 100n);
    });

    it("should revert if non-owner tries to submit", async function () {
      await expect(
        wallet.connect(nonOwner).submit(recipient.address, 100n)
      ).to.be.revertedWith("not owner");
    });

    it("should store transaction correctly", async function () {
      await wallet.connect(owner1).submit(recipient.address, 100n);
      const txn = await wallet.transactions(0n);
      expect(txn.to).to.equal(recipient.address);
      expect(txn.value).to.equal(100n);
      expect(txn.executed).to.be.false;
      expect(txn.confirmations).to.equal(0n);
    });
  });

  describe("confirm", function () {
    beforeEach(async function () {
      await wallet.connect(owner1).submit(recipient.address, 100n);
    });

    it("should allow owner to confirm transaction", async function () {
      await expect(wallet.connect(owner2).confirm(0n))
        .to.emit(wallet, "TransactionConfirmed")
        .withArgs(0n, owner2.address);
    });

    it("should revert if non-owner tries to confirm", async function () {
      await expect(
        wallet.connect(nonOwner).confirm(0n)
      ).to.be.revertedWith("not owner");
    });

    it("should revert if owner tries to confirm twice", async function () {
      await wallet.connect(owner2).confirm(0n);
      await expect(
        wallet.connect(owner2).confirm(0n)
      ).to.be.revertedWith("already confirmed");
    });

    it("should revert if transaction is already executed", async function () {
      await wallet.connect(owner2).confirm(0n);
      await wallet.connect(owner1).execute(0n);
      await expect(
        wallet.connect(owner3).confirm(0n)
      ).to.be.revertedWith("executed");
    });

    it("should update confirmations count", async function () {
      await wallet.connect(owner2).confirm(0n);
      const txn = await wallet.transactions(0n);
      expect(txn.confirmations).to.equal(1n);
    });
  });

  describe("execute", function () {
    beforeEach(async function () {
      await wallet.connect(owner1).submit(recipient.address, 100n);
      await wallet.connect(owner2).confirm(0n);
    });

    it("should allow owner to execute transaction when threshold is met", async function () {
      await expect(wallet.connect(owner1).execute(0n))
        .to.emit(wallet, "TransactionExecuted")
        .withArgs(0n);
    });

    it("should revert if non-owner tries to execute", async function () {
      await expect(
        wallet.connect(nonOwner).execute(0n)
      ).to.be.revertedWith("not owner");
    });

    it("should revert if transaction is already executed", async function () {
      await wallet.connect(owner1).execute(0n);
      await expect(
        wallet.connect(owner1).execute(0n)
      ).to.be.revertedWith("executed");
    });

    it("should revert if threshold not met", async function () {
      await wallet.connect(owner1).submit(recipient.address, 200n);
      await wallet.connect(owner2).confirm(1n);
      await expect(
        wallet.connect(owner1).execute(1n)
      ).to.be.revertedWith("not enough confirmations");
    });

    it("should transfer funds correctly", async function () {
      const initialBalance = await ethers.provider.getBalance(recipient.address);
      await wallet.connect(owner1).execute(0n);
      const finalBalance = await ethers.provider.getBalance(recipient.address);
      expect(finalBalance - initialBalance).to.equal(100n);
    });

    it("should mark transaction as executed", async function () {
      await wallet.connect(owner1).execute(0n);
      const txn = await wallet.transactions(0n);
      expect(txn.executed).to.be.true;
    });
  });

  describe("receive", function () {
    it("should accept ether deposits", async function () {
      const tx = await owner1.sendTransaction({
        to: await wallet.getAddress(),
        value: ethers.parseEther("1.0")
      });
      await expect(tx).to.changeEtherBalances(
        [owner1, wallet],
        [ethers.parseEther("-1.0"), ethers.parseEther("1.0")]
      );
    });
  });
});