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
    const totalAmount = ethers.parseEther("1000");
    await token.mint(owner.address, totalAmount);
    await token.approve(await batchTransfer.getAddress(), totalAmount);
  });

  describe("ETH Batch Transfers", function () {
    it("should batch send equal ETH amounts", async function () {
      const amountEach = ethers.parseEther("1");
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amountEach * BigInt(recipients.length);

      const initialBalances = await Promise.all(
        recipients.map(async (r) => await ethers.provider.getBalance(r))
      );

      const tx = await batchTransfer.batchSendEqual(recipients, amountEach, {
        value: totalAmount
      });
      await tx.wait();

      const finalBalances = await Promise.all(
        recipients.map(async (r) => await ethers.provider.getBalance(r))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amountEach);
      }

      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);
    });

    it("should revert when ETH amount is incorrect for equal batch send", async function () {
      const amountEach = ethers.parseEther("1");
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const incorrectAmount = amountEach * BigInt(recipients.length - 1n);

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, {
          value: incorrectAmount
        })
      ).to.be.revertedWith("Wrong ETH");
    });

    it("should revert when no recipients for equal batch send", async function () {
      const amountEach = ethers.parseEther("1");
      await expect(
        batchTransfer.batchSendEqual([], amountEach, {
          value: 0
        })
      ).to.be.revertedWith("No recipients");
    });

    it("should batch send variable ETH amounts", async function () {
      const amounts = [
        ethers.parseEther("1"),
        ethers.parseEther("2"),
        ethers.parseEther("3")
      ];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amounts.reduce((sum, a) => sum + a, 0n);

      const initialBalances = await Promise.all(
        recipients.map(async (r) => await ethers.provider.getBalance(r))
      );

      const tx = await batchTransfer.batchSendVariable(recipients, amounts, {
        value: totalAmount
      });
      await tx.wait();

      const finalBalances = await Promise.all(
        recipients.map(async (r) => await ethers.provider.getBalance(r))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amounts[i]);
      }

      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);
    });

    it("should revert when ETH amount is incorrect for variable batch send", async function () {
      const amounts = [
        ethers.parseEther("1"),
        ethers.parseEther("2"),
        ethers.parseEther("3")
      ];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const incorrectAmount = amounts.reduce((sum, a) => sum + a, 0n) - 1n;

      await expect(
        batchTransfer.batchSendVariable(recipients, amounts, {
          value: incorrectAmount
        })
      ).to.be.revertedWith("Wrong ETH");
    });

    it("should revert when recipients and amounts length mismatch", async function () {
      const amounts = [ethers.parseEther("1")];
      const recipients = [recipient1.address, recipient2.address];

      await expect(
        batchTransfer.batchSendVariable(recipients, amounts, {
          value: amounts[0]
        })
      ).to.be.revertedWith("Length mismatch");
    });
  });

  describe("ERC20 Batch Transfers", function () {
    it("should batch send equal ERC20 amounts", async function () {
      const amountEach = ethers.parseEther("1");
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amountEach * BigInt(recipients.length);

      const initialBalances = await Promise.all(
        recipients.map(async (r) => await token.balanceOf(r))
      );

      const tx = await batchTransfer.batchSendERC20Equal(
        await token.getAddress(),
        recipients,
        amountEach
      );
      await tx.wait();

      const finalBalances = await Promise.all(
        recipients.map(async (r) => await token.balanceOf(r))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amountEach);
      }

      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await token.getAddress(), recipients.length, totalAmount);
    });

    it("should revert when no recipients for equal ERC20 batch send", async function () {
      const amountEach = ethers.parseEther("1");
      await expect(
        batchTransfer.batchSendERC20Equal(
          await token.getAddress(),
          [],
          amountEach
        )
      ).to.be.revertedWith("No recipients");
    });

    it("should batch send variable ERC20 amounts", async function () {
      const amounts = [
        ethers.parseEther("1"),
        ethers.parseEther("2"),
        ethers.parseEther("3")
      ];
      const recipients = [recipient1.address, recipient2.address, recipient3.address];
      const totalAmount = amounts.reduce((sum, a) => sum + a, 0n);

      const initialBalances = await Promise.all(
        recipients.map(async (r) => await token.balanceOf(r))
      );

      const tx = await batchTransfer.batchSendERC20Variable(
        await token.getAddress(),
        recipients,
        amounts
      );
      await tx.wait();

      const finalBalances = await Promise.all(
        recipients.map(async (r) => await token.balanceOf(r))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amounts[i]);
      }

      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await token.getAddress(), recipients.length, totalAmount);
    });

    it("should revert when recipients and amounts length mismatch for ERC20", async function () {
      const amounts = [ethers.parseEther("1")];
      const recipients = [recipient1.address, recipient2.address];

      await expect(
        batchTransfer.batchSendERC20Variable(
          await token.getAddress(),
          recipients,
          amounts
        )
      ).to.be.revertedWith("Length mismatch");
    });
  });

  describe("Reentrancy Protection", function () {
    it("should revert when sending ETH directly to contract", async function () {
      await expect(
        owner.sendTransaction({
          to: await batchTransfer.getAddress(),
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("Use batchSend functions");
    });
  });
});