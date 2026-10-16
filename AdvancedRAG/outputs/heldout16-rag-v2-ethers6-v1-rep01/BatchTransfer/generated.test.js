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

    // Deploy BenchmarkERC20 token for testing
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to owner and approve BatchTransfer contract
    const totalAmount = ethers.parseEther("1000");
    await token.mint(owner.address, totalAmount);
    await token.approve(await batchTransfer.getAddress(), totalAmount);
  });

  describe("ETH Batch Functions", function () {
    it("Should batch send equal ETH amounts", async function () {
      const recipients = [addr1.address, addr2.address, addr3.address];
      const amountEach = ethers.parseEther("1");
      const totalAmount = amountEach * BigInt(recipients.length);

      const tx = await batchTransfer.batchSendEqual(recipients, amountEach, { value: totalAmount });

      // Check event emission
      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);

      // Check recipient balances
      expect(await ethers.provider.getBalance(addr1.address)).to.be.gt(0);
      expect(await ethers.provider.getBalance(addr2.address)).to.be.gt(0);
      expect(await ethers.provider.getBalance(addr3.address)).to.be.gt(0);
    });

    it("Should revert when ETH amount is incorrect for equal batch send", async function () {
      const recipients = [addr1.address, addr2.address];
      const amountEach = ethers.parseEther("1");
      const incorrectAmount = ethers.parseEther("1.5");

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, { value: incorrectAmount })
      ).to.be.revertedWith("Wrong ETH");
    });

    it("Should batch send variable ETH amounts", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1.5"), ethers.parseEther("2.5")];
      const totalAmount = amounts[0] + amounts[1];

      const tx = await batchTransfer.batchSendVariable(recipients, amounts, { value: totalAmount });

      // Check event emission
      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(recipients.length, totalAmount);

      // Check recipient balances
      expect(await ethers.provider.getBalance(addr1.address)).to.be.gt(0);
      expect(await ethers.provider.getBalance(addr2.address)).to.be.gt(0);
    });

    it("Should revert when ETH amount is incorrect for variable batch send", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];
      const incorrectAmount = ethers.parseEther("2.5");

      await expect(
        batchTransfer.batchSendVariable(recipients, amounts, { value: incorrectAmount })
      ).to.be.revertedWith("Wrong ETH");
    });

    it("Should revert when recipients array is empty for ETH batch send", async function () {
      const recipients = [];
      const amountEach = ethers.parseEther("1");

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, { value: 0 })
      ).to.be.revertedWith("No recipients");
    });

    it("Should revert when ETH send fails", async function () {
      // Use a contract that will revert on receive
      const FailingContract = await ethers.getContractFactory("BenchmarkTarget");
      const failingContract = await FailingContract.deploy();
      await failingContract.waitForDeployment();

      const recipients = [await failingContract.getAddress()];
      const amountEach = ethers.parseEther("1");

      await expect(
        batchTransfer.batchSendEqual(recipients, amountEach, { value: amountEach })
      ).to.be.revertedWith("ETH send failed");
    });
  });

  describe("ERC20 Batch Functions", function () {
    it("Should batch send equal ERC20 amounts", async function () {
      const recipients = [addr1.address, addr2.address, addr3.address];
      const amountEach = ethers.parseEther("100");
      const totalAmount = amountEach * BigInt(recipients.length);

      const tx = await batchTransfer.batchSendERC20Equal(
        await token.getAddress(),
        recipients,
        amountEach
      );

      // Check event emission
      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await token.getAddress(), recipients.length, totalAmount);

      // Check recipient balances
      expect(await token.balanceOf(addr1.address)).to.equal(amountEach);
      expect(await token.balanceOf(addr2.address)).to.equal(amountEach);
      expect(await token.balanceOf(addr3.address)).to.equal(amountEach);
    });

    it("Should revert when ERC20 transfer fails for equal batch send", async function () {
      // Use a contract that will revert on transfer
      const FailingContract = await ethers.getContractFactory("BenchmarkTarget");
      const failingContract = await FailingContract.deploy();
      await failingContract.waitForDeployment();

      const recipients = [await failingContract.getAddress()];
      const amountEach = ethers.parseEther("100");

      await expect(
        batchTransfer.batchSendERC20Equal(
          await token.getAddress(),
          recipients,
          amountEach
        )
      ).to.be.revertedWith("Transfer failed");
    });

    it("Should batch send variable ERC20 amounts", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("150"), ethers.parseEther("250")];
      const totalAmount = amounts[0] + amounts[1];

      const tx = await batchTransfer.batchSendERC20Variable(
        await token.getAddress(),
        recipients,
        amounts
      );

      // Check event emission
      await expect(tx)
        .to.emit(batchTransfer, "ERC20BatchSent")
        .withArgs(await token.getAddress(), recipients.length, totalAmount);

      // Check recipient balances
      expect(await token.balanceOf(addr1.address)).to.equal(amounts[0]);
      expect(await token.balanceOf(addr2.address)).to.equal(amounts[1]);
    });

    it("Should revert when ERC20 transfer fails for variable batch send", async function () {
      // Use a contract that will revert on transfer
      const FailingContract = await ethers.getContractFactory("BenchmarkTarget");
      const failingContract = await FailingContract.deploy();
      await failingContract.waitForDeployment();

      const recipients = [await failingContract.getAddress()];
      const amounts = [ethers.parseEther("100")];

      await expect(
        batchTransfer.batchSendERC20Variable(
          await token.getAddress(),
          recipients,
          amounts
        )
      ).to.be.revertedWith("Transfer failed");
    });

    it("Should revert when recipients array is empty for ERC20 batch send", async function () {
      const recipients = [];
      const amountEach = ethers.parseEther("100");

      await expect(
        batchTransfer.batchSendERC20Equal(
          await token.getAddress(),
          recipients,
          amountEach
        )
      ).to.be.revertedWith("No recipients");
    });

    it("Should revert when recipients and amounts arrays have different lengths", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("100")];

      await expect(
        batchTransfer.batchSendERC20Variable(
          await token.getAddress(),
          recipients,
          amounts
        )
      ).to.be.revertedWith("Length mismatch");
    });
  });

  describe("Receive Function", function () {
    it("Should revert when ETH is sent directly to the contract", async function () {
      await expect(
        owner.sendTransaction({
          to: await batchTransfer.getAddress(),
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("Use batchSend functions");
    });
  });
});