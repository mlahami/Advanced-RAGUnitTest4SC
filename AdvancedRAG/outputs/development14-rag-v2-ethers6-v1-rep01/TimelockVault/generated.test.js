const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TimelockVault", function () {
  let timelockVault;
  let owner;
  let otherAccount;
  const delaySeconds = 3600n; // 1 hour
  const depositAmount = ethers.parseEther("1.0");

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    const TimelockVault = await ethers.getContractFactory("TimelockVault");
    timelockVault = await TimelockVault.deploy(delaySeconds, { value: depositAmount });
    await timelockVault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await timelockVault.owner()).to.equal(owner.address);
    });

    it("Should set the right unlock time", async function () {
      const currentTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
      expect(await timelockVault.unlockTime()).to.equal(currentTimestamp + Number(delaySeconds));
    });

    it("Should receive and store the funds", async function () {
      expect(await ethers.provider.getBalance(await timelockVault.getAddress())).to.equal(depositAmount);
    });
  });

  describe("Withdrawals", function () {
    describe("Validations", function () {
      it("Should revert with the right error if called too soon", async function () {
        await expect(timelockVault.withdraw()).to.be.revertedWith("locked");
      });

      it("Should revert with the right error if called from another account", async function () {
        const currentTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await ethers.provider.send("evm_setNextBlockTimestamp", [currentTimestamp + Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine", []);

        await expect(timelockVault.connect(otherAccount).withdraw()).to.be.revertedWith("not owner");
      });

      it("Shouldn't fail if the unlockTime has arrived and the owner calls it", async function () {
        const currentTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await ethers.provider.send("evm_setNextBlockTimestamp", [currentTimestamp + Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine", []);

        await expect(timelockVault.withdraw()).not.to.be.reverted;
      });
    });

    describe("Transfers", function () {
      it("Should transfer the funds to the owner", async function () {
        const currentTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await ethers.provider.send("evm_setNextBlockTimestamp", [currentTimestamp + Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine", []);

        const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
        const tx = await timelockVault.withdraw();
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;

        const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
        expect(finalOwnerBalance).to.equal(initialOwnerBalance + depositAmount - gasUsed);
      });
    });
  });

  describe("Receive", function () {
    it("Should accept ETH deposits", async function () {
      const additionalAmount = ethers.parseEther("0.5");
      const tx = await owner.sendTransaction({
        to: await timelockVault.getAddress(),
        value: additionalAmount
      });
      await tx.wait();

      expect(await ethers.provider.getBalance(await timelockVault.getAddress())).to.equal(depositAmount + additionalAmount);
    });
  });
});