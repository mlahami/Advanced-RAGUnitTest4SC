const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashToken", function () {
  let flashToken, borrower, owner, user1, user2;
  const NAME = "Flash Token";
  const SYMBOL = "FLASH";
  const INITIAL_SUPPLY = 1000000n;
  const FLASH_FEE_BPS = 10n;
  const MAX_FLASH_LOAN = 500000n;
  const DECIMALS = 18n;
  const ONE_TOKEN = 10n ** DECIMALS;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const FlashToken = await ethers.getContractFactory("FlashToken");
    flashToken = await FlashToken.deploy(NAME, SYMBOL, INITIAL_SUPPLY, FLASH_FEE_BPS, MAX_FLASH_LOAN);
    await flashToken.waitForDeployment();
    const Borrower = await ethers.getContractFactory("ExampleFlashBorrower");
    borrower = await Borrower.deploy();
    await borrower.waitForDeployment();
  });

  describe("ERC-20 Basics", function () {
    it("should set correct name, symbol, decimals", async function () {
      expect(await flashToken.name()).to.equal(NAME);
      expect(await flashToken.symbol()).to.equal(SYMBOL);
      expect(await flashToken.decimals()).to.equal(18n);
    });

    it("should mint initial supply to owner", async function () {
      const expected = INITIAL_SUPPLY * ONE_TOKEN;
      expect(await flashToken.totalSupply()).to.equal(expected);
      expect(await flashToken.balanceOf(owner.address)).to.equal(expected);
    });

    it("should transfer tokens", async function () {
      const amount = 100n * ONE_TOKEN;
      await flashToken.transfer(user1.address, amount);
      expect(await flashToken.balanceOf(user1.address)).to.equal(amount);
    });

    it("should revert transfer to zero address", async function () {
      await expect(flashToken.transfer(ethers.ZeroAddress, 100n)).to.be.revertedWithCustomError(flashToken, "ZeroAddress");
    });

    it("should revert transfer with insufficient balance", async function () {
      const tooMuch = (INITIAL_SUPPLY + 1n) * ONE_TOKEN;
      await expect(flashToken.transfer(user1.address, tooMuch)).to.be.revertedWithCustomError(flashToken, "InsufficientBalance");
    });

    it("should approve and transferFrom", async function () {
      const amount = 50n * ONE_TOKEN;
      await flashToken.approve(user1.address, amount);
      expect(await flashToken.allowance(owner.address, user1.address)).to.equal(amount);
      await flashToken.connect(user1).transferFrom(owner.address, user2.address, amount);
      expect(await flashToken.balanceOf(user2.address)).to.equal(amount);
    });

    it("should revert transferFrom with insufficient allowance", async function () {
      await flashToken.approve(user1.address, 10n);
      await expect(flashToken.connect(user1).transferFrom(owner.address, user2.address, 100n * ONE_TOKEN)).to.be.revertedWithCustomError(flashToken, "InsufficientAllowance");
    });
  });

  describe("Flash Loan (ERC-3156)", function () {
    it("should return correct maxFlashLoan", async function () {
      const max = await flashToken.maxFlashLoan(await flashToken.getAddress());
      expect(max).to.equal(MAX_FLASH_LOAN * ONE_TOKEN);
    });

    it("should return 0 maxFlashLoan for wrong token", async function () {
      expect(await flashToken.maxFlashLoan(user1.address)).to.equal(0n);
    });

    it("should return correct flashFee", async function () {
      const amount = 1000n * ONE_TOKEN;
      const expectedFee = (amount * FLASH_FEE_BPS) / 10000n;
      const fee = await flashToken.flashFee(await flashToken.getAddress(), amount);
      expect(fee).to.equal(expectedFee);
    });

    it("should revert flashFee for wrong token", async function () {
      await expect(flashToken.flashFee(user1.address, 100n)).to.be.revertedWithCustomError(flashToken, "UnsupportedToken");
    });

    it("should execute flash loan successfully", async function () {
      const loanAmount = 1000n * ONE_TOKEN;
      const fee = (loanAmount * FLASH_FEE_BPS) / 10000n;
      await flashToken.transfer(await borrower.getAddress(), fee);
      const tokenAddr = await flashToken.getAddress();
      await expect(borrower.executeFlashLoan(tokenAddr, tokenAddr, loanAmount)).to.emit(flashToken, "FlashLoan");
      expect(await flashToken.balanceOf(await borrower.getAddress())).to.equal(0n);
    });

    it("should revert flash loan exceeding max", async function () {
      const tooMuch = (MAX_FLASH_LOAN + 1n) * ONE_TOKEN;
      const tokenAddr = await flashToken.getAddress();
      await expect(borrower.executeFlashLoan(tokenAddr, tokenAddr, tooMuch)).to.be.revertedWithCustomError(flashToken, "FlashLoanExceedsMax");
    });

    it("should revert flash loan with zero amount", async function () {
      const tokenAddr = await flashToken.getAddress();
      await expect(borrower.executeFlashLoan(tokenAddr, tokenAddr, 0n)).to.be.revertedWithCustomError(flashToken, "ZeroAmount");
    });

    it("should track total fees collected", async function () {
      const loanAmount = 10000n * ONE_TOKEN;
      const fee = (loanAmount * FLASH_FEE_BPS) / 10000n;
      await flashToken.transfer(await borrower.getAddress(), fee);
      const tokenAddr = await flashToken.getAddress();
      await borrower.executeFlashLoan(tokenAddr, tokenAddr, loanAmount);
      expect(await flashToken.totalFeesCollected()).to.equal(fee);
    });
  });

  describe("Owner Functions", function () {
    it("should mint tokens (owner)", async function () {
      const amount = 500n * ONE_TOKEN;
      await flashToken.mint(user1.address, amount);
      expect(await flashToken.balanceOf(user1.address)).to.equal(amount);
    });

    it("should revert mint from non-owner", async function () {
      await expect(flashToken.connect(user1).mint(user1.address, 100n)).to.be.revertedWithCustomError(flashToken, "NotOwner");
    });

    it("should burn tokens", async function () {
      const burnAmount = 100n * ONE_TOKEN;
      const before = await flashToken.balanceOf(owner.address);
      await flashToken.burn(burnAmount);
      expect(await flashToken.balanceOf(owner.address)).to.equal(before - burnAmount);
    });

    it("should update flash fee", async function () {
      await flashToken.setFlashFee(50n);
      expect(await flashToken.flashFeeBps()).to.equal(50n);
    });

    it("should revert setting fee too high", async function () {
      await expect(flashToken.setFlashFee(1001n)).to.be.revertedWithCustomError(flashToken, "FeeTooHigh");
    });

    it("should update max flash loan", async function () {
      await flashToken.setMaxFlashLoan(1000000n);
      expect(await flashToken.maxFlashLoanAmount()).to.equal(1000000n * ONE_TOKEN);
    });

    it("should set unlimited max flash loan with 0", async function () {
      await flashToken.setMaxFlashLoan(0n);
      expect(await flashToken.maxFlashLoanAmount()).to.equal(ethers.MaxUint256);
    });

    it("should update fee receiver", async function () {
      await flashToken.setFeeReceiver(user2.address);
      expect(await flashToken.feeReceiver()).to.equal(user2.address);
    });

    it("should transfer ownership", async function () {
      await flashToken.transferOwnership(user1.address);
      expect(await flashToken.owner()).to.equal(user1.address);
    });

    it("should revert ownership transfer to zero address", async function () {
      await expect(flashToken.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(flashToken, "ZeroAddress");
    });
  });

  describe("Flash Loan Info", function () {
    it("should return correct info", async function () {
      const [maxLoan, feeBps, feeRecv, totalFees] = await flashToken.flashLoanInfo();
      expect(maxLoan).to.equal(MAX_FLASH_LOAN * ONE_TOKEN);
      expect(feeBps).to.equal(FLASH_FEE_BPS);
      expect(feeRecv).to.equal(owner.address);
      expect(totalFees).to.equal(0n);
    });
  });
});
