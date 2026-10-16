const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PaymentSplitter", function () {
  let PaymentSplitter;
  let paymentSplitter;
  let owner;
  let payee1;
  let payee2;
  let payee3;

  beforeEach(async function () {
    [owner, payee1, payee2, payee3] = await ethers.getSigners();

    PaymentSplitter = await ethers.getContractFactory("PaymentSplitter");
    paymentSplitter = await PaymentSplitter.deploy(
      [payee1.address, payee2.address, payee3.address],
      [100n, 200n, 300n]
    );
    await paymentSplitter.waitForDeployment();
  });

  it("should deploy with correct initial state", async function () {
    expect(await paymentSplitter.payees(0)).to.equal(payee1.address);
    expect(await paymentSplitter.payees(1)).to.equal(payee2.address);
    expect(await paymentSplitter.payees(2)).to.equal(payee3.address);

    expect(await paymentSplitter.shares(payee1.address)).to.equal(100n);
    expect(await paymentSplitter.shares(payee2.address)).to.equal(200n);
    expect(await paymentSplitter.shares(payee3.address)).to.equal(300n);

    expect(await paymentSplitter.totalShares()).to.equal(600n);
  });

  it("should reject deployment with mismatched arrays", async function () {
    await expect(
      PaymentSplitter.deploy(
        [payee1.address, payee2.address],
        [100n, 200n, 300n]
      )
    ).to.be.revertedWith("bad input");
  });

  it("should reject deployment with empty payees array", async function () {
    await expect(
      PaymentSplitter.deploy([], [])
    ).to.be.revertedWith("bad input");
  });

  it("should reject deployment with zero address payee", async function () {
    await expect(
      PaymentSplitter.deploy(
        [ethers.ZeroAddress, payee2.address, payee3.address],
        [100n, 200n, 300n]
      )
    ).to.be.revertedWith("bad payee");
  });

  it("should reject deployment with zero share", async function () {
    await expect(
      PaymentSplitter.deploy(
        [payee1.address, payee2.address, payee3.address],
        [100n, 0n, 300n]
      )
    ).to.be.revertedWith("bad payee");
  });

  it("should accept ether through receive function", async function () {
    const amount = ethers.parseEther("1.0");
    await owner.sendTransaction({
      to: await paymentSplitter.getAddress(),
      value: amount
    });

    expect(await ethers.provider.getBalance(await paymentSplitter.getAddress())).to.equal(amount);
  });

  it("should distribute funds correctly", async function () {
    const amount = ethers.parseEther("1.0");
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

    // Calculate expected amounts (1/6, 2/6, 3/6 of 1 ether)
    const expected1 = ethers.parseEther("0.166666666666666666");
    const expected2 = ethers.parseEther("0.333333333333333332");
    const expected3 = ethers.parseEther("0.5");

    // Check that the received amounts are close to expected (allowing for gas costs)
    expect(finalBalance1 - initialBalance1).to.be.closeTo(expected1, ethers.parseEther("0.01"));
    expect(finalBalance2 - initialBalance2).to.be.closeTo(expected2, ethers.parseEther("0.01"));
    expect(finalBalance3 - initialBalance3).to.be.closeTo(expected3, ethers.parseEther("0.01"));

    // Check contract balance is now zero
    expect(await ethers.provider.getBalance(await paymentSplitter.getAddress())).to.equal(0n);
  });

  it("should reject distribution when no funds are available", async function () {
    await expect(paymentSplitter.distribute()).to.be.revertedWith("no funds");
  });

  it("should handle distribution with exact division", async function () {
    const amount = ethers.parseEther("6.0");
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

    // Exact expected amounts (1/6, 2/6, 3/6 of 6 ether)
    const expected1 = ethers.parseEther("1.0");
    const expected2 = ethers.parseEther("2.0");
    const expected3 = ethers.parseEther("3.0");

    expect(finalBalance1 - initialBalance1).to.equal(expected1);
    expect(finalBalance2 - initialBalance2).to.equal(expected2);
    expect(finalBalance3 - initialBalance3).to.equal(expected3);

    expect(await ethers.provider.getBalance(await paymentSplitter.getAddress())).to.equal(0n);
  });
});