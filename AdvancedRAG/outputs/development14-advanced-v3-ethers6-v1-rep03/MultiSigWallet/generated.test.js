const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  let MultiSigWallet;
  let wallet;
  let owners;
  let nonOwner;
  let recipient;

  beforeEach(async function () {
    [owner1, owner2, owner3, nonOwner, recipient] = await ethers.getSigners();
    owners = [owner1.address, owner2.address, owner3.address];

    MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    wallet = await MultiSigWallet.deploy(owners, 2n);
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

    it("should revert if required is 0", async function () {
      await expect(MultiSigWallet.deploy(owners, 0n)).to.be.revertedWith("bad threshold");
    });

    it("should revert if required exceeds owners count", async function () {
      await expect(MultiSigWallet.deploy(owners, 4n)).to.be.revertedWith("bad threshold");
    });

    it("should revert if owner is zero address", async function () {
      await expect(MultiSigWallet.deploy([owner1.address, ethers.ZeroAddress], 1n)).to.be.revertedWith("bad owner");
    });

    it("should revert if duplicate owners", async function () {
      await expect(MultiSigWallet.deploy([owner1.address, owner1.address], 1n)).to.be.revertedWith("bad owner");
    });
  });

  describe("submit", function () {
    it("should allow owner to submit transaction", async function () {
      await expect(wallet.connect(owner1).submit(recipient.address, ethers.parseEther("1")))
        .to.emit(wallet, "Submission")
        .withArgs(0n, recipient.address, ethers.parseEther("1"));
    });

    it("should revert if non-owner tries to submit", async function () {
      await expect(wallet.connect(nonOwner).submit(recipient.address, ethers.parseEther("1")))
        .to.be.revertedWith("not owner");
    });

    it("should store transaction correctly", async function () {
      await wallet.connect(owner1).submit(recipient.address, ethers.parseEther("1"));
      const tx = await wallet.transactions(0);
      expect(tx.to).to.equal(recipient.address);
      expect(tx.value).to.equal(ethers.parseEther("1"));
      expect(tx.executed).to.be.false;
      expect(tx.confirmations).to.equal(0n);
    });
  });

  describe("confirm", function () {
    beforeEach(async function () {
      await wallet.connect(owner1).submit(recipient.address, ethers.parseEther("1"));
    });

    it("should allow owner to confirm transaction", async function () {
      await expect(wallet.connect(owner2).confirm(0n))
        .to.emit(wallet, "Confirmation")
        .withArgs(0n, owner2.address);
    });

    it("should revert if non-owner tries to confirm", async function () {
      await expect(wallet.connect(nonOwner).confirm(0n))
        .to.be.revertedWith("not owner");
    });

    it("should revert if owner confirms twice", async function () {
      await wallet.connect(owner2).confirm(0n);
      await expect(wallet.connect(owner2).confirm(0n))
        .to.be.revertedWith("already confirmed");
    });

    it("should revert if transaction is already executed", async function () {
      await wallet.connect(owner2).confirm(0n);
      await wallet.connect(owner1).execute(0n);
      await expect(wallet.connect(owner3).confirm(0n))
        .to.be.revertedWith("executed");
    });

    it("should update confirmations count", async function () {
      await wallet.connect(owner2).confirm(0n);
      const tx = await wallet.transactions(0);
      expect(tx.confirmations).to.equal(1n);
    });
  });

  describe("execute", function () {
    beforeEach(async function () {
      await wallet.connect(owner1).submit(recipient.address, ethers.parseEther("1"));
      await wallet.connect(owner2).confirm(0n);
    });

    it("should allow owner to execute transaction when threshold is met", async function () {
      const initialBalance = await ethers.provider.getBalance(recipient.address);
      await expect(wallet.connect(owner1).execute(0n))
        .to.emit(wallet, "Execution")
        .withArgs(0n);
      const finalBalance = await ethers.provider.getBalance(recipient.address);
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1"));
    });

    it("should revert if non-owner tries to execute", async function () {
      await expect(wallet.connect(nonOwner).execute(0n))
        .to.be.revertedWith("not owner");
    });

    it("should revert if transaction is already executed", async function () {
      await wallet.connect(owner1).execute(0n);
      await expect(wallet.connect(owner1).execute(0n))
        .to.be.revertedWith("executed");
    });

    it("should revert if not enough confirmations", async function () {
      await wallet.connect(owner1).submit(recipient.address, ethers.parseEther("1"));
      await expect(wallet.connect(owner1).execute(1n))
        .to.be.revertedWith("not enough confirmations");
    });

    it("should revert if transfer fails", async function () {
      const BadReceiver = await ethers.getContractFactory("BenchmarkTarget");
      const badReceiver = await BadReceiver.deploy();
      await badReceiver.waitForDeployment();

      await wallet.connect(owner1).submit(await badReceiver.getAddress(), ethers.parseEther("1"));
      await wallet.connect(owner2).confirm(1n);
      await expect(wallet.connect(owner1).execute(1n))
        .to.be.revertedWith("transfer failed");
    });
  });

  describe("receive", function () {
    it("should accept ether deposits", async function () {
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