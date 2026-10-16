const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchTransfer", function () {
  let batchTransfer;
  let owner, addr1, addr2, addr3;
  let erc20Token;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();

    // Deploy ERC20 token fixture
    const ERC20Factory = await ethers.getContractFactory("BenchmarkERC20");
    erc20Token = await ERC20Factory.deploy("Test Token", "TT");
    await erc20Token.waitForDeployment();

    // Deploy BatchTransfer contract
    const BatchTransferFactory = await ethers.getContractFactory("BatchTransfer");
    batchTransfer = await BatchTransferFactory.deploy();
    await batchTransfer.waitForDeployment();

    // Mint and approve tokens for testing
    const amount = ethers.parseEther("1000");
    await erc20Token.mint(owner.address, amount);
    await erc20Token.approve(await batchTransfer.getAddress(), amount);
  });

  describe("ETH Batch Transfers", function () {
    it("Should batch send equal ETH amounts", async function () {
      const recipients = [addr1.address, addr2.address];
      const amountEach = ethers.parseEther("1");
      const totalAmount = amountEach * BigInt(recipients.length);

      const initialBalances = await Promise.all(
        recipients.map(r => ethers.provider.getBalance(r))
      );

      const tx = await batchTransfer.batchSendEqual(recipients, amountEach, {
        value: totalAmount
      });
      await tx.wait();

      const finalBalances = await Promise.all(
        recipients.map(r => ethers.provider.getBalance(r))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amountEach);
      }

      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);
    });

    it("Should batch send variable ETH amounts", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];
      const totalAmount = amounts.reduce((sum, a) => sum + a, 0n);

      const initialBalances = await Promise.all(
        recipients.map(r => ethers.provider.getBalance(r))
      );

      const tx = await batchTransfer.batchSendVariable(recipients, amounts, {
        value: totalAmount
      });
      await tx.wait();

      const finalBalances = await Promise.all(
        recipients.map(r => ethers.provider.getBalance(r))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amounts[i]);
      }

      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);
    });

    it("Should revert if ETH amount is incorrect for equal batch", async function () {
      const recipients = [addr1.address, addr2.address];
      const amountEach = ethers.parseEther("1");
      const incorrectAmount = ethers.parseEther("1.5");

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, {
          value: incorrectAmount
        })
      ).to.be.revertedWith("Wrong ETH");
    });

    it("Should revert if ETH amount is incorrect for variable batch", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];
      const incorrectAmount = ethers.parseEther("2.5");

      await expect(
        batchTransfer.batchSendVariable(recipients, amounts, {
          value: incorrectAmount
        })
      ).to.be.revertedWith("Wrong ETH");
    });

    it("Should revert if no recipients for ETH batch", async function () {
      await expect(
        batchTransfer.batchSendEqual([], ethers.parseEther("1"), {
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("No recipients");
    });

    it("Should revert if ETH send fails", async function () {
      // Use a contract that will revert on receive
      const FailingContract = await ethers.getContractFactory("BenchmarkTarget");
      const failingContract = await FailingContract.deploy();
      await failingContract.waitForDeployment();

      const recipients = [await failingContract.getAddress()];
      const amountEach = ethers.parseEther("1");

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, {
          value: amountEach
        })
      ).to.be.revertedWith("ETH send failed");
    });
  });

  describe("ERC20 Batch Transfers", function () {
    it("Should batch send equal ERC20 amounts", async function () {
      const recipients = [addr1.address, addr2.address];
      const amountEach = ethers.parseEther("100");
      const totalAmount = amountEach * BigInt(recipients.length);

      const initialBalances = await Promise.all(
        recipients.map(r => erc20Token.balanceOf(r))
      );

      const tx = await batchTransfer.batchSendERC20Equal(
        await erc20Token.getAddress(),
        recipients,
        amountEach
      );
      await tx.wait();

      const finalBalances = await Promise.all(
        recipients.map(r => erc20Token.balanceOf(r))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amountEach);
      }

      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await erc20Token.getAddress(), recipients.length, totalAmount);
    });

    it("Should batch send variable ERC20 amounts", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];
      const totalAmount = amounts.reduce((sum, a) => sum + a, 0n);

      const initialBalances = await Promise.all(
        recipients.map(r => erc20Token.balanceOf(r))
      );

      const tx = await batchTransfer.batchSendERC20Variable(
        await erc20Token.getAddress(),
        recipients,
        amounts
      );
      await tx.wait();

      const finalBalances = await Promise.all(
        recipients.map(r => erc20Token.balanceOf(r))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amounts[i]);
      }

      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await erc20Token.getAddress(), recipients.length, totalAmount);
    });

    it("Should revert if ERC20 transfer fails", async function () {
      // Deploy a token that will fail on transfer
      const FailingToken = await ethers.getContractFactory("BenchmarkERC20");
      const failingToken = await FailingToken.deploy("Failing Token", "FT");
      await failingToken.waitForDeployment();

      // Mint and approve tokens
      await failingToken.mint(owner.address, ethers.parseEther("1000"));
      await failingToken.approve(await batchTransfer.getAddress(), ethers.parseEther("1000"));

      // Make the token fail on transfer
      await failingToken.burnFrom(owner.address, ethers.parseEther("1000"));

      const recipients = [addr1.address];
      const amountEach = ethers.parseEther("100");

      await expect(
        batchTransfer.batchSendERC20Equal(
          await failingToken.getAddress(),
          recipients,
          amountEach
        )
      ).to.be.revertedWith("Transfer failed");
    });

    it("Should revert if no recipients for ERC20 batch", async function () {
      await expect(
        batchTransfer.batchSendERC20Equal(
          await erc20Token.getAddress(),
          [],
          ethers.parseEther("100")
        )
      ).to.be.revertedWith("No recipients");
    });

    it("Should revert if array lengths mismatch for ERC20 equal batch", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("100")];

      await expect(
        batchTransfer.batchSendERC20Variable(
          await erc20Token.getAddress(),
          recipients,
          amounts
        )
      ).to.be.revertedWith("Length mismatch");
    });

    it("Should revert if array lengths mismatch for ERC20 variable batch", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("100")];

      await expect(
        batchTransfer.batchSendERC20Variable(
          await erc20Token.getAddress(),
          recipients,
          amounts
        )
      ).to.be.revertedWith("Length mismatch");
    });
  });

  describe("Reentrancy Protection", function () {
    it("Should prevent reentrancy during ETH batch transfer", async function () {
      // Deploy a contract that will attempt reentrancy
      const ReentrantContractFactory = await ethers.getContractFactory("ReentrantContract");
      const reentrantContract = await ReentrantContractFactory.deploy(await batchTransfer.getAddress());
      await reentrantContract.waitForDeployment();

      const recipients = [await reentrantContract.getAddress()];
      const amountEach = ethers.parseEther("1");

      // Fund the reentrant contract with some ETH
      await owner.sendTransaction({
        to: await reentrantContract.getAddress(),
        value: ethers.parseEther("1")
      });

      // The reentrant contract will try to call batchSendEqual again during execution
      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, {
          value: amountEach
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
        // Attempt to call batchSendEqual again during execution
        (bool success,) = batchTransferAddress.call(
            abi.encodeWithSignature(
                "batchSendEqual(address[],uint256)",
                [address(this)],
                1 ether
            )
        );
        require(!success, "Reentrancy should fail");
    }
}
`;