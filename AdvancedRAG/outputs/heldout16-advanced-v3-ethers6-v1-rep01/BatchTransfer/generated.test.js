const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchTransfer", function () {
  let batchTransfer;
  let owner;
  let recipient1;
  let recipient2;
  let recipient3;
  let erc20Token;

  beforeEach(async function () {
    [owner, recipient1, recipient2, recipient3] = await ethers.getSigners();

    // Deploy BatchTransfer contract
    const BatchTransfer = await ethers.getContractFactory("BatchTransfer");
    batchTransfer = await BatchTransfer.deploy();
    await batchTransfer.waitForDeployment();

    // Deploy ERC20 token for testing
    const ERC20 = await ethers.getContractFactory("BenchmarkERC20");
    erc20Token = await ERC20.deploy("Test Token", "TT");
    await erc20Token.waitForDeployment();

    // Mint tokens to owner and approve BatchTransfer contract
    const amount = ethers.parseEther("1000");
    await erc20Token.mint(owner.address, amount);
    await erc20Token.approve(await batchTransfer.getAddress(), amount);
  });

  describe("ETH Batch Transfers", function () {
    it("Should batch send equal ETH amounts", async function () {
      const amountEach = ethers.parseEther("1");
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amountEach * BigInt(recipients.length);

      const tx = await batchTransfer.batchSendEqual(recipients, amountEach, { value: totalAmount });
      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);

      // Check balances
      expect(await ethers.provider.getBalance(recipient1.address)).to.be.gt(0);
      expect(await ethers.provider.getBalance(recipient2.address)).to.be.gt(0);
      expect(await ethers.provider.getBalance(recipient3.address)).to.be.gt(0);
    });

    it("Should revert if ETH amount is incorrect for equal batch send", async function () {
      const amountEach = ethers.parseEther("1");
      const recipients = [recipient1.address, recipient2.address];
      const incorrectAmount = ethers.parseEther("1.5");

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, { value: incorrectAmount })
      ).to.be.revertedWith("Wrong ETH");
    });

    it("Should revert if no recipients for equal batch send", async function () {
      const amountEach = ethers.parseEther("1");
      const recipients = [];

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, { value: 0 })
      ).to.be.revertedWith("No recipients");
    });

    it("Should batch send variable ETH amounts", async function () {
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2"), ethers.parseEther("3")];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amounts.reduce((sum, amount) => sum + amount, 0n);

      const tx = await batchTransfer.batchSendVariable(recipients, amounts, { value: totalAmount });
      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);

      // Check balances
      expect(await ethers.provider.getBalance(recipient1.address)).to.be.gt(0);
      expect(await ethers.provider.getBalance(recipient2.address)).to.be.gt(0);
      expect(await ethers.provider.getBalance(recipient3.address)).to.be.gt(0);
    });

    it("Should revert if array lengths mismatch for variable batch send", async function () {
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];

      await expect(
        batchTransfer.batchSendVariable(recipients, amounts, { value: 0 })
      ).to.be.revertedWith("Length mismatch");
    });

    it("Should revert if ETH amount is incorrect for variable batch send", async function () {
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];
      const recipients = [recipient1.address, recipient2.address];
      const incorrectAmount = ethers.parseEther("2.5");

      await expect(
        batchTransfer.batchSendVariable(recipients, amounts, { value: incorrectAmount })
      ).to.be.revertedWith("Wrong ETH");
    });
  });

  describe("ERC20 Batch Transfers", function () {
    it("Should batch send equal ERC20 amounts", async function () {
      const amountEach = ethers.parseEther("100");
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amountEach * BigInt(recipients.length);

      const tx = await batchTransfer.batchSendERC20Equal(
        await erc20Token.getAddress(),
        recipients,
        amountEach
      );
      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await erc20Token.getAddress(), recipients.length, totalAmount);

      // Check balances
      expect(await erc20Token.balanceOf(recipient1.address)).to.equal(amountEach);
      expect(await erc20Token.balanceOf(recipient2.address)).to.equal(amountEach);
      expect(await erc20Token.balanceOf(recipient3.address)).to.equal(amountEach);
    });

    it("Should revert if no recipients for equal ERC20 batch send", async function () {
      const amountEach = ethers.parseEther("100");
      const recipients = [];

      await expect(
        batchTransfer.batchSendERC20Equal(await erc20Token.getAddress(), recipients, amountEach)
      ).to.be.revertedWith("No recipients");
    });

    it("Should batch send variable ERC20 amounts", async function () {
      const amounts = [ethers.parseEther("100"), ethers.parseEther("200"), ethers.parseEther("300")];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amounts.reduce((sum, amount) => sum + amount, 0n);

      const tx = await batchTransfer.batchSendERC20Variable(
        await erc20Token.getAddress(),
        recipients,
        amounts
      );
      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await erc20Token.getAddress(), recipients.length, totalAmount);

      // Check balances
      expect(await erc20Token.balanceOf(recipient1.address)).to.equal(amounts[0]);
      expect(await erc20Token.balanceOf(recipient2.address)).to.equal(amounts[1]);
      expect(await erc20Token.balanceOf(recipient3.address)).to.equal(amounts[2]);
    });

    it("Should revert if array lengths mismatch for variable ERC20 batch send", async function () {
      const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];

      await expect(
        batchTransfer.batchSendERC20Variable(await erc20Token.getAddress(), recipients, amounts)
      ).to.be.revertedWith("Length mismatch");
    });
  });

  describe("Reentrancy Protection", function () {
    it("Should revert if ETH transfer fails", async function () {
      // Create a contract that will revert on receive
      const RevertReceiver = await ethers.getContractFactory("BenchmarkTarget");
      const revertReceiver = await RevertReceiver.deploy();
      await revertReceiver.waitForDeployment();

      const amountEach = ethers.parseEther("1");
      const recipients = [await revertReceiver.getAddress(), recipient2.address];

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, { value: amountEach * 2n })
      ).to.be.revertedWith("ETH send failed");
    });

    it("Should revert if ERC20 transfer fails", async function () {
      // Create a contract that will revert on transfer
      const RevertToken = await ethers.getContractFactory("BenchmarkTarget");
      const revertToken = await RevertToken.deploy();
      await revertToken.waitForDeployment();

      const amountEach = ethers.parseEther("100");
      const recipients = [recipient1.address, recipient2.address];

      await expect(
        batchTransfer.batchSendERC20Equal(await revertToken.getAddress(), recipients, amountEach)
      ).to.be.revertedWith("Transfer failed");
    });
  });

  describe("Direct ETH Transfers", function () {
    it("Should revert if ETH sent directly to contract", async function () {
      await expect(
        owner.sendTransaction({
          to: await batchTransfer.getAddress(),
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("Use batchSend functions");
    });
  });
});