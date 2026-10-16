const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EnerpayRemittance", function () {
  let enerpayRemittance;
  let cUSD;
  let owner;
  let treasury;
  let sender;
  let beneficiary;
  let otherAccount;

  // cUSD test token address (Alfajores testnet)
  // For testing, we'll deploy a mock ERC20 token
  const PLATFORM_FEE = 150; // 1.5%
  const INITIAL_BALANCE = ethers.parseEther("10000"); // 10000 tokens

  beforeEach(async function () {
    [owner, treasury, sender, beneficiary, otherAccount] =
      await ethers.getSigners();

    // Deploy mock ERC20 token (cUSD)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    cUSD = await MockERC20.deploy("Celo Dollar", "cUSD", INITIAL_BALANCE);
    await cUSD.waitForDeployment();

    // Deploy EnerpayRemittance
    const EnerpayRemittance = await ethers.getContractFactory(
      "EnerpayRemittance"
    );
    enerpayRemittance = await EnerpayRemittance.deploy(
      await cUSD.getAddress(),
      treasury.address
    );
    await enerpayRemittance.waitForDeployment();

    // Fund sender account
    await cUSD.transfer(sender.address, ethers.parseEther("1000"));
  });

  describe("Deployment", function () {
    it("Should set the right cUSD address", async function () {
      expect(await enerpayRemittance.cUSD()).to.equal(await cUSD.getAddress());
    });

    it("Should set the right treasury address", async function () {
      expect(await enerpayRemittance.treasuryAddress()).to.equal(
        treasury.address
      );
    });

    it("Should set the right platform fee", async function () {
      expect(await enerpayRemittance.platformFee()).to.equal(PLATFORM_FEE);
    });

    it("Should set the right owner", async function () {
      expect(await enerpayRemittance.owner()).to.equal(owner.address);
    });
  });

  describe("sendRemittance", function () {
    const amount = ethers.parseEther("100");
    const destinationType = "wallet";
    const destinationId = "0x1234567890123456789012345678901234567890";

    beforeEach(async function () {
      // Approve contract to spend sender's tokens
      await cUSD
        .connect(sender)
        .approve(await enerpayRemittance.getAddress(), ethers.parseEther("200"));
    });

    it("Should create a remittance and transfer immediately for wallet type", async function () {
      const fee = (amount * BigInt(PLATFORM_FEE)) / BigInt(10000);
      const totalAmount = amount + fee;

      const senderBalanceBefore = await cUSD.balanceOf(sender.address);
      const beneficiaryBalanceBefore = await cUSD.balanceOf(beneficiary.address);
      const treasuryBalanceBefore = await cUSD.balanceOf(treasury.address);

      const tx = await enerpayRemittance
        .connect(sender)
        .sendRemittance(
          beneficiary.address,
          amount,
          destinationType,
          destinationId
        );

      await expect(tx)
        .to.emit(enerpayRemittance, "RemittanceCreated")
        .withArgs(
          0,
          sender.address,
          beneficiary.address,
          amount,
          fee,
          destinationType,
          destinationId
        );

      await expect(tx)
        .to.emit(enerpayRemittance, "RemittanceCompleted")
        .withArgs(0, 1); // RemittanceStatus.Completed = 1

      const senderBalanceAfter = await cUSD.balanceOf(sender.address);
      const beneficiaryBalanceAfter = await cUSD.balanceOf(beneficiary.address);
      const treasuryBalanceAfter = await cUSD.balanceOf(treasury.address);

      expect(senderBalanceAfter).to.equal(senderBalanceBefore - totalAmount);
      expect(beneficiaryBalanceAfter).to.equal(beneficiaryBalanceBefore + amount);
      expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore + fee);

      const remittance = await enerpayRemittance.getRemittance(0);
      expect(remittance.sender).to.equal(sender.address);
      expect(remittance.beneficiary).to.equal(beneficiary.address);
      expect(remittance.amount).to.equal(amount);
      expect(remittance.destinationType).to.equal(destinationType);
      expect(remittance.destinationId).to.equal(destinationId);
      expect(remittance.status).to.equal(1); // Completed
    });

    it("Should create a pending remittance for non-wallet type", async function () {
      const fee = (amount * BigInt(PLATFORM_FEE)) / BigInt(10000);
      const totalAmount = amount + fee;

      // Get current remittance count
      const currentCount = await enerpayRemittance.remittanceCount();
      const expectedId = Number(currentCount);

      const tx = await enerpayRemittance
        .connect(sender)
        .sendRemittance(
          beneficiary.address,
          amount,
          "bank",
          "account_123"
        );

      await expect(tx)
        .to.emit(enerpayRemittance, "RemittanceCreated")
        .withArgs(
          expectedId,
          sender.address,
          beneficiary.address,
          amount,
          fee,
          "bank",
          "account_123"
        );

      // Should NOT emit RemittanceCompleted for non-wallet type
      await expect(tx).to.not.emit(enerpayRemittance, "RemittanceCompleted");

      const remittance = await enerpayRemittance.getRemittance(expectedId);
      expect(remittance.status).to.equal(0); // Pending

      const contractBalance = await cUSD.balanceOf(
        await enerpayRemittance.getAddress()
      );
      expect(contractBalance).to.equal(amount); // Only amount, fee already sent to treasury
    });

    it("Should revert if beneficiary is zero address", async function () {
      await expect(
        enerpayRemittance
          .connect(sender)
          .sendRemittance(
            ethers.ZeroAddress,
            amount,
            destinationType,
            destinationId
          )
      ).to.be.revertedWith("Invalid beneficiary address");
    });

    it("Should revert if amount is zero", async function () {
      await expect(
        enerpayRemittance
          .connect(sender)
          .sendRemittance(
            beneficiary.address,
            0,
            destinationType,
            destinationId
          )
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should revert if destination type is empty", async function () {
      await expect(
        enerpayRemittance
          .connect(sender)
          .sendRemittance(beneficiary.address, amount, "", destinationId)
      ).to.be.revertedWith("Destination type cannot be empty");
    });

    it("Should revert if insufficient allowance", async function () {
      await cUSD
        .connect(sender)
        .approve(await enerpayRemittance.getAddress(), ethers.parseEther("50"));

      await expect(
        enerpayRemittance
          .connect(sender)
          .sendRemittance(
            beneficiary.address,
            amount,
            destinationType,
            destinationId
          )
      ).to.be.reverted; // ERC20 transferFrom will revert with custom error
    });
  });

  describe("completeRemittance", function () {
    const amount = ethers.parseEther("100");

    beforeEach(async function () {
      await cUSD
        .connect(sender)
        .approve(await enerpayRemittance.getAddress(), ethers.parseEther("200"));

      // Create a pending remittance
      await enerpayRemittance
        .connect(sender)
        .sendRemittance(
          beneficiary.address,
          amount,
          "bank",
          "account_123"
        );
    });

    it("Should complete a remittance and transfer to beneficiary", async function () {
      const beneficiaryBalanceBefore = await cUSD.balanceOf(
        beneficiary.address
      );

      const tx = await enerpayRemittance
        .connect(owner)
        .completeRemittance(0, 1); // RemittanceStatus.Completed

      await expect(tx)
        .to.emit(enerpayRemittance, "RemittanceCompleted")
        .withArgs(0, 1);

      const beneficiaryBalanceAfter = await cUSD.balanceOf(
        beneficiary.address
      );
      expect(beneficiaryBalanceAfter).to.equal(
        beneficiaryBalanceBefore + amount
      );

      const remittance = await enerpayRemittance.getRemittance(0);
      expect(remittance.status).to.equal(1); // Completed
    });

    it("Should refund a failed remittance", async function () {
      const senderBalanceBefore = await cUSD.balanceOf(sender.address);

      const tx = await enerpayRemittance
        .connect(owner)
        .completeRemittance(0, 3); // RemittanceStatus.Refunded

      await expect(tx)
        .to.emit(enerpayRemittance, "RemittanceCompleted")
        .withArgs(0, 3);

      const senderBalanceAfter = await cUSD.balanceOf(sender.address);
      expect(senderBalanceAfter).to.equal(senderBalanceBefore + amount);

      const remittance = await enerpayRemittance.getRemittance(0);
      expect(remittance.status).to.equal(3); // Refunded
    });

    it("Should mark remittance as failed", async function () {
      const tx = await enerpayRemittance
        .connect(owner)
        .completeRemittance(0, 2); // RemittanceStatus.Failed

      await expect(tx)
        .to.emit(enerpayRemittance, "RemittanceCompleted")
        .withArgs(0, 2);

      const remittance = await enerpayRemittance.getRemittance(0);
      expect(remittance.status).to.equal(2); // Failed
    });

    it("Should revert if not owner", async function () {
      await expect(
        enerpayRemittance
          .connect(otherAccount)
          .completeRemittance(0, 1)
      ).to.be.revertedWithCustomError(enerpayRemittance, "OwnableUnauthorizedAccount");
    });

    it("Should revert if remittance doesn't exist", async function () {
      await expect(
        enerpayRemittance.connect(owner).completeRemittance(999, 1)
      ).to.be.revertedWith("Remittance does not exist");
    });

    it("Should revert if remittance already processed", async function () {
      await enerpayRemittance.connect(owner).completeRemittance(0, 1);

      await expect(
        enerpayRemittance.connect(owner).completeRemittance(0, 1)
      ).to.be.revertedWith("Remittance already processed");
    });

    it("Should revert if invalid status", async function () {
      await expect(
        enerpayRemittance.connect(owner).completeRemittance(0, 0) // Pending
      ).to.be.revertedWith("Invalid status");
    });
  });

  describe("getRemittanceHistory", function () {
    const amount = ethers.parseEther("100");

    beforeEach(async function () {
      await cUSD
        .connect(sender)
        .approve(
          await enerpayRemittance.getAddress(),
          ethers.parseEther("1000")
        );

      // Create multiple remittances
      await enerpayRemittance
        .connect(sender)
        .sendRemittance(
          beneficiary.address,
          amount,
          "wallet",
          "0x123"
        );

      await enerpayRemittance
        .connect(sender)
        .sendRemittance(
          beneficiary.address,
          amount,
          "bank",
          "account_123"
        );

      await enerpayRemittance
        .connect(sender)
        .sendRemittance(
          beneficiary.address,
          amount,
          "mobile",
          "+1234567890"
        );
    });

    it("Should return all remittance IDs for a user", async function () {
      const history = await enerpayRemittance.getRemittanceHistory(
        sender.address
      );
      expect(history.length).to.equal(3);
      expect(history[0]).to.equal(0);
      expect(history[1]).to.equal(1);
      expect(history[2]).to.equal(2);
    });

    it("Should return empty array for user with no remittances", async function () {
      const history = await enerpayRemittance.getRemittanceHistory(
        otherAccount.address
      );
      expect(history.length).to.equal(0);
    });
  });

  describe("calculateFee", function () {
    it("Should calculate fee correctly", async function () {
      const amount = ethers.parseEther("100");
      const [fee, totalAmount] = await enerpayRemittance.calculateFee(amount);

      const expectedFee = (amount * BigInt(PLATFORM_FEE)) / BigInt(10000);
      const expectedTotal = amount + expectedFee;

      expect(fee).to.equal(expectedFee);
      expect(totalAmount).to.equal(expectedTotal);
    });

    it("Should calculate fee for different amounts", async function () {
      const amounts = [
        ethers.parseEther("10"),
        ethers.parseEther("50"),
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
      ];

      for (const amount of amounts) {
        const [fee, totalAmount] = await enerpayRemittance.calculateFee(
          amount
        );
        const expectedFee =
          (amount * BigInt(PLATFORM_FEE)) / BigInt(10000);
        const expectedTotal = amount + expectedFee;

        expect(fee).to.equal(expectedFee);
        expect(totalAmount).to.equal(expectedTotal);
      }
    });
  });

  describe("Owner functions", function () {
    it("Should update platform fee", async function () {
      const newFee = 200; // 2%
      await enerpayRemittance.connect(owner).setPlatformFee(newFee);
      expect(await enerpayRemittance.platformFee()).to.equal(newFee);
    });

    it("Should revert if fee exceeds 10%", async function () {
      await expect(
        enerpayRemittance.connect(owner).setPlatformFee(1001)
      ).to.be.revertedWith("Fee cannot exceed 10%");
    });

    it("Should update treasury address", async function () {
      await enerpayRemittance
        .connect(owner)
        .setTreasuryAddress(otherAccount.address);
      expect(await enerpayRemittance.treasuryAddress()).to.equal(
        otherAccount.address
      );
    });

    it("Should revert if treasury address is zero", async function () {
      await expect(
        enerpayRemittance
          .connect(owner)
          .setTreasuryAddress(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid treasury address");
    });

    it("Should allow emergency withdraw", async function () {
      // Send some tokens to contract
      await cUSD.transfer(
        await enerpayRemittance.getAddress(),
        ethers.parseEther("100")
      );

      const ownerBalanceBefore = await cUSD.balanceOf(owner.address);
      await enerpayRemittance
        .connect(owner)
        .emergencyWithdraw(ethers.parseEther("100"), owner.address);
      const ownerBalanceAfter = await cUSD.balanceOf(owner.address);

      expect(ownerBalanceAfter).to.equal(
        ownerBalanceBefore + ethers.parseEther("100")
      );
    });

    it("Should revert owner functions if not owner", async function () {
      await expect(
        enerpayRemittance.connect(otherAccount).setPlatformFee(200)
      ).to.be.revertedWithCustomError(enerpayRemittance, "OwnableUnauthorizedAccount");

      await expect(
        enerpayRemittance
          .connect(otherAccount)
          .setTreasuryAddress(otherAccount.address)
      ).to.be.revertedWithCustomError(enerpayRemittance, "OwnableUnauthorizedAccount");

      await expect(
        enerpayRemittance
          .connect(otherAccount)
          .emergencyWithdraw(ethers.parseEther("100"), otherAccount.address)
      ).to.be.revertedWithCustomError(enerpayRemittance, "OwnableUnauthorizedAccount");
    });
  });

  describe("Remittance count", function () {
    it("Should increment remittance count", async function () {
      expect(await enerpayRemittance.remittanceCount()).to.equal(0);

      await cUSD
        .connect(sender)
        .approve(await enerpayRemittance.getAddress(), ethers.parseEther("200"));

      await enerpayRemittance
        .connect(sender)
        .sendRemittance(
          beneficiary.address,
          ethers.parseEther("100"),
          "wallet",
          "0x123"
        );

      expect(await enerpayRemittance.remittanceCount()).to.equal(1);
    });
  });
});

