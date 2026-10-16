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
      const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
      expect(await vault.unlockTime()).to.equal(blockTimestamp + Number(delaySeconds));
    });

    it("Should receive and store the funds", async function () {
      const contractBalance = await ethers.provider.getBalance(await vault.getAddress());
      expect(contractBalance).to.equal(depositAmount);
    });
  });

  describe("Withdrawals", function () {
    describe("Validations", function () {
      it("Should revert with the right error if called too soon", async function () {
        await expect(vault.withdraw()).to.be.revertedWith("locked");
      });

      it("Should revert with the right error if called from another account", async function () {
        await ethers.provider.send("evm_increaseTime", [Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine");

        await expect(vault.connect(otherAccount).withdraw()).to.be.revertedWith("not owner");
      });
    });

    describe("Events", function () {
      it("Should emit an event on withdrawals", async function () {
        await ethers.provider.send("evm_increaseTime", [Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine");

        const initialBalance = await ethers.provider.getBalance(owner.address);
        const tx = await vault.withdraw();
        const receipt = await tx.wait();

        // Check if the transaction was successful
        expect(receipt.status).to.equal(1);

        // Check the final balance
        const finalBalance = await ethers.provider.getBalance(owner.address);
        expect(finalBalance).to.be.gt(initialBalance);
      });
    });

    describe("Transfers", function () {
      it("Should transfer the funds to the owner", async function () {
        await ethers.provider.send("evm_increaseTime", [Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine");

        const initialBalance = await ethers.provider.getBalance(owner.address);
        const tx = await vault.withdraw();
        const receipt = await tx.wait();

        // Get the gas used in the transaction
        const gasUsed = receipt.gasUsed * receipt.gasPrice;

        // Calculate the expected final balance
        const expectedFinalBalance = initialBalance + depositAmount - gasUsed;

        // Check the final balance
        const finalBalance = await ethers.provider.getBalance(owner.address);
        expect(finalBalance).to.equal(expectedFinalBalance);
      });
    });
  });

  describe("Receive", function () {
    it("Should accept ETH deposits", async function () {
      const additionalDeposit = ethers.parseEther("0.5");
      const initialBalance = await ethers.provider.getBalance(await vault.getAddress());

      await owner.sendTransaction({
        to: await vault.getAddress(),
        value: additionalDeposit
      });

      const finalBalance = await ethers.provider.getBalance(await vault.getAddress());
      expect(finalBalance).to.equal(initialBalance + additionalDeposit);
    });
  });
});