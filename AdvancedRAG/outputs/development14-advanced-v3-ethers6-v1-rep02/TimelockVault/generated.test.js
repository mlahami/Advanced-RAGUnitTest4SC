const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TimelockVault", function () {
  let vault;
  let owner;
  let otherAccount;
  const delaySeconds = 3600n; // 1 hour delay

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    const Vault = await ethers.getContractFactory("TimelockVault");
    vault = await Vault.deploy(delaySeconds, { value: ethers.parseEther("1") });
    await vault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("Should set the correct unlock time", async function () {
      const currentTimestamp = await time.latest();
      expect(await vault.unlockTime()).to.equal(currentTimestamp + delaySeconds);
    });

    it("Should receive and store the funds", async function () {
      const balance = await ethers.provider.getBalance(await vault.getAddress());
      expect(balance).to.equal(ethers.parseEther("1"));
    });
  });

  describe("Withdrawals", function () {
    describe("Validations", function () {
      it("Should revert with the right error if called too soon", async function () {
        await expect(vault.withdraw()).to.be.revertedWith("locked");
      });

      it("Should revert with the right error if called from another account", async function () {
        await time.increaseTo(await vault.unlockTime());
        await expect(vault.connect(otherAccount).withdraw()).to.be.revertedWith("not owner");
      });
    });

    describe("Events", function () {
      it("Should emit an event on withdrawals", async function () {
        await time.increaseTo(await vault.unlockTime());
        await expect(vault.withdraw()).to.not.emit(vault, "Withdrawn");
      });
    });

    describe("Transfers", function () {
      it("Should transfer the funds to the owner", async function () {
        await time.increaseTo(await vault.unlockTime());
        const initialBalance = await ethers.provider.getBalance(owner.address);
        const tx = await vault.withdraw();
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;
        const finalBalance = await ethers.provider.getBalance(owner.address);

        expect(finalBalance).to.equal(initialBalance + ethers.parseEther("1") - gasUsed);
      });
    });
  });

  describe("Receive", function () {
    it("Should accept ETH transfers", async function () {
      const initialBalance = await ethers.provider.getBalance(await vault.getAddress());
      await owner.sendTransaction({
        to: await vault.getAddress(),
        value: ethers.parseEther("1")
      });
      const finalBalance = await ethers.provider.getBalance(await vault.getAddress());
      expect(finalBalance).to.equal(initialBalance + ethers.parseEther("1"));
    });
  });
});