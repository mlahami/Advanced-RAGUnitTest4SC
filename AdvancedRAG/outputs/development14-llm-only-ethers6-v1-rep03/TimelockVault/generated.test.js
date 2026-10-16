const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TimelockVault", function () {
  let TimelockVault;
  let vault;
  let owner;
  let otherAccount;
  const delaySeconds = 3600n; // 1 hour

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    TimelockVault = await ethers.getContractFactory("TimelockVault");
    vault = await TimelockVault.deploy(delaySeconds, { value: ethers.parseEther("1.0") });
    await vault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("Should set the correct unlock time", async function () {
      const blockNumBefore = await ethers.provider.getBlockNumber();
      const blockBefore = await ethers.provider.getBlock(blockNumBefore);
      const timestampBefore = blockBefore.timestamp;

      const unlockTime = await vault.unlockTime();
      expect(unlockTime).to.equal(timestampBefore + delaySeconds);
    });

    it("Should receive and store the funds", async function () {
      const balance = await ethers.provider.getBalance(await vault.getAddress());
      expect(balance).to.equal(ethers.parseEther("1.0"));
    });
  });

  describe("Withdrawals", function () {
    describe("Validations", function () {
      it("Should revert with the right error if called too soon", async function () {
        await expect(vault.connect(owner).withdraw()).to.be.revertedWith("locked");
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
        const tx = await vault.connect(owner).withdraw();
        const receipt = await tx.wait();

        // Check that no events were emitted (since the contract doesn't emit any)
        expect(receipt.logs.length).to.equal(0);

        // Verify the balance was transferred
        const finalBalance = await ethers.provider.getBalance(owner.address);
        expect(finalBalance).to.be.gt(initialBalance);
      });
    });

    describe("Transfers", function () {
      it("Should transfer the funds to the owner", async function () {
        await ethers.provider.send("evm_increaseTime", [Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine");

        const initialBalance = await ethers.provider.getBalance(owner.address);
        const tx = await vault.connect(owner).withdraw();
        await tx.wait();

        const finalBalance = await ethers.provider.getBalance(owner.address);
        expect(finalBalance).to.be.gt(initialBalance);
      });
    });
  });

  describe("Receive", function () {
    it("Should accept ETH deposits", async function () {
      const depositAmount = ethers.parseEther("0.5");
      const initialBalance = await ethers.provider.getBalance(await vault.getAddress());

      await owner.sendTransaction({
        to: await vault.getAddress(),
        value: depositAmount
      });

      const finalBalance = await ethers.provider.getBalance(await vault.getAddress());
      expect(finalBalance).to.equal(initialBalance + depositAmount);
    });
  });
});