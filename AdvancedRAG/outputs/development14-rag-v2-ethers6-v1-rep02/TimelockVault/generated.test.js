const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TimelockVault", function () {
  let vault;
  let owner;
  let otherAccount;
  const delaySeconds = 3600n; // 1 hour
  const depositAmount = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    const TimelockVault = await ethers.getContractFactory("TimelockVault");
    vault = await TimelockVault.deploy(delaySeconds, { value: depositAmount });
    await vault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("Should set the right unlock time", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      expect(await vault.unlockTime()).to.equal(currentBlock.timestamp + Number(delaySeconds));
    });

    it("Should receive and store the funds", async function () {
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(depositAmount);
    });
  });

  describe("Withdrawals", function () {
    describe("Validations", function () {
      it("Should revert with the right error if called too soon", async function () {
        await expect(vault.withdraw()).to.be.revertedWith("locked");
      });

      it("Should revert with the right error if called from another account", async function () {
        const currentBlock = await ethers.provider.getBlock("latest");
        await ethers.provider.send("evm_setNextBlockTimestamp", [currentBlock.timestamp + Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine", []);

        await expect(vault.connect(otherAccount).withdraw()).to.be.revertedWith("not owner");
      });
    });

    describe("Transfers", function () {
      it("Should transfer the funds to the owner", async function () {
        const currentBlock = await ethers.provider.getBlock("latest");
        await ethers.provider.send("evm_setNextBlockTimestamp", [currentBlock.timestamp + Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine", []);

        await expect(vault.withdraw())
          .to.changeEtherBalances(
            [owner, vault],
            [depositAmount, -depositAmount]
          );
      });
    });
  });

  describe("Receive", function () {
    it("Should accept ETH deposits", async function () {
      const additionalAmount = ethers.parseEther("0.5");
      await expect(otherAccount.sendTransaction({
        to: await vault.getAddress(),
        value: additionalAmount
      })).to.changeEtherBalance(vault, additionalAmount);
    });
  });
});