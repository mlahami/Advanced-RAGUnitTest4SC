# poly-mirror-channel--marcellomaugeri

- domain: escrow-conditional-payments (conditional-payments)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/marcellomaugeri/PolyMirror.AI @ 41dbe2045a1ec69fa7afb33909f70589203b4a7e
- license: MIT
- targets: PolyMirrorChannel.sol, VoucherLib.sol
- validation: 6 passing tests, 0 failing; statement coverage PolyMirrorChannel.sol 95.0 %, VoucherLib.sol 100.0 %

## Contract: PolyMirrorChannel.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "./VoucherLib.sol";

/**
 * @title PolyMirrorChannel
 * @author PolyMirror.AI
 * @notice This contract manages user funds in the native currency (POL) for paying for services.
 * It uses EIP-712 for secure, off-chain voucher signing.
 */
contract PolyMirrorChannel is Ownable, EIP712 {
    /// @notice A mapping to track used nonces for each channel to prevent replay attacks.
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    /// @notice A mapping from a user's address to their POL balance.
    mapping(address => uint256) public channel;

    /// @notice Emitted when a user tops up their channel with POL.
    event ChannelToppedUp(address indexed user, uint256 amount, uint256 newBal);
    /// @notice Emitted when a voucher is successfully redeemed.
    event VoucherRedeemed(address indexed user, uint256 nonce, string model, uint256 inputTokenAmount, uint256 maxOutputTokenAmount, uint256 amountDebited);
    /// @notice Emitted when a user closes their channel.
    event ChannelClosed(address indexed user);

    // The EIP-712 type hash for the Voucher struct.
    bytes32 private constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(address channel,uint256 nonce,uint256 deadline,string model,uint256 inputTokenAmount,uint256 maxOutputTokenAmount)"
    );

    /**
     * @notice Initializes the contract, setting the EIP-712 domain and owner.
     */
    constructor() Ownable(msg.sender) EIP712("PolyMirrorChannel", "1") {}

    /**
     * @notice Tops up the user's channel with a direct payment of POL.
     * The amount of POL sent with the transaction is added to the user's channel.
     */
    function topUpChannel() public payable {
        require(msg.value > 0, "Must send POL to top up");
        channel[msg.sender] += msg.value;
        emit ChannelToppedUp(msg.sender, msg.value, channel[msg.sender]);
    }

    /**
     * @notice Opens a channel for a user. This is an alias for topUpChannel.
     * The amount of POL sent with the transaction is the initial channel balance.
     */
    function openChannel() public payable {
        topUpChannel();
    }

    /**
     * @notice Redeems a signed voucher to debit a user's channel.
     * The debited amount is transferred directly to the contract owner.
     * @param v The voucher containing the payment details.
     * @param amount The actual amount to be debited from the channel.
     * @param sig The EIP-712 signature of the voucher.
     */
    function redeem(Voucher calldata v, uint256 amount, bytes calldata sig) external onlyOwner {
        require(block.timestamp <= v.deadline, "Voucher expired");
        require(!nonceUsed[v.channel][v.nonce], "Nonce used");
        require(channel[v.channel] >= amount, "Insufficient funds");

        bytes32 digest = _hashVoucher(v);
        address signer = ECDSA.recover(digest, sig);
        require(signer == v.channel, "Invalid signature");

        nonceUsed[v.channel][v.nonce] = true;
        channel[v.channel] -= amount;

        // Immediately transfer the POL funds to the contract owner
        (bool sent, ) = owner().call{value: amount}("");
        require(sent, "Failed to send POL to owner");

        emit VoucherRedeemed(v.channel, v.nonce, v.model, v.inputTokenAmount, v.maxOutputTokenAmount, amount);
    }

    /**
     * @notice Calculates the EIP-712 digest for a given voucher.
     * @param v The voucher for which to calculate the hash.
     * @return The EIP-712 digest.
     */
    function _hashVoucher(Voucher calldata v) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            v.channel,
            v.nonce,
            v.deadline,
            keccak256(bytes(v.model)),
            v.inputTokenAmount,
            v.maxOutputTokenAmount
        ));
        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Allows a user to close their channel and withdraw their remaining funds.
     */
    function closeChannel() external {
        uint256 remainingBalance = channel[msg.sender];
        require(remainingBalance > 0, "No balance to withdraw");

        // Reset balance before transfer to prevent re-entrancy attacks
        channel[msg.sender] = 0;

        // Transfer the remaining POL balance to the user
        (bool sent, ) = msg.sender.call{value: remainingBalance}("");
        require(sent, "Failed to send POL to user");

        emit ChannelClosed(msg.sender);
    }

    /**
     * @notice Returns the current balance of the user's channel.
     * @return The balance of the user's channel in POL (wei).
     */
    function getBalance(address user) external view returns (uint256) {
        return channel[user];
    }
}
```

## Contract: VoucherLib.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title Voucher
 * @notice A struct representing a voucher that can be redeemed for a certain amount.
 */
struct Voucher {
    address channel;    // The address of the user's channel (for now, this is the user's address)
    uint256 nonce;      // A unique number to prevent replay attacks (from the channel owner)
    uint256 deadline;   // The timestamp after which the voucher is no longer valid
    string model;       // The name of the chosen model (e.g., "gpt-4o-mini")
    uint256 inputTokenAmount; // The amount of token to be used for the service
    uint256 maxOutputTokenAmount; // The maximum amount of output token that can be received
}
```

## Tests: PolyMirrorChannel.test.js

```javascript
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("PolyMirrorChannel (POL-based)", function () {
  let polyMirrorChannel, owner, user1;

  // Using beforeEach to ensure a clean state for each test
  beforeEach(async function () {
    this.timeout(60000); // Set timeout for setup

    // Get signers
    [owner, user1] = await ethers.getSigners();

    // --- Fund user1 with POL (the native currency) ---
    const amountToFund = ethers.parseEther("100"); // Fund with 100 POL
    await network.provider.send("hardhat_setBalance", [
      user1.address,
      ethers.toBeHex(amountToFund),
    ]);

    // Verify the balance was set correctly
    const user1Balance = await ethers.provider.getBalance(user1.address);
    expect(user1Balance).to.equal(amountToFund);

    // Deploy PolyMirrorChannel contract
    const PolyMirrorChannel = await ethers.getContractFactory("PolyMirrorChannel");
    polyMirrorChannel = await PolyMirrorChannel.deploy();
  });

  it("should handle deposit, voucher redemption, and replay attack prevention", async function () {
    // --- Step 1: User deposits 10 POL into the channel ---
    const depositAmount = ethers.parseEther("10");
    const userBalanceBeforeDeposit = await ethers.provider.getBalance(user1.address);
    const contractBalanceBeforeDeposit = await ethers.provider.getBalance(await polyMirrorChannel.getAddress());

    const depositTx = await polyMirrorChannel.connect(user1).openChannel({ value: depositAmount });
    const depositReceipt = await depositTx.wait();
    const depositGasUsed = depositReceipt.gasUsed * depositReceipt.gasPrice;

    // Assert user's internal channel balance
    const internalChannelBalance = await polyMirrorChannel.channel(user1.address);
    expect(internalChannelBalance).to.equal(depositAmount);

    // Assert user's external wallet balance
    const userBalanceAfterDeposit = await ethers.provider.getBalance(user1.address);
    expect(userBalanceAfterDeposit).to.equal(userBalanceBeforeDeposit - depositAmount - depositGasUsed);

    // Assert contract's POL balance
    const contractBalanceAfterDeposit = await ethers.provider.getBalance(await polyMirrorChannel.getAddress());
    expect(contractBalanceAfterDeposit).to.equal(contractBalanceBeforeDeposit + depositAmount);
    console.log(`Step 1 Passed: Balances correct after deposit.`);

    // --- Step 2: User creates and signs a voucher off-chain ---
    const nonce = 1;
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    const voucher = {
      channel: user1.address,
      nonce,
      deadline,
      model: "gpt-4o-mini",
      inputTokenAmount: ethers.parseEther("5"),
      maxOutputTokenAmount: ethers.parseEther("5"),
    };

    const domain = {
        name: "PolyMirrorChannel",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await polyMirrorChannel.getAddress()
    };

    const types = {
        Voucher: [
            { name: "channel", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "model", type: "string" },
            { name: "inputTokenAmount", type: "uint256" },
            { name: "maxOutputTokenAmount", type: "uint256" },
        ]
    };

    const signature = await user1.signTypedData(domain, types, voucher);
    console.log("Step 2 Passed: Voucher signed.");

    // --- Step 3: Owner redeems the voucher for 2 POL ---
    const redeemAmount = ethers.parseEther("2");
    const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
    const userBalanceBeforeRedeem = await ethers.provider.getBalance(user1.address);
    const contractBalanceBeforeRedeem = await ethers.provider.getBalance(await polyMirrorChannel.getAddress());

    const redeemTx = await polyMirrorChannel.connect(owner).redeem(voucher, redeemAmount, signature);
    const redeemReceipt = await redeemTx.wait();
    const redeemGasUsedByOwner = redeemReceipt.gasUsed * redeemReceipt.gasPrice;

    // Assert user's internal channel balance is updated
    const balanceAfterRedemption = await polyMirrorChannel.channel(user1.address);
    expect(balanceAfterRedemption).to.equal(internalChannelBalance - redeemAmount);

    // Assert owner's external balance increased
    const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
    // Note: Owner pays for gas, so their balance change is `redeemAmount - gas`
    expect(ownerBalanceAfter).to.equal(ownerBalanceBefore - redeemGasUsedByOwner + redeemAmount);

    // Assert user's external balance is unchanged
    const userBalanceAfterRedeem = await ethers.provider.getBalance(user1.address);
    expect(userBalanceAfterRedeem).to.equal(userBalanceBeforeRedeem);

    // Assert contract's POL balance has decreased
    const contractBalanceAfterRedeem = await ethers.provider.getBalance(await polyMirrorChannel.getAddress());
    expect(contractBalanceAfterRedeem).to.equal(contractBalanceBeforeRedeem - redeemAmount);
    console.log(`Step 3 Passed: Balances correct after redemption.`);

    // --- Step 4: Attempt to redeem the same voucher again (replay attack) ---
    await expect(
      polyMirrorChannel.connect(owner).redeem(voucher, redeemAmount, signature)
    ).to.be.revertedWith("Nonce used");
    console.log("Step 4 Passed: Replay attack prevented.");
  });

  it("should allow a user to top up their existing channel", async function () {
    const initialDeposit = ethers.parseEther("5");
    await polyMirrorChannel.connect(user1).openChannel({ value: initialDeposit });

    const topUpAmount = ethers.parseEther("3");
    const userBalanceBeforeTopUp = await ethers.provider.getBalance(user1.address);

    const topUpTx = await polyMirrorChannel.connect(user1).topUpChannel({ value: topUpAmount });
    const topUpReceipt = await topUpTx.wait();
    const topUpGasUsed = topUpReceipt.gasUsed * topUpReceipt.gasPrice;

    const finalInternalBalance = await polyMirrorChannel.channel(user1.address);
    expect(finalInternalBalance).to.equal(initialDeposit + topUpAmount);

    const finalUserBalance = await ethers.provider.getBalance(user1.address);
    expect(finalUserBalance).to.equal(userBalanceBeforeTopUp - topUpAmount - topUpGasUsed);
  });

  it("should allow a user to close their channel and withdraw remaining funds", async function () {
    // --- Setup: User deposits 15 POL and owner redeems 5 POL ---
    const depositAmount = ethers.parseEther("15");
    await polyMirrorChannel.connect(user1).openChannel({ value: depositAmount });

    const redeemAmount = ethers.parseEther("5");
    const nonce = 1;
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const voucher = {
      channel: user1.address,
      nonce,
      deadline,
      model: "test-model",
      inputTokenAmount: redeemAmount,
      maxOutputTokenAmount: redeemAmount,
    };
    const domain = {
        name: "PolyMirrorChannel",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await polyMirrorChannel.getAddress()
    };
    const types = {
        Voucher: [
            { name: "channel", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "model", type: "string" },
            { name: "inputTokenAmount", type: "uint256" },
            { name: "maxOutputTokenAmount", type: "uint256" },
        ]
    };
    const signature = await user1.signTypedData(domain, types, voucher);
    await polyMirrorChannel.connect(owner).redeem(voucher, redeemAmount, signature);

    const remainingInternalBalance = await polyMirrorChannel.channel(user1.address);
    const expectedRemaining = depositAmount - redeemAmount;
    expect(remainingInternalBalance).to.equal(expectedRemaining);

    // --- Action: User closes the channel ---
    const userBalanceBeforeClose = await ethers.provider.getBalance(user1.address);
    const contractBalanceBeforeClose = await ethers.provider.getBalance(await polyMirrorChannel.getAddress());

    const closeTx = await polyMirrorChannel.connect(user1).closeChannel();
    const closeReceipt = await closeTx.wait();
    const closeGasUsed = closeReceipt.gasUsed * closeReceipt.gasPrice;

    // --- Assertions ---
    // Assert user's external wallet balance increased by remaining funds (minus gas)
    const userBalanceAfterClose = await ethers.provider.getBalance(user1.address);
    expect(userBalanceAfterClose).to.equal(userBalanceBeforeClose + remainingInternalBalance - closeGasUsed);

    // Assert contract's POL balance decreased by the withdrawn amount
    const contractBalanceAfterClose = await ethers.provider.getBalance(await polyMirrorChannel.getAddress());
    expect(contractBalanceAfterClose).to.equal(contractBalanceBeforeClose - remainingInternalBalance);

    // Assert user's internal channel balance is now zero
    const finalInternalBalance = await polyMirrorChannel.channel(user1.address);
    expect(finalInternalBalance).to.equal(0);

    console.log("Close Channel Test Passed: Balances are correct after closing.");
  });

  it("should fail to redeem an expired voucher", async function () {
    await polyMirrorChannel.connect(user1).openChannel({ value: ethers.parseEther("10") });

    const expiredDeadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const voucher = {
      channel: user1.address,
      nonce: 1,
      deadline: expiredDeadline,
      model: "test-model",
      inputTokenAmount: 1,
      maxOutputTokenAmount: 1,
    };
    const domain = {
        name: "PolyMirrorChannel",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await polyMirrorChannel.getAddress()
    };
    const types = {
        Voucher: [
            { name: "channel", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "model", type: "string" },
            { name: "inputTokenAmount", type: "uint256" },
            { name: "maxOutputTokenAmount", type: "uint256" },
        ]
    };
    const signature = await user1.signTypedData(domain, types, voucher);

    await expect(
      polyMirrorChannel.connect(owner).redeem(voucher, 1, signature)
    ).to.be.revertedWith("Voucher expired");
  });

  it("should fail to redeem with an invalid signature", async function () {
    const [, , mallory] = await ethers.getSigners(); // A malicious actor
    await polyMirrorChannel.connect(user1).openChannel({ value: ethers.parseEther("10") });

    const voucher = {
      channel: user1.address, // Voucher is for user1
      nonce: 1,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      model: "test-model",
      inputTokenAmount: 1,
      maxOutputTokenAmount: 1,
    };
    const domain = {
        name: "PolyMirrorChannel",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await polyMirrorChannel.getAddress()
    };
    const types = {
        Voucher: [
            { name: "channel", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "model", type: "string" },
            { name: "inputTokenAmount", type: "uint256" },
            { name: "maxOutputTokenAmount", type: "uint256" },
        ]
    };
    // Mallory signs it, not user1
    const signature = await mallory.signTypedData(domain, types, voucher);

    await expect(
      polyMirrorChannel.connect(owner).redeem(voucher, 1, signature)
    ).to.be.revertedWith("Invalid signature");
  });

  it("should fail to redeem for more than the channel balance", async function () {
    const depositAmount = ethers.parseEther("5");
    await polyMirrorChannel.connect(user1).openChannel({ value: depositAmount });

    const redeemAmount = ethers.parseEther("6"); // More than deposited
    const voucher = {
      channel: user1.address,
      nonce: 1,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      model: "test-model",
      inputTokenAmount: redeemAmount,
      maxOutputTokenAmount: redeemAmount,
    };
    const domain = {
        name: "PolyMirrorChannel",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await polyMirrorChannel.getAddress()
    };
    const types = {
        Voucher: [
            { name: "channel", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "model", type: "string" },
            { name: "inputTokenAmount", type: "uint256" },
            { name: "maxOutputTokenAmount", type: "uint256" },
        ]
    };
    const signature = await user1.signTypedData(domain, types, voucher);

    await expect(
      polyMirrorChannel.connect(owner).redeem(voucher, redeemAmount, signature)
    ).to.be.revertedWith("Insufficient funds");
  });
});
```
