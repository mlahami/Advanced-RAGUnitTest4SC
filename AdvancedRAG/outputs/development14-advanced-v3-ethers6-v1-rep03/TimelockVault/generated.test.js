const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TimelockVault", function () {
  let timelockVault;
  let owner;
  let otherAccount;
  const delaySeconds = 3600n; // 1 hour
  const amount = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    const TimelockVault = await ethers.getContractFactory("TimelockVault");
    timelockVault = await TimelockVault.deploy(delaySeconds, { value: amount });
    await timelockVault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await timelockVault.owner()).to.equal(owner.address);
    });

    it("Should set the correct unlock time", async function () {
      const currentTimestamp = await time.latest();
      expect(await timelockVault.unlockTime()).to.equal(currentTimestamp + delaySeconds);
    });

    it("Should receive and store the funds", async function () {
      expect(await ethers.provider.getBalance(await timelockVault.getAddress())).to.equal(amount);
    });
  });

  describe("Withdrawals", function () {
    describe("Validations", function () {
      it("Should revert with the right error if called too soon", async function () {
        await expect(timelockVault.withdraw()).to.be.revertedWith("locked");
      });

      it("Should revert with the right error if called from another account", async function () {
        await time.increaseTo(await timelockVault.unlockTime());
        await expect(timelockVault.connect(otherAccount).withdraw()).to.be.revertedWith("not owner");
      });
    });

    describe("Events", function () {
      it("Should emit an event on withdrawals", async function () {
        await time.increaseTo(await timelockVault.unlockTime());
        await expect(timelockVault.withdraw()).to.not.be.reverted;
      });
    });

    describe("Transfers", function () {
      it("Should transfer the funds to the owner if no one else is payable", async function () {
        await time.increaseTo(await timelockVault.unlockTime());
        const initialBalance = await ethers.provider.getBalance(owner.address);
        const tx = await timelockVault.withdraw();
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * tx.gasPrice;
        const finalBalance = await ethers.provider.getBalance(owner.address);

        expect(finalBalance).to.equal(initialBalance + amount - gasUsed);
      });
    });
  });
});