# secure-vault--abhishekabhang314

- domain: staking-yield (yield-vault)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/abhishekabhang314/reentrancy-lab @ 8729113155ff4ee6382ee21a29d303f74dd1f1fd
- license: MIT
- targets: SecureVault.sol, IVault.sol
- validation: 9 passing tests, 0 failing; statement coverage SecureVault.sol 100.0 %, IVault.sol 100.0 %

## Contract: IVault.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IVault — Common interface for all vault implementations in this lab
interface IVault {
    /// @notice Deposit ETH into the vault
    function deposit() external payable;

    /// @notice Withdraw the caller's full balance from the vault
    function withdraw() external;

    /// @notice Return the ETH balance locked in the vault contract
    function getContractBalance() external view returns (uint256);

    /// @notice Return the recorded balance for a specific depositor
    function balances(address user) external view returns (uint256);

    // Events
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
}
```

## Contract: SecureVault.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IVault.sol";

contract SecureVault is IVault, ReentrancyGuard {
    mapping(address => uint256) public override balances;

    function deposit() external payable override {
        require(msg.value > 0, "SecureVault: deposit must be > 0");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw() external override nonReentrant {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "SecureVault: nothing to withdraw");

        balances[msg.sender] = 0;

        // slither-disable-next-line low-level-calls
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "SecureVault: ETH transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    function getContractBalance() external view override returns (uint256) {
        return address(this).balance;
    }
}
```

## Tests: SecureVault.test.js

```javascript
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
```
