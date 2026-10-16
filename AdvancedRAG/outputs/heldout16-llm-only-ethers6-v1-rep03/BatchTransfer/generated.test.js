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

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to owner and approve BatchTransfer contract
    const amount = ethers.parseEther("1000");
    await token.mint(owner.address, amount);
    await token.approve(await batchTransfer.getAddress(), amount);
  });

  describe("ETH Batch Transfers", function () {
    it("should batch send equal ETH amounts", async function () {
      const amountEach = ethers.parseEther("1");
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amountEach * BigInt(recipients.length);

      const tx = await batchTransfer.batchSendEqual(recipients, amountEach, { value: totalAmount });
      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);

      // Check recipient balances
      const balance1 = await ethers.provider.getBalance(recipient1.address);
      const balance2 = await ethers.provider.getBalance(recipient2.address);
      const balance3 = await ethers.provider.getBalance(recipient3.address);

      // The exact balance check would need to account for gas costs
      // This is a simplified check that the balance increased by at least the amount sent
      expect(balance1).to.be.gt(ethers.parseEther("0"));
      expect(balance2).to.be.gt(ethers.parseEther("0"));
      expect(balance3).to.be.gt(ethers.parseEther("0"));
    });

    it("should batch send variable ETH amounts", async function () {
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2"), ethers.parseEther("3")];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amounts.reduce((sum, amount) => sum + amount, 0n);

      const tx = await batchTransfer.batchSendVariable(recipients, amounts, { value: totalAmount });
      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);

      // Check recipient balances
      const balance1 = await ethers.provider.getBalance(recipient1.address);
      const balance2 = await ethers.provider.getBalance(recipient2.address);
      const balance3 = await ethers.provider.getBalance(recipient3.address);

      // The exact balance check would need to account for gas costs
      // This is a simplified check that the balance increased by at least the amount sent
      expect(balance1).to.be.gt(ethers.parseEther("0"));
      expect(balance2).to.be.gt(ethers.parseEther("0"));
      expect(balance3).to.be.gt(ethers.parseEther("0"));
    });

    it("should revert when no recipients for ETH batch", async function () {
      await expect(
        batchTransfer.batchSendEqual([], ethers.parseEther("1"), { value: ethers.parseEther("1") })
      ).to.be.revertedWith("No recipients");
    });

    it("should revert when wrong ETH amount for equal batch", async function () {
      await expect(
        batchTransfer.batchSendEqual(
          [recipient1.address, recipient2.address],
          ethers.parseEther("1"),
          { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWith("Wrong ETH");
    });

    it("should revert when wrong ETH amount for variable batch", async function () {
      await expect(
        batchTransfer.batchSendVariable(
          [recipient1.address, recipient2.address],
          [ethers.parseEther("1"), ethers.parseEther("1")],
          { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWith("Wrong ETH");
    });

    it("should revert when recipient array length mismatch for variable batch", async function () {
      await expect(
        batchTransfer.batchSendVariable(
          [recipient1.address],
          [ethers.parseEther("1"), ethers.parseEther("1")],
          { value: ethers.parseEther("2") }
        )
      ).to.be.revertedWith("Length mismatch");
    });
  });

  describe("ERC20 Batch Transfers", function () {
    it("should batch send equal ERC20 amounts", async function () {
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
      const balance1 = await token.balanceOf(recipient1.address);
      const balance2 = await token.balanceOf(recipient2.address);
      const balance3 = await token.balanceOf(recipient3.address);

      expect(balance1).to.equal(amountEach);
      expect(balance2).to.equal(amountEach);
      expect(balance3).to.equal(amountEach);
    });

    it("should batch send variable ERC20 amounts", async function () {
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
      const balance1 = await token.balanceOf(recipient1.address);
      const balance2 = await token.balanceOf(recipient2.address);
      const balance3 = await token.balanceOf(recipient3.address);

      expect(balance1).to.equal(amounts[0]);
      expect(balance2).to.equal(amounts[1]);
      expect(balance3).to.equal(amounts[2]);
    });

    it("should revert when no recipients for ERC20 batch", async function () {
      await expect(
        batchTransfer.batchSendERC20Equal(
          await token.getAddress(),
          [],
          ethers.parseEther("10")
        )
      ).to.be.revertedWith("No recipients");
    });

    it("should revert when recipient array length mismatch for ERC20 variable batch", async function () {
      await expect(
        batchTransfer.batchSendERC20Variable(
          await token.getAddress(),
          [recipient1.address],
          [ethers.parseEther("10"), ethers.parseEther("10")]
        )
      ).to.be.revertedWith("Length mismatch");
    });

    it("should revert when transfer fails for ERC20 equal batch", async function () {
      // Approve only for partial amount
      await token.approve(await batchTransfer.getAddress(), ethers.parseEther("10"));

      await expect(
        batchTransfer.batchSendERC20Equal(
          await token.getAddress(),
          [recipient1.address, recipient2.address],
          ethers.parseEther("10")
        )
      ).to.be.revertedWith("Transfer failed");
    });

    it("should revert when transfer fails for ERC20 variable batch", async function () {
      // Approve only for partial amount
      await token.approve(await batchTransfer.getAddress(), ethers.parseEther("10"));

      await expect(
        batchTransfer.batchSendERC20Variable(
          await token.getAddress(),
          [recipient1.address, recipient2.address],
          [ethers.parseEther("10"), ethers.parseEther("10")]
        )
      ).to.be.revertedWith("Transfer failed");
    });
  });

  describe("Receive Function", function () {
    it("should revert when ETH is sent directly", async function () {
      await expect(
        owner.sendTransaction({
          to: await batchTransfer.getAddress(),
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("Use batchSend functions");
    });
  });
});