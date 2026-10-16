const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PaymentSplitter", function () {
  let PaymentSplitter;
  let paymentSplitter;
  let owner;
  let payee1;
  let payee2;
  let payee3;
  let payees;
  let shares;

  beforeEach(async function () {
    [owner, payee1, payee2, payee3] = await ethers.getSigners();

    PaymentSplitter = await ethers.getContractFactory("PaymentSplitter");
    payees = [payee1.address, payee2.address];
    shares = [50n, 50n];

    paymentSplitter = await PaymentSplitter.deploy(payees, shares);
    await paymentSplitter.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right payees and shares", async function () {
      expect(await paymentSplitter.payees(0)).to.equal(payee1.address);
      expect(await paymentSplitter.payees(1)).to.equal(payee2.address);
      expect(await paymentSplitter.shares(payee1.address)).to.equal(50n);
      expect(await paymentSplitter.shares(payee2.address)).to.equal(50n);
      expect(await paymentSplitter.totalShares()).to.equal(100n);
    });

    it("Should revert with invalid input", async function () {
      await expect(
        PaymentSplitter.deploy([], [])
      ).to.be.revertedWith("bad input");

      await expect(
        PaymentSplitter.deploy([payee1.address], [])
      ).to.be.revertedWith("bad input");

      await expect(
        PaymentSplitter.deploy([payee1.address, payee2.address], [50n])
      ).to.be.revertedWith("bad input");
    });

    it("Should revert with invalid payee", async function () {
      await expect(
        PaymentSplitter.deploy([ethers.ZeroAddress, payee2.address], [50n, 50n])
      ).to.be.revertedWith("bad payee");

      await expect(
        PaymentSplitter.deploy([payee1.address, payee2.address], [0n, 50n])
      ).to.be.revertedWith("bad payee");
    });
  });

  describe("Receive", function () {
    it("Should accept ETH", async function () {
      const amount = ethers.parseEther("1");
      await owner.sendTransaction({
        to: await paymentSplitter.getAddress(),
        value: amount
      });

      expect(await ethers.provider.getBalance(await paymentSplitter.getAddress())).to.equal(amount);
    });
  });

  describe("Distribute", function () {
    it("Should distribute ETH according to shares", async function () {
      const amount = ethers.parseEther("1");
      await owner.sendTransaction({
        to: await paymentSplitter.getAddress(),
        value: amount
      });

      const initialBalance1 = await ethers.provider.getBalance(payee1.address);
      const initialBalance2 = await ethers.provider.getBalance(payee2.address);

      await paymentSplitter.distribute();

      const finalBalance1 = await ethers.provider.getBalance(payee1.address);
      const finalBalance2 = await ethers.provider.getBalance(payee2.address);

      // Check that each payee received half of the amount
      expect(finalBalance1 - initialBalance1).to.be.closeTo(amount / 2n, ethers.parseEther("0.01"));
      expect(finalBalance2 - initialBalance2).to.be.closeTo(amount / 2n, ethers.parseEther("0.01"));
    });

    it("Should revert when no funds to distribute", async function () {
      await expect(paymentSplitter.distribute()).to.be.revertedWith("no funds");
    });

    it("Should distribute remaining ETH after partial distribution", async function () {
      const amount = ethers.parseEther("1");
      await owner.sendTransaction({
        to: await paymentSplitter.getAddress(),
        value: amount
      });

      // First distribution
      await paymentSplitter.distribute();

      // Send more ETH
      await owner.sendTransaction({
        to: await paymentSplitter.getAddress(),
        value: amount
      });

      const initialBalance1 = await ethers.provider.getBalance(payee1.address);
      const initialBalance2 = await ethers.provider.getBalance(payee2.address);

      // Second distribution
      await paymentSplitter.distribute();

      const finalBalance1 = await ethers.provider.getBalance(payee1.address);
      const finalBalance2 = await ethers.provider.getBalance(payee2.address);

      // Check that each payee received another half of the amount
      expect(finalBalance1 - initialBalance1).to.be.closeTo(amount / 2n, ethers.parseEther("0.01"));
      expect(finalBalance2 - initialBalance2).to.be.closeTo(amount / 2n, ethers.parseEther("0.01"));
    });

    it("Should handle uneven distribution", async function () {
      // Update shares to be uneven
      payees = [payee1.address, payee2.address, payee3.address];
      shares = [30n, 50n, 20n];

      paymentSplitter = await PaymentSplitter.deploy(payees, shares);
      await paymentSplitter.waitForDeployment();

      const amount = ethers.parseEther("1");
      await owner.sendTransaction({
        to: await paymentSplitter.getAddress(),
        value: amount
      });

      const initialBalance1 = await ethers.provider.getBalance(payee1.address);
      const initialBalance2 = await ethers.provider.getBalance(payee2.address);
      const initialBalance3 = await ethers.provider.getBalance(payee3.address);

      await paymentSplitter.distribute();

      const finalBalance1 = await ethers.provider.getBalance(payee1.address);
      const finalBalance2 = await ethers.provider.getBalance(payee2.address);
      const finalBalance3 = await ethers.provider.getBalance(payee3.address);

      // Check that each payee received their proportional share
      expect(finalBalance1 - initialBalance1).to.be.closeTo(amount * 30n / 100n, ethers.parseEther("0.01"));
      expect(finalBalance2 - initialBalance2).to.be.closeTo(amount * 50n / 100n, ethers.parseEther("0.01"));
      expect(finalBalance3 - initialBalance3).to.be.closeTo(amount * 20n / 100n, ethers.parseEther("0.01"));
    });
  });
});