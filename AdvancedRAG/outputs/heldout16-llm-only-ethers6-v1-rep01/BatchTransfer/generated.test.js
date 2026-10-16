const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchTransfer", function () {
  let batchTransfer;
  let owner;
  let recipient1;
  let recipient2;
  let recipient3;
  let token;

  beforeEach(async function () {
    [owner, recipient1, recipient2, recipient3] = await ethers.getSigners();

    // Deploy BatchTransfer contract
    const BatchTransfer = await ethers.getContractFactory("BatchTransfer");
    batchTransfer = await BatchTransfer.deploy();
    await batchTransfer.waitForDeployment();

    // Deploy BenchmarkERC20 token for ERC20 tests
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TST");
    await token.waitForDeployment();

    // Mint tokens to owner and approve BatchTransfer contract
    const totalAmount = ethers.parseEther("1000");
    await token.mint(owner.address, totalAmount);
    await token.approve(await batchTransfer.getAddress(), totalAmount);
  });

  describe("ETH Batch Transfers", function () {
    it("should send equal ETH amounts to multiple recipients", async function () {
      const amountEach = ethers.parseEther("1");
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amountEach * BigInt(recipients.length);

      const tx = await batchTransfer.batchSendEqual(recipients, amountEach, { value: totalAmount });
      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);

      // Check recipient balances
      expect(await ethers.provider.getBalance(recipient1.address)).to.be.gt(0);
      expect(await ethers.provider.getBalance(recipient2.address)).to.be.gt(0);
      expect(await ethers.provider.getBalance(recipient3.address)).to.be.gt(0);
    });

    it("should revert when ETH amount doesn't match expected total", async function () {
      const amountEach = ethers.parseEther("1");
      const recipients = [recipient1.address, recipient2.address];
      const incorrectAmount = ethers.parseEther("1.5");

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, { value: incorrectAmount })
      ).to.be.revertedWith("Wrong ETH");
    });

    it("should revert when no recipients are provided", async function () {
      const amountEach = ethers.parseEther("1");
      const recipients = [];

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, { value: 0 })
      ).to.be.revertedWith("No recipients");
    });

    it("should send variable ETH amounts to multiple recipients", async function () {
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2"), ethers.parseEther("3")];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amounts.reduce((sum, amount) => sum + amount, 0n);

      const tx = await batchTransfer.batchSendVariable(recipients, amounts, { value: totalAmount });
      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);

      // Check recipient balances
      expect(await ethers.provider.getBalance(recipient1.address)).to.be.gt(0);
      expect(await ethers.provider.getBalance(recipient2.address)).to.be.gt(0);
      expect(await ethers.provider.getBalance(recipient3.address)).to.be.gt(0);
    });

    it("should revert when variable amounts length doesn't match recipients length", async function () {
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];

      await expect(
        batchTransfer.batchSendVariable(recipients, amounts, { value: 0 })
      ).to.be.revertedWith("Length mismatch");
    });

    it("should revert when variable ETH amount doesn't match expected total", async function () {
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2"), ethers.parseEther("3")];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const incorrectAmount = ethers.parseEther("5");

      await expect(
        batchTransfer.batchSendVariable(recipients, amounts, { value: incorrectAmount })
      ).to.be.revertedWith("Wrong ETH");
    });
  });

  describe("ERC20 Batch Transfers", function () {
    it("should send equal ERC20 amounts to multiple recipients", async function () {
      const amountEach = ethers.parseEther("10");
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amountEach * BigInt(recipients.length);

      const tx = await batchTransfer.batchSendERC20Equal(
        await token.getAddress(),
        recipients,
        amountEach
      );
      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await token.getAddress(), recipients.length, totalAmount);

      // Check recipient balances
      expect(await token.balanceOf(recipient1.address)).to.equal(amountEach);
      expect(await token.balanceOf(recipient2.address)).to.equal(amountEach);
      expect(await token.balanceOf(recipient3.address)).to.equal(amountEach);
    });

    it("should revert when no ERC20 recipients are provided", async function () {
      const amountEach = ethers.parseEther("10");
      const recipients = [];

      await expect(
        batchTransfer.batchSendERC20Equal(await token.getAddress(), recipients, amountEach)
      ).to.be.revertedWith("No recipients");
    });

    it("should send variable ERC20 amounts to multiple recipients", async function () {
      const amounts = [ethers.parseEther("10"), ethers.parseEther("20"), ethers.parseEther("30")];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amounts.reduce((sum, amount) => sum + amount, 0n);

      const tx = await batchTransfer.batchSendERC20Variable(
        await token.getAddress(),
        recipients,
        amounts
      );
      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await token.getAddress(), recipients.length, totalAmount);

      // Check recipient balances
      expect(await token.balanceOf(recipient1.address)).to.equal(amounts[0]);
      expect(await token.balanceOf(recipient2.address)).to.equal(amounts[1]);
      expect(await token.balanceOf(recipient3.address)).to.equal(amounts[2]);
    });

    it("should revert when variable ERC20 amounts length doesn't match recipients length", async function () {
      const amounts = [ethers.parseEther("10"), ethers.parseEther("20")];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];

      await expect(
        batchTransfer.batchSendERC20Variable(await token.getAddress(), recipients, amounts)
      ).to.be.revertedWith("Length mismatch");
    });
  });

  describe("Reentrancy Protection", function () {
    it("should revert when sending ETH to a contract that reverts", async function () {
      // Deploy a contract that will revert on receive
      const ReentrantContract = await ethers.getContractFactory("BenchmarkTarget");
      const reentrantContract = await ReentrantContract.deploy();
      await reentrantContract.waitForDeployment();

      const amountEach = ethers.parseEther("1");
      const recipients = [await reentrantContract.getAddress(), recipient2.address];
      const totalAmount = amountEach * BigInt(recipients.length);

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, { value: totalAmount })
      ).to.be.revertedWith("ETH send failed");
    });
  });
});