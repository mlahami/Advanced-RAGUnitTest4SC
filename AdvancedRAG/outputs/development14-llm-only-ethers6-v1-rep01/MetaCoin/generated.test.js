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

    it("Should set other accounts balance to zero", async function () {
      expect(await metaCoin.getBalance(addr1.address)).to.equal(0n);
      expect(await metaCoin.getBalance(addr2.address)).to.equal(0n);
    });
  });

  describe("sendCoin", function () {
    it("Should transfer tokens between accounts", async function () {
      await expect(metaCoin.sendCoin(addr1.address, 100n))
        .to.emit(metaCoin, "Transfer")
        .withArgs(owner.address, addr1.address, 100n);

      expect(await metaCoin.getBalance(owner.address)).to.equal(9900n);
      expect(await metaCoin.getBalance(addr1.address)).to.equal(100n);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      await expect(metaCoin.connect(addr1).sendCoin(addr2.address, 1n))
        .to.be.reverted;
    });

    it("Should return false if sender doesn't have enough tokens", async function () {
      const result = await metaCoin.connect(addr1).sendCoin(addr2.address, 1n);
      expect(result).to.be.false;
    });
  });

  describe("getBalance", function () {
    it("Should return the correct balance", async function () {
      expect(await metaCoin.getBalance(owner.address)).to.equal(10000n);
    });
  });

  describe("getBalanceInEth", function () {
    it("Should return the correct balance converted to ETH", async function () {
      expect(await metaCoin.getBalanceInEth(owner.address)).to.equal(20000n);
    });
  });
});