const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SecureVault — Secure Vault (Normal Behavior)", function () {
  let secureVault;
  let owner, alice, bob;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    const SecureVault = await ethers.getContractFactory("SecureVault");
    secureVault = await SecureVault.deploy();
    await secureVault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should deploy with zero balance", async function () {
      expect(await secureVault.getContractBalance()).to.equal(0n);
    });
  });

  describe("deposit()", function () {
    it("should accept ETH and record user balance", async function () {
      await secureVault.connect(alice).deposit({ value: ethers.parseEther("1") });
      expect(await secureVault.balances(alice.address)).to.equal(ethers.parseEther("1"));
    });

    it("should emit Deposited event", async function () {
      await expect(secureVault.connect(alice).deposit({ value: ethers.parseEther("1") }))
        .to.emit(secureVault, "Deposited")
        .withArgs(alice.address, ethers.parseEther("1"));
    });

    it("should revert on zero deposit", async function () {
      await expect(
        secureVault.connect(alice).deposit({ value: 0 })
      ).to.be.revertedWith("SecureVault: deposit must be > 0");
    });
  });

  describe("withdraw()", function () {
    beforeEach(async function () {
      await secureVault.connect(alice).deposit({ value: ethers.parseEther("2") });
      await secureVault.connect(bob).deposit({ value: ethers.parseEther("3") });
    });

    it("should return ETH to depositor", async function () {
      const before = await ethers.provider.getBalance(alice.address);
      const tx = await secureVault.connect(alice).withdraw();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * tx.gasPrice;
      const after = await ethers.provider.getBalance(alice.address);
      expect(after).to.be.closeTo(before + ethers.parseEther("2") - gasCost, ethers.parseEther("0.001"));
    });

    it("should zero out balance after withdrawal", async function () {
      await secureVault.connect(alice).withdraw();
      expect(await secureVault.balances(alice.address)).to.equal(0n);
    });

    it("should emit Withdrawn event", async function () {
      await expect(secureVault.connect(alice).withdraw())
        .to.emit(secureVault, "Withdrawn")
        .withArgs(alice.address, ethers.parseEther("2"));
    });

    it("should revert if nothing to withdraw", async function () {
      await expect(
        secureVault.connect(owner).withdraw()
      ).to.be.revertedWith("SecureVault: nothing to withdraw");
    });

    it("should not affect other users balances", async function () {
      await secureVault.connect(alice).withdraw();
      expect(await secureVault.balances(bob.address)).to.equal(ethers.parseEther("3"));
    });
  });
});