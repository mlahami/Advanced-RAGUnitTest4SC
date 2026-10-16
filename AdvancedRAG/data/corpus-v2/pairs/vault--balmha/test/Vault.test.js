const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Vault", () => {
  async function deployVaultFixture() {
    const [owner, alice, bob] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();
    return { vault, owner, alice, bob };
  }

  describe("deposit", () => {
    it("increases the caller's vault balance", async () => {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      const amount = ethers.parseEther("1.5");

      await vault.connect(alice).deposit({ value: amount });

      expect(await vault.balanceOf(alice.address)).to.equal(amount);
      expect(await vault.totalDeposited()).to.equal(amount);
    });

    it("accumulates across multiple deposits", async () => {
      const { vault, alice } = await loadFixture(deployVaultFixture);

      await vault.connect(alice).deposit({ value: ethers.parseEther("1") });
      await vault.connect(alice).deposit({ value: ethers.parseEther("2") });

      expect(await vault.balanceOf(alice.address)).to.equal(
        ethers.parseEther("3")
      );
    });

    it("tracks balances independently per address", async () => {
      const { vault, alice, bob } = await loadFixture(deployVaultFixture);

      await vault.connect(alice).deposit({ value: ethers.parseEther("1") });
      await vault.connect(bob).deposit({ value: ethers.parseEther("4") });

      expect(await vault.balanceOf(alice.address)).to.equal(
        ethers.parseEther("1")
      );
      expect(await vault.balanceOf(bob.address)).to.equal(
        ethers.parseEther("4")
      );
      expect(await vault.totalDeposited()).to.equal(ethers.parseEther("5"));
    });

    it("emits a Deposit event", async () => {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      const amount = ethers.parseEther("1");

      await expect(vault.connect(alice).deposit({ value: amount }))
        .to.emit(vault, "Deposit")
        .withArgs(alice.address, amount, amount);
    });

    it("reverts on a zero-value deposit", async () => {
      const { vault, alice } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(alice).deposit({ value: 0 })
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("moves ETH from the depositor into the contract", async () => {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      const amount = ethers.parseEther("2");

      await expect(
        vault.connect(alice).deposit({ value: amount })
      ).to.changeEtherBalances([alice, vault], [-amount, amount]);
    });
  });

  describe("withdraw", () => {
    it("reduces the vault balance and transfers funds back", async () => {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      await vault.connect(alice).deposit({ value: ethers.parseEther("3") });

      const withdrawAmount = ethers.parseEther("1");

      await expect(
        vault.connect(alice).withdraw(withdrawAmount)
      ).to.changeEtherBalances(
        [alice, vault],
        [withdrawAmount, -withdrawAmount]
      );

      expect(await vault.balanceOf(alice.address)).to.equal(
        ethers.parseEther("2")
      );
      expect(await vault.totalDeposited()).to.equal(ethers.parseEther("2"));
    });

    it("emits a Withdraw event", async () => {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      await vault.connect(alice).deposit({ value: ethers.parseEther("2") });

      await expect(vault.connect(alice).withdraw(ethers.parseEther("0.5")))
        .to.emit(vault, "Withdraw")
        .withArgs(alice.address, ethers.parseEther("0.5"), ethers.parseEther("1.5"));
    });

    it("reverts when withdrawing more than deposited", async () => {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      await vault.connect(alice).deposit({ value: ethers.parseEther("1") });

      await expect(
        vault.connect(alice).withdraw(ethers.parseEther("2"))
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });

    it("reverts when a user with no deposit tries to withdraw", async () => {
      const { vault, bob } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(bob).withdraw(ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });

    it("reverts on a zero-value withdrawal", async () => {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      await vault.connect(alice).deposit({ value: ethers.parseEther("1") });

      await expect(
        vault.connect(alice).withdraw(0)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("prevents one user from withdrawing another user's funds", async () => {
      const { vault, alice, bob } = await loadFixture(deployVaultFixture);
      await vault.connect(alice).deposit({ value: ethers.parseEther("5") });

      // Bob has no balance of his own and cannot reach Alice's funds.
      await expect(
        vault.connect(bob).withdraw(ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");

      expect(await vault.balanceOf(alice.address)).to.equal(
        ethers.parseEther("5")
      );
    });
  });

  describe("withdrawAll", () => {
    it("withdraws the full balance and zeroes it out", async () => {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      const amount = ethers.parseEther("2.5");
      await vault.connect(alice).deposit({ value: amount });

      await expect(
        vault.connect(alice).withdrawAll()
      ).to.changeEtherBalances([alice, vault], [amount, -amount]);

      expect(await vault.balanceOf(alice.address)).to.equal(0n);
      expect(await vault.totalDeposited()).to.equal(0n);
    });

    it("reverts when there is nothing to withdraw", async () => {
      const { vault, bob } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(bob).withdrawAll()
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });
  });
});
