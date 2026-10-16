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
    payees = [payee1.address, payee2.address, payee3.address];
    shares = [100n, 200n, 300n];
    paymentSplitter = await PaymentSplitter.deploy(payees, shares);
    await paymentSplitter.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct payees and shares", async function () {
      expect(await paymentSplitter.payees(0)).to.equal(payee1.address);
      expect(await paymentSplitter.payees(1)).to.equal(payee2.address);
      expect(await paymentSplitter.payees(2)).to.equal(payee3.address);
      expect(await paymentSplitter.shares(payee1.address)).to.equal(100n);
      expect(await paymentSplitter.shares(payee2.address)).to.equal(200n);
      expect(await paymentSplitter.shares(payee3.address)).to.equal(300n);
      expect(await paymentSplitter.totalShares()).to.equal(600n);
    });

    it("should revert if payees and shares arrays have different lengths", async function () {
      await expect(
        PaymentSplitter.deploy([payee1.address], [100n, 200n])
      ).to.be.revertedWith("bad input");
    });

    it("should revert if payees array is empty", async function () {
      await expect(
        PaymentSplitter.deploy([], [])
      ).to.be.revertedWith("bad input");
    });

    it("should revert if any payee is zero address", async function () {
      await expect(
        PaymentSplitter.deploy([ethers.ZeroAddress, payee2.address], [100n, 200n])
      ).to.be.revertedWith("bad payee");
    });

    it("should revert if any share is zero", async function () {
      await expect(
        PaymentSplitter.deploy([payee1.address, payee2.address], [100n, 0n])
      ).to.be.revertedWith("bad payee");
    });
  });

  describe("Receive", function () {
    it("should accept ether", async function () {
      const amount = ethers.parseEther("1.0");
      await owner.sendTransaction({
        to: await paymentSplitter.getAddress(),
        value: amount
      });
      expect(await ethers.provider.getBalance(await paymentSplitter.getAddress())).to.equal(amount);
    });
  });

  describe("Distribute", function () {
    it("should distribute funds correctly", async function () {
      const amount = ethers.parseEther("1.0");
      await owner.sendTransaction({
        to: await paymentSplitter.getAddress(),
        value: amount
      });

      const initialBalances = [
        await ethers.provider.getBalance(payee1.address),
        await ethers.provider.getBalance(payee2.address),
        await ethers.provider.getBalance(payee3.address)
      ];

      await paymentSplitter.distribute();

      const expectedAmounts = [
        amount * 100n / 600n,
        amount * 200n / 600n,
        amount * 300n / 600n
      ];

      expect(await ethers.provider.getBalance(payee1.address)).to.be.closeTo(
        initialBalances[0] + expectedAmounts[0],
        ethers.parseEther("0.001")
      );
      expect(await ethers.provider.getBalance(payee2.address)).to.be.closeTo(
        initialBalances[1] + expectedAmounts[1],
        ethers.parseEther("0.001")
      );
      expect(await ethers.provider.getBalance(payee3.address)).to.be.closeTo(
        initialBalances[2] + expectedAmounts[2],
        ethers.parseEther("0.001")
      );
      expect(await ethers.provider.getBalance(await paymentSplitter.getAddress())).to.equal(0n);
    });

    it("should revert if no funds to distribute", async function () {
      await expect(paymentSplitter.distribute()).to.be.revertedWith("no funds");
    });

    it("should handle uneven distribution", async function () {
      const amount = ethers.parseEther("1.0");
      await owner.sendTransaction({
        to: await paymentSplitter.getAddress(),
        value: amount
      });

      const initialBalances = [
        await ethers.provider.getBalance(payee1.address),
        await ethers.provider.getBalance(payee2.address),
        await ethers.provider.getBalance(payee3.address)
      ];

      await paymentSplitter.distribute();

      const finalBalances = [
        await ethers.provider.getBalance(payee1.address),
        await ethers.provider.getBalance(payee2.address),
        await ethers.provider.getBalance(payee3.address)
      ];

      // Check that the sum of all distributions equals the total amount
      expect(finalBalances[0] - initialBalances[0] +
             finalBalances[1] - initialBalances[1] +
             finalBalances[2] - initialBalances[2]).to.be.closeTo(
        amount,
        ethers.parseEther("0.001")
      );
    });
  });
});