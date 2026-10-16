const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchTransfer", function () {
  let batchTransfer;
  let owner;
  let addr1;
  let addr2;
  let addr3;
  let token;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();

    // Deploy BatchTransfer contract
    const BatchTransfer = await ethers.getContractFactory("BatchTransfer");
    batchTransfer = await BatchTransfer.deploy();
    await batchTransfer.waitForDeployment();

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens and approve BatchTransfer contract
    await token.mint(owner.address, ethers.parseEther("1000"));
    await token.approve(await batchTransfer.getAddress(), ethers.parseEther("1000"));
  });

  describe("ETH Batch Transfers", function () {
    it("Should batch send equal ETH amounts", async function () {
      const recipients = [addr1.address, addr2.address];
      const amountEach = ethers.parseEther("1");

      const initialBalances = await Promise.all(
        recipients.map(addr => ethers.provider.getBalance(addr))
      );

      const tx = await batchTransfer.batchSendEqual(recipients, amountEach, {
        value: ethers.parseEther("2")
      });

      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(2n, ethers.parseEther("2"));

      const finalBalances = await Promise.all(
        recipients.map(addr => ethers.provider.getBalance(addr))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amountEach);
      }
    });

    it("Should revert if ETH amount is incorrect for equal batch", async function () {
      const recipients = [addr1.address, addr2.address];
      const amountEach = ethers.parseEther("1");

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, {
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("Wrong ETH");
    });

    it("Should batch send variable ETH amounts", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];

      const initialBalances = await Promise.all(
        recipients.map(addr => ethers.provider.getBalance(addr))
      );

      const tx = await batchTransfer.batchSendVariable(recipients, amounts, {
        value: ethers.parseEther("3")
      });

      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(2n, ethers.parseEther("3"));

      const finalBalances = await Promise.all(
        recipients.map(addr => ethers.provider.getBalance(addr))
      );

      expect(finalBalances[0]).to.equal(initialBalances[0] + amounts[0]);
      expect(finalBalances[1]).to.equal(initialBalances[1] + amounts[1]);
    });

    it("Should revert if ETH amount is incorrect for variable batch", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];

      await expect(
        batchTransfer.batchSendVariable(recipients, amounts, {
          value: ethers.parseEther("2")
        })
      ).to.be.revertedWith("Wrong ETH");
    });

    it("Should revert if recipients array is empty", async function () {
      await expect(
        batchTransfer.batchSendEqual([], ethers.parseEther("1"), {
          value: ethers.parseEther("0")
        })
      ).to.be.revertedWith("No recipients");
    });

    it("Should revert if ETH transfer fails", async function () {
      // Use a contract that will revert on receive
      const FailingContract = await ethers.getContractFactory("BenchmarkTarget");
      const failingContract = await FailingContract.deploy();
      await failingContract.waitForDeployment();

      const recipients = [failingContract.target];
      const amountEach = ethers.parseEther("1");

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, {
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("ETH send failed");
    });
  });

  describe("ERC20 Batch Transfers", function () {
    it("Should batch send equal ERC20 amounts", async function () {
      const recipients = [addr1.address, addr2.address];
      const amountEach = ethers.parseEther("1");

      const initialBalances = await Promise.all(
        recipients.map(addr => token.balanceOf(addr))
      );

      const tx = await batchTransfer.batchSendERC20Equal(
        await token.getAddress(),
        recipients,
        amountEach
      );

      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await token.getAddress(), 2n, ethers.parseEther("2"));

      const finalBalances = await Promise.all(
        recipients.map(addr => token.balanceOf(addr))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amountEach);
      }
    });

    it("Should batch send variable ERC20 amounts", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];

      const initialBalances = await Promise.all(
        recipients.map(addr => token.balanceOf(addr))
      );

      const tx = await batchTransfer.batchSendERC20Variable(
        await token.getAddress(),
        recipients,
        amounts
      );

      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await token.getAddress(), 2n, ethers.parseEther("3"));

      const finalBalances = await Promise.all(
        recipients.map(addr => token.balanceOf(addr))
      );

      expect(finalBalances[0]).to.equal(initialBalances[0] + amounts[0]);
      expect(finalBalances[1]).to.equal(initialBalances[1] + amounts[1]);
    });

    it("Should revert if ERC20 transfer fails", async function () {
      // Use a contract that will revert on transferFrom
      const FailingToken = await ethers.getContractFactory("BenchmarkTarget");
      const failingToken = await FailingToken.deploy();
      await failingToken.waitForDeployment();

      const recipients = [addr1.address, addr2.address];
      const amountEach = ethers.parseEther("1");

      await expect(
        batchTransfer.batchSendERC20Equal(
          failingToken.target,
          recipients,
          amountEach
        )
      ).to.be.revertedWith("Transfer failed");
    });

    it("Should revert if recipients array is empty for ERC20", async function () {
      await expect(
        batchTransfer.batchSendERC20Equal(
          await token.getAddress(),
          [],
          ethers.parseEther("1")
        )
      ).to.be.revertedWith("No recipients");
    });

    it("Should revert if array lengths mismatch for ERC20 equal", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1")];

      await expect(
        batchTransfer.batchSendERC20Variable(
          await token.getAddress(),
          recipients,
          amounts
        )
      ).to.be.revertedWith("Length mismatch");
    });

    it("Should revert if array lengths mismatch for ERC20 variable", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1")];

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
    it("Should prevent reentrancy during ETH batch transfer", async function () {
      // Deploy a contract that will try to reenter during transfer
      const ReentrantContractFactory = await ethers.getContractFactory("ReentrantContract");
      const reentrantContract = await ReentrantContractFactory.deploy(await batchTransfer.getAddress());
      await reentrantContract.waitForDeployment();

      // Fund the reentrant contract with ETH
      await owner.sendTransaction({
        to: await reentrantContract.getAddress(),
        value: ethers.parseEther("1")
      });

      // Try to perform a batch transfer that would trigger reentrancy
      const recipients = [addr1.address, await reentrantContract.getAddress()];
      const amounts = [ethers.parseEther("0.5"), ethers.parseEther("0.5")];

      await expect(
        batchTransfer.batchSendVariable(recipients, amounts, {
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("ETH send failed");
    });
  });
});

// Helper contract for reentrancy test
const ReentrantContract = `
  pragma solidity ^0.8.20;

  contract ReentrantContract {
    address public batchTransferAddress;

    constructor(address _batchTransferAddress) {
      batchTransferAddress = _batchTransferAddress;
    }

    receive() external payable {
      // Try to reenter the batch transfer
      (bool success,) = batchTransferAddress.call{value: address(this).balance}("");
      require(success, "Reentrancy failed");
    }
  }
`;