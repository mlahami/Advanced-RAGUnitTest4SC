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
    it("Should set the right owner balance", async function () {
      expect(await metaCoin.getBalance(owner.address)).to.equal(10000n);
    });

    it("Should have zero balance for other accounts", async function () {
      expect(await metaCoin.getBalance(addr1.address)).to.equal(0n);
      expect(await metaCoin.getBalance(addr2.address)).to.equal(0n);
    });
  });

  describe("sendCoin", function () {
    it("Should transfer coins between accounts", async function () {
      await expect(metaCoin.sendCoin(addr1.address, 100n))
        .to.emit(metaCoin, "Transfer")
        .withArgs(owner.address, addr1.address, 100n);

      expect(await metaCoin.getBalance(owner.address)).to.equal(9900n);
      expect(await metaCoin.getBalance(addr1.address)).to.equal(100n);
    });

    it("Should fail if sender doesn't have enough coins", async function () {
      await expect(metaCoin.sendCoin(addr1.address, 10001n)).to.be.reverted;
      expect(await metaCoin.getBalance(owner.address)).to.equal(10000n);
      expect(await metaCoin.getBalance(addr1.address)).to.equal(0n);
    });

    it("Should return false when transfer fails", async function () {
      const result = await metaCoin.sendCoin(addr1.address, 10001n);
      expect(result).to.be.false;
    });
  });

  describe("getBalance", function () {
    it("Should return the correct balance", async function () {
      expect(await metaCoin.getBalance(owner.address)).to.equal(10000n);
    });
  });

  describe("getBalanceInEth", function () {
    it("Should return the correct converted balance", async function () {
      expect(await metaCoin.getBalanceInEth(owner.address)).to.equal(20000n);
    });

    it("Should return zero for accounts with zero balance", async function () {
      expect(await metaCoin.getBalanceInEth(addr1.address)).to.equal(0n);
    });
  });
});