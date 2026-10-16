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
    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await metaCoin.getBalance(owner.address);
      expect(ownerBalance).to.equal(10000n);
    });
  });

  describe("Transactions", function () {
    it("Should transfer tokens between accounts", async function () {
      await metaCoin.sendCoin(addr1.address, 100n);

      const ownerBalance = await metaCoin.getBalance(owner.address);
      expect(ownerBalance).to.equal(9900n);

      const addr1Balance = await metaCoin.getBalance(addr1.address);
      expect(addr1Balance).to.equal(100n);
    });

    it("Should emit Transfer events", async function () {
      await expect(metaCoin.sendCoin(addr1.address, 100n))
        .to.emit(metaCoin, "Transfer")
        .withArgs(owner.address, addr1.address, 100n);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await metaCoin.getBalance(owner.address);

      await expect(metaCoin.sendCoin(addr1.address, initialOwnerBalance + 1n))
        .to.be.reverted;

      expect(await metaCoin.getBalance(owner.address)).to.equal(initialOwnerBalance);
    });

    it("Should return false when transferring more than balance", async function () {
      const result = await metaCoin.sendCoin(addr1.address, 10001n);
      expect(result).to.be.false;
    });

    it("Should return true when transferring valid amount", async function () {
      const result = await metaCoin.sendCoin(addr1.address, 100n);
      expect(result).to.be.true;
    });
  });

  describe("Balance Checks", function () {
    it("Should return the correct balance for an account", async function () {
      await metaCoin.sendCoin(addr1.address, 100n);
      const balance = await metaCoin.getBalance(addr1.address);
      expect(balance).to.equal(100n);
    });

    it("Should return 0 for an account with no balance", async function () {
      const balance = await metaCoin.getBalance(addr2.address);
      expect(balance).to.equal(0n);
    });
  });

  describe("Conversion", function () {
    it("Should convert balance to ETH correctly", async function () {
      await metaCoin.sendCoin(addr1.address, 100n);
      const ethBalance = await metaCoin.getBalanceInEth(addr1.address);
      expect(ethBalance).to.equal(200n); // 100 * 2
    });

    it("Should return 0 ETH for account with 0 balance", async function () {
      const ethBalance = await metaCoin.getBalanceInEth(addr2.address);
      expect(ethBalance).to.equal(0n);
    });
  });
});