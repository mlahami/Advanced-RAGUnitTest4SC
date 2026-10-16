# baltpayment-vault--jxlabsok

- domain: staking-yield (yield-vault)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/JXLabsOK/BALT_SmartContracts @ 8ba2baf185ac8e0c6df0a1c19df73494d98084b3
- license: MIT
- targets: BALTPaymentVault.sol, BALTPaymentsSubscriptionRegistry.sol, MockERC20.sol
- validation: 58 passing tests, 0 failing; statement coverage BALTPaymentVault.sol 100.0 %, BALTPaymentsSubscriptionRegistry.sol 33.33 %, MockERC20.sol 100.0 %

## Contract: BALTPaymentsSubscriptionRegistry.sol (dependency)

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

## Contract: BALTPaymentVault.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Minimal ERC-20 interface
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface IBALTPaymentsSubscriptionValidator {
    function isActive(address account) external view returns (bool);
}

contract BALTPaymentVault {
    address immutable public payer;
    address immutable public paymentToken;
    address immutable public subscriptionRegistry;

    uint256 public totalPaymentAmount;
    uint256 public totalClaimed;
    uint256 public totalRecovered;
    uint256 public lastCheckIn;
    uint256 immutable public inactivityPeriod;
    uint256 public createdAt;
    uint256 public paymentId;
    uint256 public recipientCount;
    uint256 public claimedCount;

    uint256 public constant MAX_RECIPIENTS = 100;
    uint256 public constant CLAIM_WINDOW = 90 days;

    enum Status { Idle, Active, Released, Cancelled, Closed }
    Status public paymentStatus;

    address[] private recipients;

    mapping(uint256 => mapping(address => uint256)) public amountDue;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event PaymentRegistered(
        address indexed payer,
        uint256 indexed paymentId,
        address indexed paymentToken,
        uint256 totalAmount,
        uint256 recipientCount,
        uint256 inactivityPeriod
    );

    event CheckInPerformed(address indexed payer, uint256 indexed paymentId, uint256 timestamp);
    event PaymentClaimed(address indexed recipient, uint256 indexed paymentId, uint256 amount);
    event PaymentReleased(uint256 indexed paymentId, uint256 totalAmount);
    event PaymentCancelled(address indexed payer, uint256 indexed paymentId, uint256 refundedAmount);
    event PaymentClosed(address indexed payer, uint256 indexed paymentId, uint256 recoveredAmount);
    event ExcessTokenRecovered(address indexed token, address indexed to, uint256 amount);

    receive() external payable {
        revert("Native token not accepted");
    }

    modifier onlyPayer() {
        require(msg.sender == payer, "Only payer");
        _;
    }

    constructor(
        address _payer,
        address _paymentToken,
        uint256 _inactivityPeriod,
        address _subscriptionRegistry
    ) {
        require(_payer != address(0), "Invalid payer");
        require(_paymentToken != address(0), "Invalid payment token");
        require(_subscriptionRegistry != address(0), "Invalid subscription registry");
        require(_paymentToken.code.length > 0, "Payment token must be contract");
        require(_subscriptionRegistry.code.length > 0, "Subscription registry must be contract");
        require(_inactivityPeriod > 0, "Invalid inactivity period");

        payer = _payer;
        paymentToken = _paymentToken;
        subscriptionRegistry = _subscriptionRegistry;
        inactivityPeriod = _inactivityPeriod;

        lastCheckIn = block.timestamp;
        createdAt = block.timestamp;
        paymentStatus = Status.Idle;
    }

    function registerPayment(
        uint256 _totalAmount,
        address[] calldata _recipients,
        uint256[] calldata _amounts
    ) external onlyPayer {
        require(
            IBALTPaymentsSubscriptionValidator(subscriptionRegistry).isActive(payer),
            "Subscription inactive"
        );

        require(
            paymentStatus == Status.Idle ||
            paymentStatus == Status.Released ||
            paymentStatus == Status.Cancelled ||
            paymentStatus == Status.Closed,
            "Payment already active"
        );

        require(_totalAmount > 0, "Invalid total amount");
        require(_recipients.length > 0, "No recipients");
        require(_recipients.length == _amounts.length, "Length mismatch");
        require(_recipients.length <= MAX_RECIPIENTS, "Too many recipients");

        uint256 newPaymentId = paymentId + 1;
        uint256 sum = 0;

        delete recipients;

        for (uint256 i = 0; i < _recipients.length; i++) {
            address recipient = _recipients[i];
            uint256 amount = _amounts[i];

            require(recipient != address(0), "Invalid recipient");
            require(amount > 0, "Invalid recipient amount");
            require(amountDue[newPaymentId][recipient] == 0, "Duplicate recipient");

            amountDue[newPaymentId][recipient] = amount;
            recipients.push(recipient);

            sum += amount;
        }

        require(sum == _totalAmount, "Amounts must match total");

        paymentId = newPaymentId;
        totalPaymentAmount = _totalAmount;
        totalClaimed = 0;
        totalRecovered = 0;
        recipientCount = _recipients.length;
        claimedCount = 0;
        lastCheckIn = block.timestamp;
        paymentStatus = Status.Active;

        uint256 balanceBefore = IERC20(paymentToken).balanceOf(address(this));

        require(
            IERC20(paymentToken).transferFrom(payer, address(this), _totalAmount),
            "Payment transfer failed"
        );

        uint256 balanceAfter = IERC20(paymentToken).balanceOf(address(this));
        require(balanceAfter - balanceBefore == _totalAmount, "Invalid received amount");

        emit PaymentRegistered(
            payer,
            paymentId,
            paymentToken,
            totalPaymentAmount,
            recipientCount,
            inactivityPeriod
        );
    }

    function performCheckIn() external onlyPayer {
        require(
            IBALTPaymentsSubscriptionValidator(subscriptionRegistry).isActive(payer),
            "Subscription inactive"
        );

        require(paymentStatus == Status.Active, "Payment is not active");
        require(block.timestamp < claimableAt(), "Payment already claimable");

        lastCheckIn = block.timestamp;

        emit CheckInPerformed(payer, paymentId, lastCheckIn);
    }

    function claimPayment() external {
        require(paymentStatus == Status.Active, "Payment is not active");
        require(block.timestamp >= claimableAt(), "Payment is not claimable yet");
        require(block.timestamp < claimExpiresAt(), "Claim window expired");

        uint256 amount = amountDue[paymentId][msg.sender];

        require(amount > 0, "No payment assigned");
        require(!hasClaimed[paymentId][msg.sender], "Payment already claimed");

        hasClaimed[paymentId][msg.sender] = true;
        totalClaimed += amount;
        claimedCount += 1;

        require(
            IERC20(paymentToken).transfer(msg.sender, amount),
            "Payment claim failed"
        );

        emit PaymentClaimed(msg.sender, paymentId, amount);

        if (claimedCount == recipientCount) {
            paymentStatus = Status.Released;
            emit PaymentReleased(paymentId, totalPaymentAmount);
        }
    }

    function cancelPayment() external onlyPayer {
        require(paymentStatus == Status.Active, "Payment is not active");
        require(block.timestamp < claimableAt(), "Payment already claimable");

        paymentStatus = Status.Cancelled;

        uint256 pending = _pendingAmount();
        totalRecovered += pending;

        require(
            IERC20(paymentToken).transfer(payer, pending),
            "Refund failed"
        );

        emit PaymentCancelled(payer, paymentId, pending);
    }

    function closeExpiredPayment() external onlyPayer {
        require(paymentStatus == Status.Active, "Payment is not active");
        require(block.timestamp >= claimExpiresAt(), "Claim window not expired");

        paymentStatus = Status.Closed;

        uint256 pending = _pendingAmount();
        totalRecovered += pending;

        if (pending > 0) {
            require(
                IERC20(paymentToken).transfer(payer, pending),
                "Recovery failed"
            );
        }

        emit PaymentClosed(payer, paymentId, pending);
    }

    function recoverExcessToken(address token, uint256 amount) external onlyPayer {
        require(token != address(0), "Invalid token");
        require(token.code.length > 0, "Token must be contract");
        require(amount > 0, "Invalid amount");

        if (token == paymentToken && paymentStatus == Status.Active) {
            uint256 vaultBalance = IERC20(paymentToken).balanceOf(address(this));
            uint256 pending = _pendingAmount();

            require(vaultBalance > pending, "No excess token");
            require(amount <= vaultBalance - pending, "Amount exceeds excess");
        }

        require(
            IERC20(token).transfer(payer, amount),
            "Token recovery failed"
        );

        emit ExcessTokenRecovered(token, payer, amount);
    }

    function getRecipients()
        external
        view
        returns (
            address[] memory recipientAddresses,
            uint256[] memory recipientAmounts,
            bool[] memory claimed
        )
    {
        uint256 count = recipients.length;

        recipientAddresses = new address[](count);
        recipientAmounts = new uint256[](count);
        claimed = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            address recipient = recipients[i];

            recipientAddresses[i] = recipient;
            recipientAmounts[i] = amountDue[paymentId][recipient];
            claimed[i] = hasClaimed[paymentId][recipient];
        }
    }

    function getPaymentDetails()
        external
        view
        returns (
            address,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            Status
        )
    {
        return (
            paymentToken,
            paymentId,
            totalPaymentAmount,
            totalClaimed,
            lastCheckIn,
            createdAt,
            recipientCount,
            claimedCount,
            paymentStatus
        );
    }

    function claimableAt() public view returns (uint256) {
        return lastCheckIn + inactivityPeriod;
    }

    function claimExpiresAt() public view returns (uint256) {
        return claimableAt() + CLAIM_WINDOW;
    }

    function isClaimable() external view returns (bool) {
        return paymentStatus == Status.Active
            && block.timestamp >= claimableAt()
            && block.timestamp < claimExpiresAt();
    }

    function isClaimExpired() external view returns (bool) {
        return paymentStatus == Status.Active
            && block.timestamp >= claimExpiresAt();
    }

    function getAmountDue(address account) external view returns (uint256) {
        return amountDue[paymentId][account];
    }

    function hasRecipientClaimed(address account) external view returns (bool) {
        return hasClaimed[paymentId][account];
    }

    function pendingAmount() external view returns (uint256) {
        return _pendingAmount();
    }

    function getRecipientsCount() external view returns (uint256) {
        return recipients.length;
    }

    function _pendingAmount() internal view returns (uint256) {
        return totalPaymentAmount - totalClaimed - totalRecovered;
    }
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC20 {
    string public name = "Mock DoC";
    string public symbol = "mDOC";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function transfer(address to, uint256 value) external returns (bool) {
        require(to != address(0), "Invalid to");
        require(balanceOf[msg.sender] >= value, "Insufficient balance");
        unchecked {
            balanceOf[msg.sender] -= value;
            balanceOf[to] += value;
        }
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(to != address(0), "Invalid to");
        require(balanceOf[from] >= value, "Insufficient balance");
        require(allowance[from][msg.sender] >= value, "Insufficient allowance");
        unchecked {
            allowance[from][msg.sender] -= value;
            balanceOf[from] -= value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }
}
```

## Tests: BALTPaymentVault.test.js

```javascript
// test/BALTPaymentVault.test.js
const { expect } = require("chai");
const hre = require("hardhat");

const { ethers } = hre;
const parseUnits = ethers.parseUnits;

describe("BALTPaymentVault", function () {
  let admin, payer, recipient1, recipient2, recipient3, other;
  let registry, token, otherToken, vault;

  const shortInactivity = 60; // 60 seconds for fast tests
  const subscriptionDuration = 60 * 60 * 24 * 30; // 30 days

  const amount1 = parseUnits("100", 18);
  const amount2 = parseUnits("250", 18);
  const amount3 = parseUnits("50", 18);
  const totalAmount = amount1 + amount2;

  async function mineAndIncreaseTime(seconds) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine");
  }

  async function getFutureTimestamp(secondsFromNow) {
    const block = await ethers.provider.getBlock("latest");
    return BigInt(block.timestamp) + BigInt(secondsFromNow);
  }

  async function activateSubscription(account) {
    const expiration = await getFutureTimestamp(subscriptionDuration);

    await (
      await registry
        .connect(admin)
        .setSubscription(account.address, expiration)
    ).wait();
  }

  async function deployVault(customToken = token.target, customRegistry = registry.target, period = shortInactivity) {
    const Vault = await ethers.getContractFactory("BALTPaymentVault");

    const deployedVault = await Vault
      .connect(payer)
      .deploy(
        payer.address,
        customToken,
        period,
        customRegistry
      );

    await deployedVault.waitForDeployment();

    return deployedVault;
  }

  async function approveAndRegisterPayment(
    recipients = [recipient1.address, recipient2.address],
    amounts = [amount1, amount2],
    total = totalAmount
  ) {
    await (
      await token
        .connect(payer)
        .approve(vault.target, total)
    ).wait();

    return vault
      .connect(payer)
      .registerPayment(total, recipients, amounts);
  }

  beforeEach(async () => {
    [admin, payer, recipient1, recipient2, recipient3, other] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("BALTPaymentsSubscriptionRegistry");
    registry = await Registry.connect(admin).deploy();
    await registry.waitForDeployment();

    const MockERC20 = await ethers.getContractFactory("MockERC20");

    token = await MockERC20.connect(admin).deploy();
    await token.waitForDeployment();

    otherToken = await MockERC20.connect(admin).deploy();
    await otherToken.waitForDeployment();

    await activateSubscription(payer);

    await (
      await token
        .connect(admin)
        .mint(payer.address, parseUnits("100000", 18))
    ).wait();

    await (
      await otherToken
        .connect(admin)
        .mint(payer.address, parseUnits("100000", 18))
    ).wait();

    vault = await deployVault();
  });

  // ---------------- Deployment ----------------

  it("should deploy with the expected constructor values", async function () {
    expect(await vault.payer()).to.equal(payer.address);
    expect(await vault.paymentToken()).to.equal(token.target);
    expect(await vault.subscriptionRegistry()).to.equal(registry.target);
    expect(await vault.inactivityPeriod()).to.equal(shortInactivity);
    expect(await vault.paymentStatus()).to.equal(0); // Status.Idle
    expect(await vault.paymentId()).to.equal(0);
  });

  it("should revert if deployed with zero payer", async function () {
    const Vault = await ethers.getContractFactory("BALTPaymentVault");

    await expect(
      Vault
        .connect(payer)
        .deploy(
          ethers.ZeroAddress,
          token.target,
          shortInactivity,
          registry.target
        )
    ).to.be.revertedWith("Invalid payer");
  });

  it("should revert if deployed with zero payment token", async function () {
    const Vault = await ethers.getContractFactory("BALTPaymentVault");

    await expect(
      Vault
        .connect(payer)
        .deploy(
          payer.address,
          ethers.ZeroAddress,
          shortInactivity,
          registry.target
        )
    ).to.be.revertedWith("Invalid payment token");
  });

  it("should revert if deployed with zero subscription registry", async function () {
    const Vault = await ethers.getContractFactory("BALTPaymentVault");

    await expect(
      Vault
        .connect(payer)
        .deploy(
          payer.address,
          token.target,
          shortInactivity,
          ethers.ZeroAddress
        )
    ).to.be.revertedWith("Invalid subscription registry");
  });

  it("should revert if payment token is not a contract", async function () {
    const Vault = await ethers.getContractFactory("BALTPaymentVault");

    await expect(
      Vault
        .connect(payer)
        .deploy(
          payer.address,
          other.address,
          shortInactivity,
          registry.target
        )
    ).to.be.revertedWith("Payment token must be contract");
  });

  it("should revert if subscription registry is not a contract", async function () {
    const Vault = await ethers.getContractFactory("BALTPaymentVault");

    await expect(
      Vault
        .connect(payer)
        .deploy(
          payer.address,
          token.target,
          shortInactivity,
          other.address
        )
    ).to.be.revertedWith("Subscription registry must be contract");
  });

  it("should revert if inactivity period is zero", async function () {
    const Vault = await ethers.getContractFactory("BALTPaymentVault");

    await expect(
      Vault
        .connect(payer)
        .deploy(
          payer.address,
          token.target,
          0,
          registry.target
        )
    ).to.be.revertedWith("Invalid inactivity period");
  });

  it("should reject native token transfers", async function () {
    await expect(
      payer.sendTransaction({
        to: vault.target,
        value: parseUnits("1", 18),
      })
    ).to.be.revertedWith("Native token not accepted");
  });

  // ---------------- registerPayment ----------------

  it("should register a payment and pull the exact ERC-20 amount", async function () {
    const payerBefore = await token.balanceOf(payer.address);
    const vaultBefore = await token.balanceOf(vault.target);

    const tx = await approveAndRegisterPayment();

    await expect(tx).to.emit(vault, "PaymentRegistered");

    const payerAfter = await token.balanceOf(payer.address);
    const vaultAfter = await token.balanceOf(vault.target);

    expect(payerBefore - payerAfter).to.equal(totalAmount);
    expect(vaultAfter - vaultBefore).to.equal(totalAmount);

    expect(await vault.paymentId()).to.equal(1);
    expect(await vault.totalPaymentAmount()).to.equal(totalAmount);
    expect(await vault.totalClaimed()).to.equal(0);
    expect(await vault.recipientCount()).to.equal(2);
    expect(await vault.claimedCount()).to.equal(0);
    expect(await vault.paymentStatus()).to.equal(1); // Status.Active
  });

  it("should store recipients, amounts, and claimed status", async function () {
    await (await approveAndRegisterPayment()).wait();

    const [recipients, amounts, claimed] = await vault.getRecipients();

    expect(recipients.length).to.equal(2);
    expect(recipients[0]).to.equal(recipient1.address);
    expect(recipients[1]).to.equal(recipient2.address);

    expect(amounts[0]).to.equal(amount1);
    expect(amounts[1]).to.equal(amount2);

    expect(claimed[0]).to.equal(false);
    expect(claimed[1]).to.equal(false);
  });

  it("should revert if non-payer tries to register a payment", async function () {
    await expect(
      vault
        .connect(other)
        .registerPayment(totalAmount, [recipient1.address, recipient2.address], [amount1, amount2])
    ).to.be.revertedWith("Only payer");
  });

  it("should revert if payer subscription is inactive", async function () {
    await (
      await registry
        .connect(admin)
        .deactivateSubscription(payer.address)
    ).wait();

    await (
      await token
        .connect(payer)
        .approve(vault.target, totalAmount)
    ).wait();

    await expect(
      vault
        .connect(payer)
        .registerPayment(totalAmount, [recipient1.address, recipient2.address], [amount1, amount2])
    ).to.be.revertedWith("Subscription inactive");
  });

  it("should revert if total amount is zero", async function () {
    await expect(
      vault
        .connect(payer)
        .registerPayment(0, [recipient1.address], [amount1])
    ).to.be.revertedWith("Invalid total amount");
  });

  it("should revert if recipients list is empty", async function () {
    await expect(
      vault
        .connect(payer)
        .registerPayment(totalAmount, [], [])
    ).to.be.revertedWith("No recipients");
  });

  it("should revert on recipients and amounts length mismatch", async function () {
    await expect(
      vault
        .connect(payer)
        .registerPayment(totalAmount, [recipient1.address, recipient2.address], [amount1])
    ).to.be.revertedWith("Length mismatch");
  });

  it("should revert if there are too many recipients", async function () {
    const recipients = [];
    const amounts = [];

    for (let i = 0; i < 101; i++) {
      recipients.push(ethers.Wallet.createRandom().address);
      amounts.push(1n);
    }

    await expect(
      vault
        .connect(payer)
        .registerPayment(101n, recipients, amounts)
    ).to.be.revertedWith("Too many recipients");
  });

  it("should revert if recipient is zero address", async function () {
    await expect(
      vault
        .connect(payer)
        .registerPayment(amount1, [ethers.ZeroAddress], [amount1])
    ).to.be.revertedWith("Invalid recipient");
  });

  it("should revert if recipient amount is zero", async function () {
    await expect(
      vault
        .connect(payer)
        .registerPayment(amount1, [recipient1.address], [0])
    ).to.be.revertedWith("Invalid recipient amount");
  });

  it("should revert on duplicate recipient", async function () {
    await expect(
      vault
        .connect(payer)
        .registerPayment(totalAmount, [recipient1.address, recipient1.address], [amount1, amount2])
    ).to.be.revertedWith("Duplicate recipient");
  });

  it("should revert if recipient amounts do not match total", async function () {
    await expect(
      vault
        .connect(payer)
        .registerPayment(totalAmount, [recipient1.address, recipient2.address], [amount1, amount3])
    ).to.be.revertedWith("Amounts must match total");
  });

  it("should revert if allowance is insufficient", async function () {
    await expect(
      vault
        .connect(payer)
        .registerPayment(totalAmount, [recipient1.address, recipient2.address], [amount1, amount2])
    ).to.be.revertedWith("Insufficient allowance");
  });

  it("should revert if trying to register another payment while active", async function () {
    await (await approveAndRegisterPayment()).wait();

    await (
      await token
        .connect(payer)
        .approve(vault.target, totalAmount)
    ).wait();

    await expect(
      vault
        .connect(payer)
        .registerPayment(totalAmount, [recipient1.address, recipient2.address], [amount1, amount2])
    ).to.be.revertedWith("Payment already active");
  });

  // ---------------- performCheckIn ----------------

  it("should allow payer to perform check-in before payment is claimable", async function () {
    await (await approveAndRegisterPayment()).wait();

    const previousLastCheckIn = await vault.lastCheckIn();

    await mineAndIncreaseTime(5);

    const tx = await vault
      .connect(payer)
      .performCheckIn();

    await expect(tx).to.emit(vault, "CheckInPerformed");

    const newLastCheckIn = await vault.lastCheckIn();
    expect(newLastCheckIn).to.be.greaterThan(previousLastCheckIn);
  });

  it("should revert if non-payer tries to perform check-in", async function () {
    await (await approveAndRegisterPayment()).wait();

    await expect(
      vault
        .connect(other)
        .performCheckIn()
    ).to.be.revertedWith("Only payer");
  });

  it("should revert check-in if payment is not active", async function () {
    await expect(
      vault
        .connect(payer)
        .performCheckIn()
    ).to.be.revertedWith("Payment is not active");
  });

  it("should revert check-in if subscription is inactive", async function () {
    await (await approveAndRegisterPayment()).wait();

    await (
      await registry
        .connect(admin)
        .deactivateSubscription(payer.address)
    ).wait();

    await expect(
      vault
        .connect(payer)
        .performCheckIn()
    ).to.be.revertedWith("Subscription inactive");
  });

  it("should revert check-in after payment becomes claimable", async function () {
    await (await approveAndRegisterPayment()).wait();

    await mineAndIncreaseTime(shortInactivity + 1);

    await expect(
      vault
        .connect(payer)
        .performCheckIn()
    ).to.be.revertedWith("Payment already claimable");
  });

  // ---------------- claimPayment ----------------

  it("should report claimableAt and isClaimable correctly", async function () {
    await (await approveAndRegisterPayment()).wait();

    expect(await vault.isClaimable()).to.equal(false);

    const claimableAt = await vault.claimableAt();
    const block = await ethers.provider.getBlock("latest");

    expect(claimableAt).to.be.greaterThan(block.timestamp);

    await mineAndIncreaseTime(shortInactivity + 1);

    expect(await vault.isClaimable()).to.equal(true);
  });

  it("should revert claim before claimableAt", async function () {
    await (await approveAndRegisterPayment()).wait();

    await expect(
      vault
        .connect(recipient1)
        .claimPayment()
    ).to.be.revertedWith("Payment is not claimable yet");
  });

  it("should revert claim from non-recipient", async function () {
    await (await approveAndRegisterPayment()).wait();

    await mineAndIncreaseTime(shortInactivity + 1);

    await expect(
      vault
        .connect(other)
        .claimPayment()
    ).to.be.revertedWith("No payment assigned");
  });

  it("should allow recipient to claim assigned amount", async function () {
    await (await approveAndRegisterPayment()).wait();

    await mineAndIncreaseTime(shortInactivity + 1);

    const before = await token.balanceOf(recipient1.address);

    const tx = await vault
      .connect(recipient1)
      .claimPayment();

    await expect(tx)
      .to.emit(vault, "PaymentClaimed")
      .withArgs(recipient1.address, 1, amount1);

    const after = await token.balanceOf(recipient1.address);

    expect(after - before).to.equal(amount1);
    expect(await vault.totalClaimed()).to.equal(amount1);
    expect(await vault.claimedCount()).to.equal(1);
    expect(await vault.hasRecipientClaimed(recipient1.address)).to.equal(true);
    expect(await vault.paymentStatus()).to.equal(1); // Status.Active
  });

  it("should prevent double claim", async function () {
    await (await approveAndRegisterPayment()).wait();

    await mineAndIncreaseTime(shortInactivity + 1);

    await (
      await vault
        .connect(recipient1)
        .claimPayment()
    ).wait();

    await expect(
      vault
        .connect(recipient1)
        .claimPayment()
    ).to.be.revertedWith("Payment already claimed");
  });

  it("should set status to Released when all recipients claim", async function () {
    await (await approveAndRegisterPayment()).wait();

    await mineAndIncreaseTime(shortInactivity + 1);

    await (
      await vault
        .connect(recipient1)
        .claimPayment()
    ).wait();

    const tx = await vault
      .connect(recipient2)
      .claimPayment();

    await expect(tx)
      .to.emit(vault, "PaymentReleased")
      .withArgs(1, totalAmount);

    expect(await vault.totalClaimed()).to.equal(totalAmount);
    expect(await vault.claimedCount()).to.equal(2);
    expect(await vault.paymentStatus()).to.equal(2); // Status.Released
    expect(await token.balanceOf(vault.target)).to.equal(0);
  });

  it("should revert claim after claim window expired", async function () {
    await (await approveAndRegisterPayment()).wait();

    const claimWindow = await vault.CLAIM_WINDOW();

    await mineAndIncreaseTime(shortInactivity + Number(claimWindow) + 1);

    expect(await vault.isClaimExpired()).to.equal(true);

    await expect(
      vault
        .connect(recipient1)
        .claimPayment()
    ).to.be.revertedWith("Claim window expired");
  });

  // ---------------- cancelPayment ----------------

  it("should allow payer to cancel before payment is claimable", async function () {
    await (await approveAndRegisterPayment()).wait();

    const payerBefore = await token.balanceOf(payer.address);

    const tx = await vault
      .connect(payer)
      .cancelPayment();

    await expect(tx)
      .to.emit(vault, "PaymentCancelled")
      .withArgs(payer.address, 1, totalAmount);

    const payerAfter = await token.balanceOf(payer.address);

    expect(payerAfter - payerBefore).to.equal(totalAmount);
    expect(await vault.paymentStatus()).to.equal(3); // Status.Cancelled
    expect(await token.balanceOf(vault.target)).to.equal(0);
  });

  it("should revert cancel from non-payer", async function () {
    await (await approveAndRegisterPayment()).wait();

    await expect(
      vault
        .connect(other)
        .cancelPayment()
    ).to.be.revertedWith("Only payer");
  });

  it("should revert cancel after payment is claimable", async function () {
    await (await approveAndRegisterPayment()).wait();

    await mineAndIncreaseTime(shortInactivity + 1);

    await expect(
      vault
        .connect(payer)
        .cancelPayment()
    ).to.be.revertedWith("Payment already claimable");
  });

  // ---------------- closeExpiredPayment ----------------

  it("should revert closeExpiredPayment before claim window expires", async function () {
    await (await approveAndRegisterPayment()).wait();

    await mineAndIncreaseTime(shortInactivity + 1);

    await expect(
      vault
        .connect(payer)
        .closeExpiredPayment()
    ).to.be.revertedWith("Claim window not expired");
  });

  it("should allow payer to close expired payment and recover all unclaimed funds", async function () {
    await (await approveAndRegisterPayment()).wait();

    const claimWindow = await vault.CLAIM_WINDOW();

    await mineAndIncreaseTime(shortInactivity + Number(claimWindow) + 1);

    const payerBefore = await token.balanceOf(payer.address);

    const tx = await vault
      .connect(payer)
      .closeExpiredPayment();

    await expect(tx)
      .to.emit(vault, "PaymentClosed")
      .withArgs(payer.address, 1, totalAmount);

    const payerAfter = await token.balanceOf(payer.address);

    expect(payerAfter - payerBefore).to.equal(totalAmount);
    expect(await vault.paymentStatus()).to.equal(4); // Status.Closed
    expect(await token.balanceOf(vault.target)).to.equal(0);
  });

  it("should close expired payment and recover only unclaimed funds after partial claims", async function () {
    await (await approveAndRegisterPayment()).wait();

    await mineAndIncreaseTime(shortInactivity + 1);

    await (
      await vault
        .connect(recipient1)
        .claimPayment()
    ).wait();

    const claimWindow = await vault.CLAIM_WINDOW();

    await mineAndIncreaseTime(Number(claimWindow) + 1);

    const payerBefore = await token.balanceOf(payer.address);

    const tx = await vault
      .connect(payer)
      .closeExpiredPayment();

    await expect(tx)
      .to.emit(vault, "PaymentClosed")
      .withArgs(payer.address, 1, amount2);

    const payerAfter = await token.balanceOf(payer.address);

    expect(payerAfter - payerBefore).to.equal(amount2);
    expect(await vault.totalClaimed()).to.equal(amount1);
    expect(await vault.paymentStatus()).to.equal(4); // Status.Closed
    expect(await token.balanceOf(vault.target)).to.equal(0);
  });

  it("should revert closeExpiredPayment from non-payer", async function () {
    await (await approveAndRegisterPayment()).wait();

    const claimWindow = await vault.CLAIM_WINDOW();

    await mineAndIncreaseTime(shortInactivity + Number(claimWindow) + 1);

    await expect(
      vault
        .connect(other)
        .closeExpiredPayment()
    ).to.be.revertedWith("Only payer");
  });

  // ---------------- Vault reuse ----------------

  it("should allow vault reuse after Released", async function () {
    await (await approveAndRegisterPayment()).wait();

    await mineAndIncreaseTime(shortInactivity + 1);

    await (
      await vault
        .connect(recipient1)
        .claimPayment()
    ).wait();

    await (
      await vault
        .connect(recipient2)
        .claimPayment()
    ).wait();

    expect(await vault.paymentStatus()).to.equal(2); // Status.Released

    await (
      await token
        .connect(payer)
        .approve(vault.target, amount3)
    ).wait();

    await (
      await vault
        .connect(payer)
        .registerPayment(amount3, [recipient3.address], [amount3])
    ).wait();

    expect(await vault.paymentId()).to.equal(2);
    expect(await vault.paymentStatus()).to.equal(1); // Status.Active
    expect(await vault.totalPaymentAmount()).to.equal(amount3);
    expect(await vault.recipientCount()).to.equal(1);

    const [recipients, amounts, claimed] = await vault.getRecipients();

    expect(recipients.length).to.equal(1);
    expect(recipients[0]).to.equal(recipient3.address);
    expect(amounts[0]).to.equal(amount3);
    expect(claimed[0]).to.equal(false);
  });

  it("should allow vault reuse after Cancelled", async function () {
    await (await approveAndRegisterPayment()).wait();
    await (await vault.connect(payer).cancelPayment()).wait();

    expect(await vault.paymentStatus()).to.equal(3); // Status.Cancelled

    await (
      await token
        .connect(payer)
        .approve(vault.target, amount3)
    ).wait();

    await (
      await vault
        .connect(payer)
        .registerPayment(amount3, [recipient3.address], [amount3])
    ).wait();

    expect(await vault.paymentId()).to.equal(2);
    expect(await vault.paymentStatus()).to.equal(1); // Status.Active
  });

  it("should allow vault reuse after Closed", async function () {
    await (await approveAndRegisterPayment()).wait();

    const claimWindow = await vault.CLAIM_WINDOW();

    await mineAndIncreaseTime(shortInactivity + Number(claimWindow) + 1);

    await (
        await vault
        .connect(payer)
        .closeExpiredPayment()
    ).wait();

    expect(await vault.paymentStatus()).to.equal(4); // Status.Closed

    // The subscription expired during the claim window, so it must be renewed before starting a new payment.
    await activateSubscription(payer);

    await (
        await token
        .connect(payer)
        .approve(vault.target, amount3)
    ).wait();

    await (
        await vault
        .connect(payer)
        .registerPayment(amount3, [recipient3.address], [amount3])
    ).wait();

    expect(await vault.paymentId()).to.equal(2);
    expect(await vault.paymentStatus()).to.equal(1); // Status.Active
  });

  it("should revert vault reuse after Closed if subscription is inactive", async function () {
    await (await approveAndRegisterPayment()).wait();

    const claimWindow = await vault.CLAIM_WINDOW();

    await mineAndIncreaseTime(shortInactivity + Number(claimWindow) + 1);

    await (
        await vault
        .connect(payer)
        .closeExpiredPayment()
    ).wait();

    expect(await vault.paymentStatus()).to.equal(4); // Status.Closed

    await (
        await token
        .connect(payer)
        .approve(vault.target, amount3)
    ).wait();

    await expect(
        vault
        .connect(payer)
        .registerPayment(amount3, [recipient3.address], [amount3])
    ).to.be.revertedWith("Subscription inactive");
  });
  
  // ---------------- recoverExcessToken ----------------

  it("should recover excess payment token without touching pending funds", async function () {
    await (await approveAndRegisterPayment()).wait();

    const excess = parseUnits("10", 18);

    await (
      await token
        .connect(admin)
        .mint(vault.target, excess)
    ).wait();

    const payerBefore = await token.balanceOf(payer.address);

    const tx = await vault
      .connect(payer)
      .recoverExcessToken(token.target, excess);

    await expect(tx)
      .to.emit(vault, "ExcessTokenRecovered")
      .withArgs(token.target, payer.address, excess);

    const payerAfter = await token.balanceOf(payer.address);

    expect(payerAfter - payerBefore).to.equal(excess);
    expect(await token.balanceOf(vault.target)).to.equal(totalAmount);
  });

  it("should revert when trying to recover pending payment token funds", async function () {
    await (await approveAndRegisterPayment()).wait();

    await expect(
      vault
        .connect(payer)
        .recoverExcessToken(token.target, amount1)
    ).to.be.revertedWith("No excess token");
  });

  it("should revert when trying to recover more than excess payment token", async function () {
    await (await approveAndRegisterPayment()).wait();

    const excess = parseUnits("10", 18);

    await (
      await token
        .connect(admin)
        .mint(vault.target, excess)
    ).wait();

    await expect(
      vault
        .connect(payer)
        .recoverExcessToken(token.target, excess + 1n)
    ).to.be.revertedWith("Amount exceeds excess");
  });

  it("should recover unrelated ERC-20 tokens sent by mistake", async function () {
    const mistakenAmount = parseUnits("25", 18);

    await (
      await otherToken
        .connect(admin)
        .mint(vault.target, mistakenAmount)
    ).wait();

    const payerBefore = await otherToken.balanceOf(payer.address);

    await (
      await vault
        .connect(payer)
        .recoverExcessToken(otherToken.target, mistakenAmount)
    ).wait();

    const payerAfter = await otherToken.balanceOf(payer.address);

    expect(payerAfter - payerBefore).to.equal(mistakenAmount);
    expect(await otherToken.balanceOf(vault.target)).to.equal(0);
  });

  it("should revert recoverExcessToken from non-payer", async function () {
    const mistakenAmount = parseUnits("25", 18);

    await (
      await otherToken
        .connect(admin)
        .mint(vault.target, mistakenAmount)
    ).wait();

    await expect(
      vault
        .connect(other)
        .recoverExcessToken(otherToken.target, mistakenAmount)
    ).to.be.revertedWith("Only payer");
  });

  it("should revert recoverExcessToken with zero token address", async function () {
    await expect(
      vault
        .connect(payer)
        .recoverExcessToken(ethers.ZeroAddress, amount1)
    ).to.be.revertedWith("Invalid token");
  });

  it("should revert recoverExcessToken when token is not a contract", async function () {
    await expect(
      vault
        .connect(payer)
        .recoverExcessToken(other.address, amount1)
    ).to.be.revertedWith("Token must be contract");
  });

  it("should revert recoverExcessToken with zero amount", async function () {
    await expect(
      vault
        .connect(payer)
        .recoverExcessToken(token.target, 0)
    ).to.be.revertedWith("Invalid amount");
  });

  // ---------------- View helpers ----------------

  it("should return payment details", async function () {
    await (await approveAndRegisterPayment()).wait();

    const details = await vault.getPaymentDetails();

    expect(details[0]).to.equal(token.target); // paymentToken
    expect(details[1]).to.equal(1); // paymentId
    expect(details[2]).to.equal(totalAmount); // totalPaymentAmount
    expect(details[3]).to.equal(0); // totalClaimed
    expect(details[6]).to.equal(2); // recipientCount
    expect(details[7]).to.equal(0); // claimedCount
    expect(details[8]).to.equal(1); // Status.Active
  });

  it("should return amount due for current payment", async function () {
    await (await approveAndRegisterPayment()).wait();

    expect(await vault.getAmountDue(recipient1.address)).to.equal(amount1);
    expect(await vault.getAmountDue(recipient2.address)).to.equal(amount2);
    expect(await vault.getAmountDue(other.address)).to.equal(0);
  });

  it("should return pending amount", async function () {
    await (await approveAndRegisterPayment()).wait();

    expect(await vault.pendingAmount()).to.equal(totalAmount);

    await mineAndIncreaseTime(shortInactivity + 1);

    await (
      await vault
        .connect(recipient1)
        .claimPayment()
    ).wait();

    expect(await vault.pendingAmount()).to.equal(amount2);
  });

  it("should return recipients count", async function () {
    await (await approveAndRegisterPayment()).wait();

    expect(await vault.getRecipientsCount()).to.equal(2);
  });

  it("should return claim expiration timestamp", async function () {
    await (await approveAndRegisterPayment()).wait();

    const claimableAt = await vault.claimableAt();
    const claimExpiresAt = await vault.claimExpiresAt();
    const claimWindow = await vault.CLAIM_WINDOW();

    expect(claimExpiresAt).to.equal(claimableAt + claimWindow);
  });
});
```
