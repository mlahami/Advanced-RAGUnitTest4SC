const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MetaCoin", function () {
  let metaCoin;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const MetaCoinFactory = await ethers.getContractFactory("MetaCoin");
    metaCoin = await MetaCoinFactory.deploy();
    await metaCoin.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should assign the total amount of tokens to the owner", async function () {
      const ownerBalance = await metaCoin.getBalance(owner.address);
      expect(ownerBalance).to.equal(10000n);
    });
  });

  describe("sendCoin", function () {
    it("Should transfer tokens between accounts", async function () {
      await metaCoin.sendCoin(addr1.address, 100n);

      const ownerBalance = await metaCoin.getBalance(owner.address);
      expect(ownerBalance).to.equal(9900n);

      const addr1Balance = await metaCoin.getBalance(addr1.address);
      expect(addr1Balance).to.equal(100n);
    });

    it("Should emit Transfer event", async function () {
      await expect(metaCoin.sendCoin(addr1.address, 100n))
        .to.emit(metaCoin, "Transfer")
        .withArgs(owner.address, addr1.address, 100n);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await metaCoin.getBalance(owner.address);

      await expect(metaCoin.sendCoin(addr1.address, initialOwnerBalance + 1n))
        .to.be.reverted;

      const ownerBalance = await metaCoin.getBalance(owner.address);
      expect(ownerBalance).to.equal(initialOwnerBalance);
    });

    it("Should return false if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await metaCoin.getBalance(owner.address);
      const result = await metaCoin.sendCoin(addr1.address, initialOwnerBalance + 1n);
      expect(result).to.be.false;
    });
  });

  describe("getBalance", function () {
    it("Should return the correct balance", async function () {
      const balance = await metaCoin.getBalance(owner.address);
      expect(balance).to.equal(10000n);
    });

    it("Should return zero for accounts with no balance", async function () {
      const balance = await metaCoin.getBalance(addr1.address);
      expect(balance).to.equal(0n);
    });
  });

  describe("getBalanceInEth", function () {
    it("Should return the correct balance converted to ETH", async function () {
      const balanceInEth = await metaCoin.getBalanceInEth(owner.address);
      expect(balanceInEth).to.equal(20000n); // 10000 * 2
    });

    it("Should return zero for accounts with no balance", async function () {
      const balanceInEth = await metaCoin.getBalanceInEth(addr1.address);
      expect(balanceInEth).to.equal(0n);
    });
  });
});