const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchTransfer", function () {
  let batchTransfer;
  let owner;
  let addr1;
  let addr2;
  let addr3;
  let erc20Token;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();

    // Deploy BatchTransfer contract
    const BatchTransfer = await ethers.getContractFactory("BatchTransfer");
    batchTransfer = await BatchTransfer.deploy();
    await batchTransfer.waitForDeployment();

    // Deploy ERC20 token for testing
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    erc20Token = await BenchmarkERC20.deploy("Test Token", "TT");
    await erc20Token.waitForDeployment();

    // Mint tokens to owner and approve BatchTransfer contract
    await erc20Token.mint(owner.address, ethers.parseEther("1000"));
    await erc20Token.approve(await batchTransfer.getAddress(), ethers.parseEther("1000"));
  });

  describe("ETH Batch Transfers", function () {
    it("Should send equal ETH amounts to multiple recipients", async function () {
      const recipients = [addr1.address, addr2.address, addr3.address];
      const amountEach = ethers.parseEther("1");

      const initialBalances = await Promise.all(
        recipients.map(async (addr) => await ethers.provider.getBalance(addr))
      );

      const tx = await batchTransfer.batchSendEqual(recipients, amountEach, {
        value: ethers.parseEther("3")
      });

      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(3n, ethers.parseEther("3"));

      const finalBalances = await Promise.all(
        recipients.map(async (addr) => await ethers.provider.getBalance(addr))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amountEach);
      }
    });

    it("Should revert if ETH amount is incorrect for equal distribution", async function () {
      const recipients = [addr1.address, addr2.address];
      const amountEach = ethers.parseEther("1");

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, {
          value: ethers.parseEther("1.5")
        })
      ).to.be.revertedWith("Wrong ETH");
    });

    it("Should send variable ETH amounts to multiple recipients", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];

      const initialBalances = await Promise.all(
        recipients.map(async (addr) => await ethers.provider.getBalance(addr))
      );

      const tx = await batchTransfer.batchSendVariable(recipients, amounts, {
        value: ethers.parseEther("3")
      });

      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(2n, ethers.parseEther("3"));

      const finalBalances = await Promise.all(
        recipients.map(async (addr) => await ethers.provider.getBalance(addr))
      );

      expect(finalBalances[0]).to.equal(initialBalances[0] + amounts[0]);
      expect(finalBalances[1]).to.equal(initialBalances[1] + amounts[1]);
    });

    it("Should revert if ETH amount is incorrect for variable distribution", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];

      await expect(
        batchTransfer.batchSendVariable(recipients, amounts, {
          value: ethers.parseEther("2.5")
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

      await expect(
        batchTransfer.batchSendEqual([await failingContract.getAddress()], ethers.parseEther("1"), {
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("ETH send failed");
    });
  });

  describe("ERC20 Batch Transfers", function () {
    it("Should send equal ERC20 amounts to multiple recipients", async function () {
      const recipients = [addr1.address, addr2.address, addr3.address];
      const amountEach = ethers.parseEther("1");

      const initialBalances = await Promise.all(
        recipients.map(async (addr) => await erc20Token.balanceOf(addr))
      );

      const tx = await batchTransfer.batchSendERC20Equal(
        await erc20Token.getAddress(),
        recipients,
        amountEach
      );

      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await erc20Token.getAddress(), 3n, ethers.parseEther("3"));

      const finalBalances = await Promise.all(
        recipients.map(async (addr) => await erc20Token.balanceOf(addr))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amountEach);
      }
    });

    it("Should send variable ERC20 amounts to multiple recipients", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];

      const initialBalances = await Promise.all(
        recipients.map(async (addr) => await erc20Token.balanceOf(addr))
      );

      const tx = await batchTransfer.batchSendERC20Variable(
        await erc20Token.getAddress(),
        recipients,
        amounts
      );

      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await erc20Token.getAddress(), 2n, ethers.parseEther("3"));

      const finalBalances = await Promise.all(
        recipients.map(async (addr) => await erc20Token.balanceOf(addr))
      );

      expect(finalBalances[0]).to.equal(initialBalances[0] + amounts[0]);
      expect(finalBalances[1]).to.equal(initialBalances[1] + amounts[1]);
    });

    it("Should revert if ERC20 transfer fails", async function () {
      // Deploy a token that will revert on transfer
      const FailingERC20 = await ethers.getContractFactory("BenchmarkTarget");
      const failingToken = await FailingERC20.deploy();
      await failingToken.waitForDeployment();

      await expect(
        batchTransfer.batchSendERC20Equal(
          await failingToken.getAddress(),
          [addr1.address],
          ethers.parseEther("1")
        )
      ).to.be.revertedWith("Transfer failed");
    });

    it("Should revert if recipients array is empty for ERC20", async function () {
      await expect(
        batchTransfer.batchSendERC20Equal(
          await erc20Token.getAddress(),
          [],
          ethers.parseEther("1")
        )
      ).to.be.revertedWith("No recipients");
    });

    it("Should revert if array lengths mismatch for ERC20 variable transfer", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1")];

      await expect(
        batchTransfer.batchSendERC20Variable(
          await erc20Token.getAddress(),
          recipients,
          amounts
        )
      ).to.be.revertedWith("Length mismatch");
    });
  });

  describe("Security Checks", function () {
    it("Should revert if ETH is sent directly to the contract", async function () {
      await expect(
        owner.sendTransaction({
          to: await batchTransfer.getAddress(),
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("Use batchSend functions");
    });
  });
});