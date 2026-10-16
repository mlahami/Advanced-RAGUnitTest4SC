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
