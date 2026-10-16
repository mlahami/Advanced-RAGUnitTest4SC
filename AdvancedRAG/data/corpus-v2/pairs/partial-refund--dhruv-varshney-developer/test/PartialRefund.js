const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PartialRefund", function () {
  let PartialRefund;
  let owner, addr1, addr2;
  let PartialRefundAddress;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const Partialrefund = await ethers.getContractFactory("PartialRefund");
    PartialRefund = await Partialrefund.deploy();
    await PartialRefund.waitForDeployment();

    PartialRefundAddress = await PartialRefund.getAddress();
    console.log("PartialRefund deployed to:", PartialRefundAddress);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await PartialRefund.owner()).to.equal(owner.address);
    });

    it("Should have correct name and symbol", async function () {
      expect(await PartialRefund.name()).to.equal("DeeVee");
      expect(await PartialRefund.symbol()).to.equal("DV");
    });

    it("Should have zero initial supply", async function () {
      expect(await PartialRefund.totalSupply()).to.equal(0);
    });
  });

  describe("mintTokensToAddress", function () {
    it("Should allow owner to mint tokens", async function () {
      await PartialRefund.mintTokensToAddress(addr1.address, 1000);
      expect(await PartialRefund.balanceOf(addr1.address)).to.equal(1000);
    });

    it("Should not allow non-owner to mint tokens", async function () {
      await expect(
        PartialRefund.connect(addr1).mintTokensToAddress(addr2.address, 1000),
      ).to.be.revertedWithCustomError(
        PartialRefund,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("buyTokens", function () {
    it("Should allow users to buy tokens", async function () {
      await PartialRefund.connect(addr2).buyTokens({
        value: ethers.parseEther("1.0"),
      });
      expect(await PartialRefund.balanceOf(addr2.address)).to.equal(
        ethers.parseEther("1000"),
      );
    });

    it("Should revert if exceeds maximum supply", async function () {
      const maxSupply = await PartialRefund.MAX_SUPPLY();
      const exceedingAmount = maxSupply / BigInt(1000) + BigInt(1);
      await expect(
        PartialRefund.connect(addr1).buyTokens({ value: exceedingAmount }),
      ).to.be.revertedWith("Exceeds maximum supply");
    });
    it("Should allow buying tokens when not exceeding max supply", async function () {
      const buyAmount = ethers.parseEther("0.1"); // 100 tokens
      await PartialRefund.connect(addr1).buyTokens({ value: buyAmount });
      expect(await PartialRefund.balanceOf(addr1.address)).to.equal(
        ethers.parseEther("100"),
      );
    });
  });

  describe("withdrawableEther", function () {
    it("Should return correct withdrawable amount", async function () {
      // Buy tokens to increase total supply
      await PartialRefund.connect(addr1).buyTokens({
        value: ethers.parseEther("10.0"),
      });

      const totalSupply = await PartialRefund.totalSupply();
      const requiredEtherForSellBack =
        (totalSupply * BigInt(5)) / BigInt(10000);
      const contractBalance =
        await ethers.provider.getBalance(PartialRefundAddress);

      const expectedWithdrawable = contractBalance - requiredEtherForSellBack;
      const actualWithdrawable = await PartialRefund.withdrawableEther();

      // Use closeTo matcher to allow for small differences due to gas fees
      expect(actualWithdrawable).to.be.closeTo(
        expectedWithdrawable,
        ethers.parseEther("0.01"), // Allow for a difference of up to 0.001 ether
      );
    });

    it("Should return zero if no withdrawable ether", async function () {
      expect(await PartialRefund.withdrawableEther()).to.equal(0);
    });
  });

  describe("withdrawFunds", function () {
    beforeEach(async function () {
      await PartialRefund.connect(addr1).buyTokens({
        value: ethers.parseEther("10.0"),
      });
    });

    it("Should allow owner to withdraw funds", async function () {
      const initialBalance = await ethers.provider.getBalance(owner.address);
      await PartialRefund.withdrawFunds(ethers.parseEther("5.0"));
      const finalBalance = await ethers.provider.getBalance(owner.address);
      expect(finalBalance).to.be.greaterThan(initialBalance);
    });

    it("Should not allow non-owner to withdraw funds", async function () {
      await expect(
        PartialRefund.connect(addr1).withdrawFunds(ethers.parseEther("5.0")),
      ).to.be.revertedWithCustomError(
        PartialRefund,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should revert if amount exceeds withdrawable limit", async function () {
      await expect(
        PartialRefund.withdrawFunds(ethers.parseEther("11.0")),
      ).to.be.revertedWith("Amount exceeds withdrawable limit");
    });
  });

  describe("sellBack", function () {
    beforeEach(async function () {
      await PartialRefund.mintTokensToAddress(
        addr1.address,
        ethers.parseEther("1000"),
      );
    });

    it("Should revert if the amount is zero", async function () {
      await expect(PartialRefund.connect(addr1).sellBack(0)).to.be.revertedWith(
        "Amount must be greater than zero",
      );
    });

    it("Should revert if the contract does not have enough ether", async function () {
      await expect(
        PartialRefund.connect(addr1).sellBack(500),
      ).to.be.revertedWith("Contract does not have enough ether");
    });

    it("Should sell back tokens and transfer ether", async function () {
      await PartialRefund.connect(owner).buyTokens({
        value: ethers.parseEther("10.0"),
      });
      const initialBalance = await ethers.provider.getBalance(addr1.address);
      const initialContractBalance =
        await ethers.provider.getBalance(PartialRefundAddress);

      await PartialRefund.connect(addr1).sellBack(500);

      const finalBalance = await ethers.provider.getBalance(addr1.address);
      const finalContractBalance =
        await ethers.provider.getBalance(PartialRefundAddress);

      expect(finalContractBalance).to.equal(
        initialContractBalance - ethers.parseEther("0.25"),
      );
      expect(finalBalance).to.be.closeTo(
        initialBalance + ethers.parseEther("0.25"),
        ethers.parseEther("0.01"),
      );
    });

    it("Should allow selling back tokens when contract has sufficient ether", async function () {
      // First, ensure the contract has enough ether
      await owner.sendTransaction({
        to: PartialRefundAddress,
        value: ethers.parseEther("10.0"),
      });

      const initialBalance = await ethers.provider.getBalance(addr1.address);

      await PartialRefund.connect(addr1).sellBack(100);

      const finalBalance = await ethers.provider.getBalance(addr1.address);
      expect(finalBalance).to.be.gt(initialBalance);
      expect(await PartialRefund.balanceOf(addr1.address)).to.equal(
        ethers.parseEther("1000") - BigInt(100),
      );
    });
  });

  describe("receive", function () {
    it("Should accept ether", async function () {
      const initialBalance =
        await ethers.provider.getBalance(PartialRefundAddress);
      await owner.sendTransaction({
        to: PartialRefundAddress,
        value: ethers.parseEther("1.0"),
      });
      const finalBalance =
        await ethers.provider.getBalance(PartialRefundAddress);
      expect(finalBalance).to.equal(initialBalance + ethers.parseEther("1.0"));
    });
  });
});
