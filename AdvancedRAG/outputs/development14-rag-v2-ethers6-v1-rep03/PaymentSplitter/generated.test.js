const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PaymentSplitter", function () {
  let contract;
  let owner;
  let payee1;
  let payee2;
  let payee3;

  beforeEach(async function () {
    [owner, payee1, payee2, payee3] = await ethers.getSigners();

    const PaymentSplitter = await ethers.getContractFactory("PaymentSplitter");
    contract = await PaymentSplitter.deploy(
      [payee1.address, payee2.address, payee3.address],
      [100n, 200n, 300n]
    );
    await contract.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct payees and shares", async function () {
      expect(await contract.payees(0)).to.equal(payee1.address);
      expect(await contract.payees(1)).to.equal(payee2.address);
      expect(await contract.payees(2)).to.equal(payee3.address);

      expect(await contract.shares(payee1.address)).to.equal(100n);
      expect(await contract.shares(payee2.address)).to.equal(200n);
      expect(await contract.shares(payee3.address)).to.equal(300n);

      expect(await contract.totalShares()).to.equal(600n);
    });

    it("Should revert with invalid input", async function () {
      const PaymentSplitter = await ethers.getContractFactory("PaymentSplitter");

      await expect(
        PaymentSplitter.deploy([], [])
      ).to.be.revertedWith("bad input");

      await expect(
        PaymentSplitter.deploy([payee1.address], [])
      ).to.be.revertedWith("bad input");

      await expect(
        PaymentSplitter.deploy([payee1.address, payee2.address], [100n])
      ).to.be.revertedWith("bad input");
    });

    it("Should revert with zero address or zero shares", async function () {
      const PaymentSplitter = await ethers.getContractFactory("PaymentSplitter");

      await expect(
        PaymentSplitter.deploy([ethers.ZeroAddress, payee2.address], [100n, 200n])
      ).to.be.revertedWith("bad payee");

      await expect(
        PaymentSplitter.deploy([payee1.address, payee2.address], [0n, 200n])
      ).to.be.revertedWith("bad payee");
    });
  });

  describe("Receive", function () {
    it("Should accept ETH", async function () {
      const amount = ethers.parseEther("1");
      await owner.sendTransaction({
        to: await contract.getAddress(),
        value: amount
      });

      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(amount);
    });
  });

  describe("Distribute", function () {
    it("Should distribute ETH according to shares", async function () {
      const amount = ethers.parseEther("1");
      await owner.sendTransaction({
        to: await contract.getAddress(),
        value: amount
      });

      const initialBalances = [
        await ethers.provider.getBalance(payee1.address),
        await ethers.provider.getBalance(payee2.address),
        await ethers.provider.getBalance(payee3.address)
      ];

      await contract.distribute();

      const finalBalances = [
        await ethers.provider.getBalance(payee1.address),
        await ethers.provider.getBalance(payee2.address),
        await ethers.provider.getBalance(payee3.address)
      ];

      // Calculate expected amounts (100/600, 200/600, 300/600)
      const expectedAmounts = [
        amount * 100n / 600n,
        amount * 200n / 600n,
        amount * 300n / 600n
      ];

      // Check that each payee received the correct amount
      for (let i = 0; i < 3; i++) {
        expect(finalBalances[i] - initialBalances[i]).to.be.closeTo(expectedAmounts[i], ethers.parseEther("0.001"));
      }

      // Check that contract balance is now zero
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
    });

    it("Should revert when no funds to distribute", async function () {
      await expect(contract.distribute()).to.be.revertedWith("no funds");
    });
  });
});