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

  it("should reject deployment with mismatched payees and shares", async function () {
    await expect(
      PaymentSplitter.deploy(
        [payee1.address, payee2.address],
        [100n, 200n, 300n]
      )
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

    // Calculate expected amounts (100:200:300 ratio)
    const totalShares = 600n;
    const expectedAmount1 = amount * 100n / totalShares;
    const expectedAmount2 = amount * 200n / totalShares;
    const expectedAmount3 = amount * 300n / totalShares;

    expect(finalBalances[0] - initialBalances[0]).to.equal(expectedAmount1);
    expect(finalBalances[1] - initialBalances[1]).to.equal(expectedAmount2);
    expect(finalBalances[2] - initialBalances[2]).to.equal(expectedAmount3);

    expect(await ethers.provider.getBalance(await paymentSplitter.getAddress())).to.equal(0n);
  });

  it("should reject distribution when no funds are available", async function () {
    await expect(paymentSplitter.distribute()).to.be.revertedWith("no funds");
  });

  it("should handle uneven distribution with remainder", async function () {
    const amount = ethers.parseEther("1.0") + 1n; // 1 ETH + 1 wei
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

    // Calculate expected amounts (100:200:300 ratio)
    const totalShares = 600n;
    const expectedAmount1 = amount * 100n / totalShares;
    const expectedAmount2 = amount * 200n / totalShares;
    const expectedAmount3 = amount * 300n / totalShares;

    // The remainder (1 wei) will be distributed to the first payee
    expect(finalBalances[0] - initialBalances[0]).to.equal(expectedAmount1 + 1n);
    expect(finalBalances[1] - initialBalances[1]).to.equal(expectedAmount2);
    expect(finalBalances[2] - initialBalances[2]).to.equal(expectedAmount3);

    expect(await ethers.provider.getBalance(await paymentSplitter.getAddress())).to.equal(0n);
  });
});