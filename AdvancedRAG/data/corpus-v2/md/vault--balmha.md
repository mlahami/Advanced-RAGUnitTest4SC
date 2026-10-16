# vault--balmha

- domain: staking-yield (yield-vault)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/balmha/Vaultis @ d70236256bf929687729d95fa559439038fcae4d
- license: MIT
- targets: Vault.sol
- validation: 14 passing tests, 0 failing; statement coverage Vault.sol 93.75 %

## Contract: Vault.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Vault
/// @notice A minimal, secure ETH vault. Each address can deposit ETH into the
///         vault and later withdraw up to the amount it has deposited. Balances
///         are tracked per-address; users can never touch another user's funds.
/// @dev Demonstrates the checks-effects-interactions pattern together with
///      OpenZeppelin's ReentrancyGuard. This is a local/testnet portfolio demo,
///      not audited production code.
contract Vault is ReentrancyGuard {
    /// @notice ETH balance held in the vault for each account (in wei).
    mapping(address => uint256) private _balances;

    /// @notice Total ETH held by the vault across all accounts (in wei).
    uint256 public totalDeposited;

    /// @notice Emitted when `account` deposits `amount` wei into the vault.
    event Deposit(address indexed account, uint256 amount, uint256 newBalance);

    /// @notice Emitted when `account` withdraws `amount` wei from the vault.
    event Withdraw(address indexed account, uint256 amount, uint256 newBalance);

    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);
    error TransferFailed();

    /// @notice Deposit ETH into the caller's vault balance.
    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();

        // Effects
        _balances[msg.sender] += msg.value;
        totalDeposited += msg.value;

        emit Deposit(msg.sender, msg.value, _balances[msg.sender]);
    }

    /// @notice Withdraw `amount` wei from the caller's vault balance.
    /// @param amount The amount of wei to withdraw. Must be > 0 and <= balance.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 balance = _balances[msg.sender];
        if (amount > balance) revert InsufficientBalance(amount, balance);

        // Effects (state updated before the external call)
        uint256 newBalance = balance - amount;
        _balances[msg.sender] = newBalance;
        totalDeposited -= amount;

        emit Withdraw(msg.sender, amount, newBalance);

        // Interaction (last)
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Withdraw the caller's entire vault balance.
    function withdrawAll() external nonReentrant {
        uint256 balance = _balances[msg.sender];
        if (balance == 0) revert ZeroAmount();

        // Effects
        _balances[msg.sender] = 0;
        totalDeposited -= balance;

        emit Withdraw(msg.sender, balance, 0);

        // Interaction
        (bool ok, ) = payable(msg.sender).call{value: balance}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Return the vault balance for `account`.
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /// @notice Convenience accessor for the caller's own balance.
    function myBalance() external view returns (uint256) {
        return _balances[msg.sender];
    }
}
```

## Tests: Vault.test.js

```javascript
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
```
