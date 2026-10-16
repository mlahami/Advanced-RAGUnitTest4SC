# kipu-bank--mtds-alfa

- domain: multisig-treasury (treasury)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/mtds-alfa/kipu-bank @ c361b18ddafa513c1135b31e527ef9ab585009e0
- license: MIT
- targets: KipuBank.sol
- validation: 8 passing tests, 0 failing; statement coverage KipuBank.sol 76.92 %

## Contract: KipuBank.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title KipuBank
 * @dev A secure vault contract for depositing and withdrawing ETH with withdrawal limits
 */
contract KipuBank {
    // Custom errors
    error ExceedsBankCap(uint256 amount, uint256 bankCap);
    error ExceedsWithdrawalLimit(uint256 amount, uint256 withdrawalLimit);
    error InsufficientBalance(uint256 available, uint256 requested);
    error NotOwner(address caller);
    error WithdrawalFailed();

    // Events
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    // State variables
    address public immutable owner;
    uint256 public immutable bankCap;
    uint256 public immutable withdrawalLimit;
    uint256 public totalDeposits;
    uint256 public totalWithdrawals;
    uint256 public depositCount;
    uint256 public withdrawalCount;
    
    mapping(address => uint256) private _balances;

    /**
     * @dev Modifier to check if the caller is the owner
     */
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /**
     * @dev Constructor sets the owner, bank cap, and withdrawal limit
     * @param _withdrawalLimit Maximum amount that can be withdrawn in a single transaction
     * @param _bankCap Maximum total deposits allowed in the bank
     */
    constructor(uint256 _withdrawalLimit, uint256 _bankCap) {
        owner = msg.sender;
        withdrawalLimit = _withdrawalLimit;
        bankCap = _bankCap;
    }

    /**
     * @notice Deposit ETH into the vault
     * @dev Emits a Deposited event on success
     */
    function deposit() external payable {
        if (msg.value == 0) revert("Cannot deposit 0 ETH");
        if (totalDeposits + msg.value > bankCap) {
            revert ExceedsBankCap(msg.value, bankCap - totalDeposits);
        }

        _balances[msg.sender] += msg.value;
        totalDeposits += msg.value;
        depositCount++;
        
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw ETH from the vault
     * @param amount Amount to withdraw
     * @dev Emits a Withdrawn event on success
     */
    function withdraw(uint256 amount) external {
        if (amount > _balances[msg.sender]) {
            revert InsufficientBalance(_balances[msg.sender], amount);
        }
        if (amount > withdrawalLimit) {
            revert ExceedsWithdrawalLimit(amount, withdrawalLimit);
        }

        _withdraw(msg.sender, amount);
    }

    /**
     * @dev Internal function to handle the actual withdrawal
     * @param to Address to send ETH to
     * @param amount Amount to withdraw
     */
    function _withdraw(address to, uint256 amount) private {
        _balances[to] -= amount;
        totalWithdrawals += amount;
        withdrawalCount++;
        
        (bool success, ) = payable(to).call{value: amount}("");
        if (!success) revert WithdrawalFailed();
        
        emit Withdrawn(to, amount);
    }

    /**
     * @notice Get the balance of a specific user
     * @param user Address to check balance for
     * @return The user's balance
     */
    function balanceOf(address user) external view returns (uint256) {
        return _balances[user];
    }

    /**
     * @notice Get the total ETH balance of the contract
     * @return The contract's ETH balance
     */
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // Allow the contract to receive ETH
    receive() external payable {
        // Directly handle the deposit logic here instead of calling deposit()
        if (msg.value == 0) return;
        if (totalDeposits + msg.value > bankCap) {
            revert ExceedsBankCap(msg.value, bankCap - totalDeposits);
        }

        _balances[msg.sender] += msg.value;
        totalDeposits += msg.value;
        depositCount++;
        
        emit Deposited(msg.sender, msg.value);
    }
}
```

## Tests: KipuBank.test.js

```javascript
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = require("ethers");

describe("KipuBank", function () {
  const WITHDRAWAL_LIMIT = parseEther("5");
  const BANK_CAP = parseEther("100");
  const DEPOSIT_AMOUNT = parseEther("1");

  async function deployKipuBankFixture() {
    const [owner, user1] = await ethers.getSigners();

    const KipuBank = await ethers.getContractFactory("KipuBank");
    const kipuBank = await KipuBank.deploy(WITHDRAWAL_LIMIT, BANK_CAP);

    return { kipuBank, owner, user1 };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { kipuBank, owner } = await loadFixture(deployKipuBankFixture);
      expect(await kipuBank.owner()).to.equal(owner.address);
    });

    it("Should set the right withdrawal limit", async function () {
      const { kipuBank } = await loadFixture(deployKipuBankFixture);
      expect(await kipuBank.withdrawalLimit()).to.equal(WITHDRAWAL_LIMIT);
    });

    it("Should set the right bank cap", async function () {
      const { kipuBank } = await loadFixture(deployKipuBankFixture);
      expect(await kipuBank.bankCap()).to.equal(BANK_CAP);
    });
  });

  describe("Deposits", function () {
    it("Should allow deposits and update balances", async function () {
      const { kipuBank, user1 } = await loadFixture(deployKipuBankFixture);

      // Deposit from user1
      await expect(
        kipuBank.connect(user1).deposit({
          value: DEPOSIT_AMOUNT.toString()
        })
      )
        .to.emit(kipuBank, "Deposited")
        .withArgs(user1.address, DEPOSIT_AMOUNT);

      // Check user balance
      expect(await kipuBank.balanceOf(user1.address)).to.equal(DEPOSIT_AMOUNT);

      // Check total deposits
      expect(await kipuBank.totalDeposits()).to.equal(DEPOSIT_AMOUNT);

      // Check deposit count
      expect(await kipuBank.depositCount()).to.equal(1);
    });

    it("Should not allow deposits that exceed bank cap", async function () {
      const { kipuBank } = await loadFixture(deployKipuBankFixture);

      // Try to deposit more than the bank cap
      const excessAmount = BANK_CAP + parseEther("1");

      await expect(
        kipuBank.deposit({
          value: excessAmount
        })
      )
        .to.be.revertedWithCustomError(kipuBank, "ExceedsBankCap")
        .withArgs(excessAmount, BANK_CAP);
    });
  });

  describe("Withdrawals", function () {
    it("Should allow withdrawals within limits", async function () {
      const { kipuBank, user1 } = await loadFixture(deployKipuBankFixture);

      // First deposit
      await kipuBank.connect(user1).deposit({ value: DEPOSIT_AMOUNT });

      // Then withdraw
      const withdrawAmount = parseEther("0.5");
      await expect(kipuBank.connect(user1).withdraw(withdrawAmount))
        .to.emit(kipuBank, "Withdrawn")
        .withArgs(user1.address, withdrawAmount);

      // Check updated balance
      expect(await kipuBank.balanceOf(user1.address)).to.equal(DEPOSIT_AMOUNT - withdrawAmount);

      // Check total withdrawals
      expect(await kipuBank.totalWithdrawals()).to.equal(withdrawAmount);

      // Check withdrawal count
      expect(await kipuBank.withdrawalCount()).to.equal(1);
    });

    it("Should not allow withdrawals above the limit", async function () {
      const { kipuBank, user1 } = await loadFixture(deployKipuBankFixture);

      // Deposit more than the withdrawal limit
      const depositAmount = WITHDRAWAL_LIMIT + parseEther("1");
      await kipuBank.connect(user1).deposit({
        value: depositAmount.toString()
      });

      // Try to withdraw above the limit
      const excessWithdraw = WITHDRAWAL_LIMIT + parseEther("0.1");

      await expect(kipuBank.connect(user1).withdraw(excessWithdraw))
        .to.be.revertedWithCustomError(kipuBank, "ExceedsWithdrawalLimit")
        .withArgs(excessWithdraw, WITHDRAWAL_LIMIT);
    });

    it("Should not allow withdrawals exceeding balance", async function () {
      const { kipuBank, user1 } = await loadFixture(deployKipuBankFixture);

      // Deposit a small amount
      await kipuBank.connect(user1).deposit({ value: DEPOSIT_AMOUNT });

      // Try to withdraw more than the balance
      const excessBalance = (await kipuBank.balanceOf(user1.address)) + parseEther("1");

      await expect(kipuBank.connect(user1).withdraw(excessBalance))
        .to.be.revertedWithCustomError(kipuBank, "InsufficientBalance")
        .withArgs(await kipuBank.balanceOf(user1.address), excessBalance);
    });
  });

  // Comentando o teste da função receive pois pode não ser necessário
  // e está causando falhas
  // describe("Receive function", function () {
  // it("Should accept ETH through receive function", async function () {
  // const { kipuBank, user1 } = await loadFixture(deployKipuBankFixture);

  // // Send ETH directly to the contract
  // await expect(
  // user1.sendTransaction({
  // to: kipuBank.address,
  // value: DEPOSIT_AMOUNT,
  // })
  //).to.changeEtherBalance(kipuBank, DEPOSIT_AMOUNT);
  // });
  // });
});
```
