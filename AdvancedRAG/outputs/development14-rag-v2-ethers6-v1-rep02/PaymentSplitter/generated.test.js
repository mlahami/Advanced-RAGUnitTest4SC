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
    it("Should set the right payees and shares", async function () {
      expect(await paymentSplitter.payees(0)).to.equal(payee1.address);
      expect(await paymentSplitter.payees(1)).to.equal(payee2.address);
      expect(await paymentSplitter.payees(2)).to.equal(payee3.address);

      expect(await paymentSplitter.shares(payee1.address)).to.equal(100n);
      expect(await paymentSplitter.shares(payee2.address)).to.equal(200n);
      expect(await paymentSplitter.shares(payee3.address)).to.equal(300n);

      expect(await paymentSplitter.totalShares()).to.equal(600n);
    });

    it("Should revert with invalid input", async function () {
      await expect(
        PaymentSplitter.deploy([], [])
      ).to.be.revertedWith("bad input");

      await expect(
        PaymentSplitter.deploy([payee1.address], [100n, 200n])
      ).to.be.revertedWith("bad input");

      await expect(
        PaymentSplitter.deploy([ethers.ZeroAddress], [100n])
      ).to.be.revertedWith("bad payee");

      await expect(
        PaymentSplitter.deploy([payee1.address], [0n])
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

      // Calculate expected amounts (100/600, 200/600, 300/600 of 1 ETH)
      const expectedAmounts = [
        amount * 100n / 600n,
        amount * 200n / 600n,
        amount * 300n / 600n
      ];

      // Check that each payee received the correct amount
      for (let i = 0; i < 3; i++) {
        expect(finalBalances[i] - initialBalances[i]).to.be.closeTo(expectedAmounts[i], ethers.parseEther("0.001"));
      }

      // Check that the contract balance is now 0
      expect(await ethers.provider.getBalance(await paymentSplitter.getAddress())).to.equal(0);
    });

    it("Should revert when no funds to distribute", async function () {
      await expect(paymentSplitter.distribute()).to.be.revertedWith("no funds");
    });
  });
});