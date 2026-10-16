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
    await token.mint(owner.address, ethers.parseEther("1000"));
    await token.approve(await batchTransfer.getAddress(), ethers.parseEther("1000"));
  });

  describe("ETH Batch Sending", function () {
    it("Should send equal ETH amounts to multiple recipients", async function () {
      const recipients = [addr1.address, addr2.address, addr3.address];
      const amountEach = ethers.parseEther("1");

      const initialBalances = await Promise.all(
        recipients.map(addr => ethers.provider.getBalance(addr))
      );

      const tx = await batchTransfer.batchSendEqual(
        recipients,
        amountEach,
        { value: ethers.parseEther("3") }
      );

      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(3n, ethers.parseEther("3"));

      const finalBalances = await Promise.all(
        recipients.map(addr => ethers.provider.getBalance(addr))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amountEach);
      }
    });

    it("Should revert if ETH amount is incorrect for equal distribution", async function () {
      const recipients = [addr1.address, addr2.address];
      const amountEach = ethers.parseEther("1");

      await expect(
        batchTransfer.batchSendEqual(
          recipients,
          amountEach,
          { value: ethers.parseEther("1.5") }
        )
      ).to.be.revertedWith("Wrong ETH");
    });

    it("Should revert if no recipients for equal distribution", async function () {
      await expect(
        batchTransfer.batchSendEqual(
          [],
          ethers.parseEther("1"),
          { value: ethers.parseEther("0") }
        )
      ).to.be.revertedWith("No recipients");
    });

    it("Should send variable ETH amounts to multiple recipients", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];

      const initialBalances = await Promise.all(
        recipients.map(addr => ethers.provider.getBalance(addr))
      );

      const tx = await batchTransfer.batchSendVariable(
        recipients,
        amounts,
        { value: ethers.parseEther("3") }
      );

      await expect(tx)
        .to.emit(batchTransfer, "ETHBatchSent")
        .withArgs(2n, ethers.parseEther("3"));

      const finalBalances = await Promise.all(
        recipients.map(addr => ethers.provider.getBalance(addr))
      );

      expect(finalBalances[0]).to.equal(initialBalances[0] + amounts[0]);
      expect(finalBalances[1]).to.equal(initialBalances[1] + amounts[1]);
    });

    it("Should revert if ETH amount is incorrect for variable distribution", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1"), ethers.parseEther("2")];

      await expect(
        batchTransfer.batchSendVariable(
          recipients,
          amounts,
          { value: ethers.parseEther("2.5") }
        )
      ).to.be.revertedWith("Wrong ETH");
    });

    it("Should revert if recipient and amount arrays length mismatch", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("1")];

      await expect(
        batchTransfer.batchSendVariable(
          recipients,
          amounts,
          { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWith("Length mismatch");
    });
  });

  describe("ERC20 Batch Sending", function () {
    it("Should send equal ERC20 amounts to multiple recipients", async function () {
      const recipients = [addr1.address, addr2.address, addr3.address];
      const amountEach = ethers.parseEther("10");

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
        .withArgs(await token.getAddress(), 3n, ethers.parseEther("30"));

      const finalBalances = await Promise.all(
        recipients.map(addr => token.balanceOf(addr))
      );

      for (let i = 0; i < recipients.length; i++) {
        expect(finalBalances[i]).to.equal(initialBalances[i] + amountEach);
      }
    });

    it("Should revert if no recipients for equal ERC20 distribution", async function () {
      await expect(
        batchTransfer.batchSendERC20Equal(
          await token.getAddress(),
          [],
          ethers.parseEther("10")
        )
      ).to.be.revertedWith("No recipients");
    });

    it("Should send variable ERC20 amounts to multiple recipients", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("10"), ethers.parseEther("20")];

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
        .withArgs(await token.getAddress(), 2n, ethers.parseEther("30"));

      const finalBalances = await Promise.all(
        recipients.map(addr => token.balanceOf(addr))
      );

      expect(finalBalances[0]).to.equal(initialBalances[0] + amounts[0]);
      expect(finalBalances[1]).to.equal(initialBalances[1] + amounts[1]);
    });

    it("Should revert if recipient and amount arrays length mismatch for ERC20", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("10")];

      await expect(
        batchTransfer.batchSendERC20Variable(
          await token.getAddress(),
          recipients,
          amounts
        )
      ).to.be.revertedWith("Length mismatch");
    });
  });

  describe("Security", function () {
    it("Should revert when sending ETH directly to contract", async function () {
      await expect(
        owner.sendTransaction({
          to: await batchTransfer.getAddress(),
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("Use batchSend functions");
    });
  });
});