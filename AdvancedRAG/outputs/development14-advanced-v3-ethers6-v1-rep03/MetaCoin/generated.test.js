const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MetaCoin", function () {
  let metaCoin;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    const MetaCoin = await ethers.getContractFactory("MetaCoin");
    metaCoin = await MetaCoin.deploy();
    await metaCoin.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should assign the initial balance to the owner", async function () {
      expect(await metaCoin.getBalance(owner.address)).to.equal(10000n);
    });

    it("Should have zero balance for other accounts", async function () {
      expect(await metaCoin.getBalance(addr1.address)).to.equal(0n);
      expect(await metaCoin.getBalance(addr2.address)).to.equal(0n);
    });
  });

  describe("sendCoin", function () {
    it("Should transfer coins between accounts", async function () {
      const amount = 100n;
      await expect(metaCoin.sendCoin(addr1.address, amount))
        .to.emit(metaCoin, "Transfer")
        .withArgs(owner.address, addr1.address, amount);

      expect(await metaCoin.getBalance(owner.address)).to.equal(9900n);
      expect(await metaCoin.getBalance(addr1.address)).to.equal(amount);
    });

    it("Should fail if sender doesn't have enough coins", async function () {
      const initialBalance = await metaCoin.getBalance(owner.address);
      await expect(metaCoin.connect(addr1).sendCoin(owner.address, 1n))
        .to.be.reverted;
      expect(await metaCoin.getBalance(owner.address)).to.equal(initialBalance);
    });

    it("Should fail when transferring to zero address", async function () {
      await expect(metaCoin.sendCoin(ethers.ZeroAddress, 100n))
        .to.be.reverted;
    });

    it("Should return false when transfer fails", async function () {
      const result = await metaCoin.connect(addr1).sendCoin.staticCall(owner.address, 1n);
      expect(result).to.be.false;
    });
  });

  describe("getBalance", function () {
    it("Should return the correct balance for an account", async function () {
      const amount = 500n;
      await metaCoin.sendCoin(addr1.address, amount);
      expect(await metaCoin.getBalance(addr1.address)).to.equal(amount);
    });

    it("Should return zero for an account with no balance", async function () {
      expect(await metaCoin.getBalance(addr2.address)).to.equal(0n);
    });
  });

  describe("getBalanceInEth", function () {
    it("Should return the balance converted to ETH", async function () {
      const amount = 500n;
      await metaCoin.sendCoin(addr1.address, amount);
      expect(await metaCoin.getBalanceInEth(addr1.address)).to.equal(amount * 2n);
    });

    it("Should return zero for an account with no balance", async function () {
      expect(await metaCoin.getBalanceInEth(addr2.address)).to.equal(0n);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle maximum uint256 value transfer", async function () {
      const maxAmount = ethers.MaxUint256;
      await expect(metaCoin.sendCoin(addr1.address, maxAmount))
        .to.be.reverted;
    });

    it("Should handle zero value transfer", async function () {
      const initialBalance = await metaCoin.getBalance(owner.address);
      await expect(metaCoin.sendCoin(addr1.address, 0n))
        .to.emit(metaCoin, "Transfer")
        .withArgs(owner.address, addr1.address, 0n);
      expect(await metaCoin.getBalance(owner.address)).to.equal(initialBalance);
    });
  });
});