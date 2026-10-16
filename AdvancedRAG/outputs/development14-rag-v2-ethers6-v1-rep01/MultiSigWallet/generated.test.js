const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  let MultiSigWallet;
  let wallet;
  let owner1, owner2, owner3, nonOwner;
  const required = 2n;

  beforeEach(async function () {
    [owner1, owner2, owner3, nonOwner] = await ethers.getSigners();
    MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    wallet = await MultiSigWallet.deploy(
      [owner1.address, owner2.address, owner3.address],
      required
    );
    await wallet.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owners", async function () {
      expect(await wallet.owners(0)).to.equal(owner1.address);
      expect(await wallet.owners(1)).to.equal(owner2.address);
      expect(await wallet.owners(2)).to.equal(owner3.address);
    });

    it("Should set the correct required confirmations", async function () {
      expect(await wallet.required()).to.equal(required);
    });

    it("Should revert if required is zero", async function () {
      await expect(
        MultiSigWallet.deploy([owner1.address], 0n)
      ).to.be.revertedWith("bad threshold");
    });

    it("Should revert if required exceeds owners length", async function () {
      await expect(
        MultiSigWallet.deploy([owner1.address], 2n)
      ).to.be.revertedWith("bad threshold");
    });

    it("Should revert if owner is zero address", async function () {
      await expect(
        MultiSigWallet.deploy([ethers.ZeroAddress, owner2.address], 1n)
      ).to.be.revertedWith("bad owner");
    });

    it("Should revert if duplicate owners", async function () {
      await expect(
        MultiSigWallet.deploy([owner1.address, owner1.address], 1n)
      ).to.be.revertedWith("bad owner");
    });
  });

  describe("submit", function () {
    it("Should allow owner to submit transaction", async function () {
      const tx = await wallet.submit(nonOwner.address, ethers.parseEther("1"));
      await expect(tx).to.emit(wallet, "TransactionSubmitted");
      const txId = await wallet.transactions(0);
      expect(txId.to).to.equal(nonOwner.address);
      expect(txId.value).to.equal(ethers.parseEther("1"));
    });

    it("Should revert if non-owner tries to submit", async function () {
      await expect(
        wallet.connect(nonOwner).submit(nonOwner.address, ethers.parseEther("1"))
      ).to.be.revertedWith("not owner");
    });
  });

  describe("confirm", function () {
    beforeEach(async function () {
      await wallet.submit(nonOwner.address, ethers.parseEther("1"));
    });

    it("Should allow owner to confirm transaction", async function () {
      const tx = await wallet.confirm(0n);
      await expect(tx).to.emit(wallet, "TransactionConfirmed");
      expect(await wallet.confirmed(0n, owner1.address)).to.be.true;
    });

    it("Should revert if non-owner tries to confirm", async function () {
      await expect(
        wallet.connect(nonOwner).confirm(0n)
      ).to.be.revertedWith("not owner");
    });

    it("Should revert if already confirmed", async function () {
      await wallet.confirm(0n);
      await expect(wallet.confirm(0n)).to.be.revertedWith("already confirmed");
    });

    it("Should revert if transaction already executed", async function () {
      await wallet.confirm(0n);
      await wallet.connect(owner2).confirm(0n);
      await wallet.execute(0n);
      await expect(wallet.confirm(0n)).to.be.revertedWith("executed");
    });
  });

  describe("execute", function () {
    beforeEach(async function () {
      await wallet.submit(nonOwner.address, ethers.parseEther("1"));
      await wallet.confirm(0n);
      await wallet.connect(owner2).confirm(0n);
    });

    it("Should allow owner to execute transaction", async function () {
      const initialBalance = await ethers.provider.getBalance(nonOwner.address);
      const tx = await wallet.execute(0n);
      await expect(tx).to.emit(wallet, "TransactionExecuted");
      const finalBalance = await ethers.provider.getBalance(nonOwner.address);
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1"));
    });

    it("Should revert if non-owner tries to execute", async function () {
      await expect(
        wallet.connect(nonOwner).execute(0n)
      ).to.be.revertedWith("not owner");
    });

    it("Should revert if not enough confirmations", async function () {
      await wallet.submit(nonOwner.address, ethers.parseEther("1"));
      await wallet.confirm(1n);
      await expect(wallet.execute(1n)).to.be.revertedWith("not enough confirmations");
    });

    it("Should revert if transaction already executed", async function () {
      await wallet.execute(0n);
      await expect(wallet.execute(0n)).to.be.revertedWith("executed");
    });

    it("Should revert if transfer fails", async function () {
      const failingContract = await ethers.deployContract("BenchmarkTarget");
      await wallet.submit(failingContract.getAddress(), 0n);
      await wallet.confirm(2n);
      await wallet.connect(owner2).confirm(2n);
      await expect(wallet.execute(2n)).to.be.revertedWith("transfer failed");
    });
  });

  describe("receive", function () {
    it("Should accept ETH deposits", async function () {
      const amount = ethers.parseEther("1");
      const tx = await owner1.sendTransaction({
        to: await wallet.getAddress(),
        value: amount
      });
      await expect(tx).to.changeEtherBalances(
        [owner1, wallet],
        [-amount, amount]
      );
    });
  });
});