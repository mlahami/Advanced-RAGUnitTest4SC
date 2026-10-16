# baltpayments-subscription-registry--jxlabsok

- domain: subscriptions-streaming (subscription)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/JXLabsOK/BALT_SmartContracts @ 8ba2baf185ac8e0c6df0a1c19df73494d98084b3
- license: MIT
- targets: BALTPaymentsSubscriptionRegistry.sol
- validation: 32 passing tests, 0 failing; statement coverage BALTPaymentsSubscriptionRegistry.sol 100.0 %

## Contract: BALTPaymentsSubscriptionRegistry.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract BALTPaymentsSubscriptionRegistry {
    address public admin;
    address public pendingAdmin;

    mapping(address => uint256) public activeUntil;

    event SubscriptionUpdated(address indexed account, uint256 activeUntil);
    event SubscriptionRenewed(address indexed account, uint256 previousActiveUntil, uint256 newActiveUntil, uint256 duration);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferCancelled(address indexed currentAdmin, address indexed cancelledPendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    constructor() {
        admin = msg.sender;
        emit AdminTransferred(address(0), admin);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin");
        require(newAdmin != admin, "Already admin");

        pendingAdmin = newAdmin;

        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "Only pending admin");

        address previousAdmin = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);

        emit AdminTransferred(previousAdmin, admin);
    }

    function cancelAdminTransfer() external onlyAdmin {
        address cancelledPendingAdmin = pendingAdmin;
        require(cancelledPendingAdmin != address(0), "No pending admin");

        pendingAdmin = address(0);

        emit AdminTransferCancelled(admin, cancelledPendingAdmin);
    }

    function setSubscription(address account, uint256 expirationTimestamp) external onlyAdmin {
        require(account != address(0), "Invalid account");
        require(expirationTimestamp > block.timestamp, "Invalid expiration");

        activeUntil[account] = expirationTimestamp;

        emit SubscriptionUpdated(account, expirationTimestamp);
    }

    function renewSubscription(address account, uint256 duration) external onlyAdmin {
        require(account != address(0), "Invalid account");
        require(duration > 0, "Invalid duration");

        uint256 previousActiveUntil = activeUntil[account];

        uint256 baseTime = previousActiveUntil > block.timestamp
            ? previousActiveUntil
            : block.timestamp;

        uint256 newActiveUntil = baseTime + duration;

        activeUntil[account] = newActiveUntil;

        emit SubscriptionRenewed(account, previousActiveUntil, newActiveUntil, duration);
        emit SubscriptionUpdated(account, newActiveUntil);
    }

    function deactivateSubscription(address account) external onlyAdmin {
        require(account != address(0), "Invalid account");

        activeUntil[account] = 0;

        emit SubscriptionUpdated(account, 0);
    }

    function isActive(address account) external view returns (bool) {
        return account != address(0) && block.timestamp <= activeUntil[account];
    }
}
```

## Tests: BALTPaymentsSubscriptionRegistry.test.js

```javascript
// test/BALTPaymentsSubscriptionRegistry.test.js
const { expect } = require("chai");
const hre = require("hardhat");

const { ethers } = hre;

describe("BALTPaymentsSubscriptionRegistry", function () {
  let admin, newAdmin, account, other;
  let registry;

  const DAY = 60 * 60 * 24;
  const MONTH = DAY * 30;
  const QUARTER = DAY * 90;

  async function getLatestTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return BigInt(block.timestamp);
  }

  async function getFutureTimestamp(secondsFromNow) {
    const now = await getLatestTimestamp();
    return now + BigInt(secondsFromNow);
  }

  async function mineAndIncreaseTime(seconds) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine");
  }

  beforeEach(async () => {
    [admin, newAdmin, account, other] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("BALTPaymentsSubscriptionRegistry");
    registry = await Registry.connect(admin).deploy();
    await registry.waitForDeployment();
  });

  // ---------------- Deployment ----------------

  it("should set deployer as admin", async function () {
    expect(await registry.admin()).to.equal(admin.address);
  });

  it("should start with no pending admin", async function () {
    expect(await registry.pendingAdmin()).to.equal(ethers.ZeroAddress);
  });

  // ---------------- setSubscription ----------------

  it("should allow admin to set a subscription expiration", async function () {
    const expiration = await getFutureTimestamp(MONTH);

    const tx = await registry
      .connect(admin)
      .setSubscription(account.address, expiration);

    await expect(tx)
      .to.emit(registry, "SubscriptionUpdated")
      .withArgs(account.address, expiration);

    expect(await registry.activeUntil(account.address)).to.equal(expiration);
  });

  it("should mark account as active before expiration", async function () {
    const expiration = await getFutureTimestamp(MONTH);

    await registry
      .connect(admin)
      .setSubscription(account.address, expiration);

    expect(await registry.isActive(account.address)).to.equal(true);
  });

  it("should mark account as inactive after expiration", async function () {
    const expiration = await getFutureTimestamp(DAY);

    await registry
      .connect(admin)
      .setSubscription(account.address, expiration);

    expect(await registry.isActive(account.address)).to.equal(true);

    await mineAndIncreaseTime(DAY + 1);

    expect(await registry.isActive(account.address)).to.equal(false);
  });

  it("should revert when non-admin tries to set subscription", async function () {
    const expiration = await getFutureTimestamp(MONTH);

    await expect(
      registry
        .connect(other)
        .setSubscription(account.address, expiration)
    ).to.be.revertedWith("Only admin");
  });

  it("should revert when setting subscription for zero address", async function () {
    const expiration = await getFutureTimestamp(MONTH);

    await expect(
      registry
        .connect(admin)
        .setSubscription(ethers.ZeroAddress, expiration)
    ).to.be.revertedWith("Invalid account");
  });

  it("should revert when setting an expiration in the past", async function () {
    const now = await getLatestTimestamp();
    const pastExpiration = now - 1n;

    await expect(
      registry
        .connect(admin)
        .setSubscription(account.address, pastExpiration)
    ).to.be.revertedWith("Invalid expiration");
  });

  it("should revert when setting an expiration equal to current timestamp", async function () {
    const now = await getLatestTimestamp();

    await expect(
      registry
        .connect(admin)
        .setSubscription(account.address, now)
    ).to.be.revertedWith("Invalid expiration");
  });

  // ---------------- renewSubscription ----------------

  it("should renew an inactive subscription from current timestamp", async function () {
    const before = await getLatestTimestamp();

    const tx = await registry
      .connect(admin)
      .renewSubscription(account.address, MONTH);

    const after = await getLatestTimestamp();
    const activeUntil = await registry.activeUntil(account.address);

    expect(activeUntil).to.be.greaterThanOrEqual(before + BigInt(MONTH));
    expect(activeUntil).to.be.lessThanOrEqual(after + BigInt(MONTH));

    await expect(tx).to.emit(registry, "SubscriptionRenewed");
    await expect(tx).to.emit(registry, "SubscriptionUpdated");

    expect(await registry.isActive(account.address)).to.equal(true);
  });

  it("should extend an active subscription from previous activeUntil", async function () {
    const expiration = await getFutureTimestamp(MONTH);

    await registry
      .connect(admin)
      .setSubscription(account.address, expiration);

    await registry
      .connect(admin)
      .renewSubscription(account.address, MONTH);

    const newExpiration = await registry.activeUntil(account.address);

    expect(newExpiration).to.equal(expiration + BigInt(MONTH));
  });

  it("should renew multiple months correctly", async function () {
    await registry
      .connect(admin)
      .renewSubscription(account.address, MONTH);

    const firstExpiration = await registry.activeUntil(account.address);

    await registry
      .connect(admin)
      .renewSubscription(account.address, QUARTER);

    const secondExpiration = await registry.activeUntil(account.address);

    expect(secondExpiration).to.equal(firstExpiration + BigInt(QUARTER));
  });

  it("should renew from current timestamp if previous subscription expired", async function () {
    const expiration = await getFutureTimestamp(DAY);

    await registry
      .connect(admin)
      .setSubscription(account.address, expiration);

    await mineAndIncreaseTime(DAY + 10);

    const beforeRenew = await getLatestTimestamp();

    await registry
      .connect(admin)
      .renewSubscription(account.address, MONTH);

    const afterRenew = await getLatestTimestamp();
    const newExpiration = await registry.activeUntil(account.address);

    expect(newExpiration).to.be.greaterThanOrEqual(beforeRenew + BigInt(MONTH));
    expect(newExpiration).to.be.lessThanOrEqual(afterRenew + BigInt(MONTH));
  });

  it("should revert when non-admin tries to renew subscription", async function () {
    await expect(
      registry
        .connect(other)
        .renewSubscription(account.address, MONTH)
    ).to.be.revertedWith("Only admin");
  });

  it("should revert when renewing zero address", async function () {
    await expect(
      registry
        .connect(admin)
        .renewSubscription(ethers.ZeroAddress, MONTH)
    ).to.be.revertedWith("Invalid account");
  });

  it("should revert when renewing with zero duration", async function () {
    await expect(
      registry
        .connect(admin)
        .renewSubscription(account.address, 0)
    ).to.be.revertedWith("Invalid duration");
  });

  // ---------------- deactivateSubscription ----------------

  it("should allow admin to deactivate subscription", async function () {
    const expiration = await getFutureTimestamp(MONTH);

    await registry
      .connect(admin)
      .setSubscription(account.address, expiration);

    expect(await registry.isActive(account.address)).to.equal(true);

    const tx = await registry
      .connect(admin)
      .deactivateSubscription(account.address);

    await expect(tx)
      .to.emit(registry, "SubscriptionUpdated")
      .withArgs(account.address, 0);

    expect(await registry.activeUntil(account.address)).to.equal(0);
    expect(await registry.isActive(account.address)).to.equal(false);
  });

  it("should revert when non-admin tries to deactivate subscription", async function () {
    await expect(
      registry
        .connect(other)
        .deactivateSubscription(account.address)
    ).to.be.revertedWith("Only admin");
  });

  it("should revert when deactivating zero address", async function () {
    await expect(
      registry
        .connect(admin)
        .deactivateSubscription(ethers.ZeroAddress)
    ).to.be.revertedWith("Invalid account");
  });

  // ---------------- two-step admin transfer ----------------

  it("should start admin transfer by setting pendingAdmin", async function () {
    const tx = await registry
      .connect(admin)
      .transferAdmin(newAdmin.address);

    await expect(tx)
      .to.emit(registry, "AdminTransferStarted")
      .withArgs(admin.address, newAdmin.address);

    expect(await registry.admin()).to.equal(admin.address);
    expect(await registry.pendingAdmin()).to.equal(newAdmin.address);
  });

  it("should allow pending admin to accept admin role", async function () {
    await registry
      .connect(admin)
      .transferAdmin(newAdmin.address);

    const tx = await registry
      .connect(newAdmin)
      .acceptAdmin();

    await expect(tx)
      .to.emit(registry, "AdminTransferred")
      .withArgs(admin.address, newAdmin.address);

    expect(await registry.admin()).to.equal(newAdmin.address);
    expect(await registry.pendingAdmin()).to.equal(ethers.ZeroAddress);
  });

  it("should allow new admin to manage subscriptions after accepting", async function () {
    await registry
      .connect(admin)
      .transferAdmin(newAdmin.address);

    await registry
      .connect(newAdmin)
      .acceptAdmin();

    await registry
      .connect(newAdmin)
      .renewSubscription(account.address, MONTH);

    expect(await registry.isActive(account.address)).to.equal(true);
  });

  it("should prevent old admin from managing subscriptions after transfer", async function () {
    await registry
      .connect(admin)
      .transferAdmin(newAdmin.address);

    await registry
      .connect(newAdmin)
      .acceptAdmin();

    await expect(
      registry
        .connect(admin)
        .renewSubscription(account.address, MONTH)
    ).to.be.revertedWith("Only admin");
  });

  it("should revert when non-admin tries to start admin transfer", async function () {
    await expect(
      registry
        .connect(other)
        .transferAdmin(newAdmin.address)
    ).to.be.revertedWith("Only admin");
  });

  it("should revert when transferring admin to zero address", async function () {
    await expect(
      registry
        .connect(admin)
        .transferAdmin(ethers.ZeroAddress)
    ).to.be.revertedWith("Invalid admin");
  });

  it("should revert when transferring admin to current admin", async function () {
    await expect(
      registry
        .connect(admin)
        .transferAdmin(admin.address)
    ).to.be.revertedWith("Already admin");
  });

  it("should revert when non-pending admin tries to accept admin role", async function () {
    await registry
      .connect(admin)
      .transferAdmin(newAdmin.address);

    await expect(
      registry
        .connect(other)
        .acceptAdmin()
    ).to.be.revertedWith("Only pending admin");
  });

  it("should allow admin to cancel pending admin transfer", async function () {
    await registry
      .connect(admin)
      .transferAdmin(newAdmin.address);

    const tx = await registry
      .connect(admin)
      .cancelAdminTransfer();

    await expect(tx)
      .to.emit(registry, "AdminTransferCancelled")
      .withArgs(admin.address, newAdmin.address);

    expect(await registry.admin()).to.equal(admin.address);
    expect(await registry.pendingAdmin()).to.equal(ethers.ZeroAddress);
  });

  it("should revert when cancelling admin transfer without pending admin", async function () {
    await expect(
      registry
        .connect(admin)
        .cancelAdminTransfer()
    ).to.be.revertedWith("No pending admin");
  });

  it("should revert when non-admin tries to cancel admin transfer", async function () {
    await registry
      .connect(admin)
      .transferAdmin(newAdmin.address);

    await expect(
      registry
        .connect(other)
        .cancelAdminTransfer()
    ).to.be.revertedWith("Only admin");
  });

  // ---------------- isActive edge cases ----------------

  it("should return false for zero address", async function () {
    expect(await registry.isActive(ethers.ZeroAddress)).to.equal(false);
  });

  it("should return false for an account without subscription", async function () {
    expect(await registry.isActive(account.address)).to.equal(false);
  });
});
```
