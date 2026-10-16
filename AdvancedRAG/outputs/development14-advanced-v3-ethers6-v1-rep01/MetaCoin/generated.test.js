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
    it("Should assign initial balance to the deployer", async function () {
      expect(await metaCoin.getBalance(owner.address)).to.equal(10000n);
    });

    it("Should have zero balance for other accounts", async function () {
      expect(await metaCoin.getBalance(addr1.address)).to.equal(0n);
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
      const amount = 10001n;
      await expect(metaCoin.sendCoin(addr1.address, amount)).to.be.reverted;
      expect(await metaCoin.getBalance(owner.address)).to.equal(10000n);
    });

    it("Should fail when transferring to zero address", async function () {
      const amount = 100n;
      await expect(metaCoin.sendCoin(ethers.ZeroAddress, amount)).to.be.reverted;
    });
  });

  describe("getBalance", function () {
    it("Should return the correct balance", async function () {
      expect(await metaCoin.getBalance(owner.address)).to.equal(10000n);
    });

    it("Should return zero for non-existent accounts", async function () {
      expect(await metaCoin.getBalance(addr2.address)).to.equal(0n);
    });
  });

  describe("getBalanceInEth", function () {
    it("Should return the correct converted balance", async function () {
      expect(await metaCoin.getBalanceInEth(owner.address)).to.equal(20000n);
    });

    it("Should return zero for non-existent accounts", async function () {
      expect(await metaCoin.getBalanceInEth(addr2.address)).to.equal(0n);
    });
  });
});