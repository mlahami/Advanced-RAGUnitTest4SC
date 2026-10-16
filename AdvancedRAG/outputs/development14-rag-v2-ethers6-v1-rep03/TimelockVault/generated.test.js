const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TimelockVault", function () {
  let TimelockVault;
  let vault;
  let owner;
  let otherAccount;
  const delaySeconds = 3600n; // 1 hour
  const depositAmount = ethers.parseEther("1.0");

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    TimelockVault = await ethers.getContractFactory("TimelockVault");
    vault = await TimelockVault.deploy(delaySeconds, { value: depositAmount });
    await vault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("Should set the correct unlock time", async function () {
      const currentTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
      expect(await vault.unlockTime()).to.equal(currentTimestamp + Number(delaySeconds));
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
        const currentTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await ethers.provider.send("evm_setNextBlockTimestamp", [currentTimestamp + Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine", []);

        await expect(vault.connect(otherAccount).withdraw()).to.be.revertedWith("not owner");
      });
    });

    describe("Transfers", function () {
      it("Should transfer the funds to the owner", async function () {
        const currentTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await ethers.provider.send("evm_setNextBlockTimestamp", [currentTimestamp + Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine", []);

        const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
        const tx = await vault.withdraw();
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
        to: await vault.getAddress(),
        value: additionalAmount
      });

      await expect(tx).to.changeEtherBalances(
        [vault, owner],
        [additionalAmount, -additionalAmount]
      );
    });
  });
});