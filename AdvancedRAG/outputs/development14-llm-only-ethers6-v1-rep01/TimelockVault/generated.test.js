const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TimelockVault", function () {
  let vault;
  let owner;
  let otherAccount;
  const delaySeconds = 3600n; // 1 hour

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();

    const Vault = await ethers.getContractFactory("TimelockVault");
    vault = await Vault.deploy(delaySeconds, { value: ethers.parseEther("1.0") });
    await vault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("Should set the right unlock time", async function () {
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
      it("Should revert with the right error if called too early", async function () {
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

        const balanceBefore = await ethers.provider.getBalance(owner.address);
        const tx = await vault.connect(owner).withdraw();
        const receipt = await tx.wait();
        const balanceAfter = await ethers.provider.getBalance(owner.address);

        expect(balanceAfter).to.be.gt(balanceBefore);
        expect(receipt).to.emit(vault, "Withdrawal").withArgs(owner.address, ethers.parseEther("1.0"));
      });
    });

    describe("Transfers", function () {
      it("Should transfer the funds to the owner", async function () {
        await ethers.provider.send("evm_increaseTime", [Number(delaySeconds) + 1]);
        await ethers.provider.send("evm_mine");

        const balanceBefore = await ethers.provider.getBalance(owner.address);
        await vault.connect(owner).withdraw();
        const balanceAfter = await ethers.provider.getBalance(owner.address);

        expect(balanceAfter).to.be.gt(balanceBefore);
      });
    });
  });

  describe("Receive", function () {
    it("Should accept ETH transfers", async function () {
      const amount = ethers.parseEther("0.5");
      const balanceBefore = await ethers.provider.getBalance(await vault.getAddress());

      await owner.sendTransaction({
        to: await vault.getAddress(),
        value: amount
      });

      const balanceAfter = await ethers.provider.getBalance(await vault.getAddress());
      expect(balanceAfter).to.equal(balanceBefore + amount);
    });
  });
});