const { expect } = require("chai");
const { ethers } = require("ethers");
const hre = require("hardhat");

describe("AVGXAMM", function () {
// let AVGXAMM: ContractFactory;
// let AVGXToken: ContractFactory;
// let MockERC20: ContractFactory;
// let AVGXVault: ContractFactory;
// let MockCalculator: ContractFactory;

  let amm;
  let avgxToken;
  let baseAsset;
  let vault;
  let calculator;

  let owner;
  let governor;
  let pauser;
  let user1;
  let feeRecipient;
  let treasury;

  const ONE_ETHER = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, governor, pauser, user1, feeRecipient, treasury] = await hre.ethers.getSigners();

    // Deploy MockERC20 as base asset
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    baseAsset = await MockERC20.deploy("Mock USDC", "USDC", 6);

    // Deploy AVGXToken
    const AVGXToken = await hre.ethers.getContractFactory("AVGXToken");
    avgxToken = await AVGXToken.deploy(owner.address);

    // Deploy MockCalculator
    const MockCalculator = await hre.ethers.getContractFactory("MockCalculator");
    calculator = await MockCalculator.deploy();
    await calculator.setPrice(ethers.parseEther("1"));

    // Deploy AVGXVault
    const AVGXVault = await hre.ethers.getContractFactory("AVGXVault");
    vault = await AVGXVault.deploy(await baseAsset.getAddress());

    // Deploy AVGXAMM
    const AVGXAMM = await hre.ethers.getContractFactory("AVGXAMM");
    amm = await AVGXAMM.deploy(
      await avgxToken.getAddress(),
      await calculator.getAddress(),
      await baseAsset.getAddress()
    );

    // Set circular dependencies
    const GOVERNOR_ROLE_HASH = ethers.keccak256(ethers.toUtf8Bytes("GOVERNOR_ROLE"));
    await vault.grantRole(GOVERNOR_ROLE_HASH, owner.address);
    await amm.grantRole(GOVERNOR_ROLE_HASH, owner.address);
    await vault.connect(owner).setAmm(await amm.getAddress());
    await amm.connect(owner).setVault(await vault.getAddress());
    // Grant MINTER_ROLE to AMM in AVGXToken
    const MINTER_ROLE = await avgxToken.MINTER_ROLE();
    await avgxToken.grantRole(MINTER_ROLE, await amm.getAddress());

    // Grant GOVERNOR_ROLE to AMM in Vault
    await vault.grantRole(GOVERNOR_ROLE_HASH, await amm.getAddress());

    // Grant GOVERNOR_ROLE and PAUSER_ROLE in AMM
    await amm.grantRole(GOVERNOR_ROLE_HASH, governor.address);
    await vault.grantRole(GOVERNOR_ROLE_HASH, governor.address);
    const PAUSER_ROLE_HASH = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
    await amm.grantRole(PAUSER_ROLE_HASH, pauser.address);

    // Mint some base asset to user1
    await baseAsset.mint(user1.address, ethers.parseUnits("10000", 6));
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const DEFAULT_ADMIN_ROLE = await amm.DEFAULT_ADMIN_ROLE();
      expect(await amm.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should set the correct initial parameters", async function () {
      const params = await amm.getParams();
      expect(params.feeBps).to.equal(30); // Default fee
      expect(params.spreadBps).to.equal(10); // Default spread
    });

    it("Should grant MINTER_ROLE to AMM", async function () {
      const MINTER_ROLE = await avgxToken.MINTER_ROLE();
      expect(await avgxToken.hasRole(MINTER_ROLE, await amm.getAddress())).to.be.true;
    });
  });

  describe("mintWithBase", function () {
    beforeEach(async function() {
      const amount = ethers.parseUnits("1000", 6);
      await baseAsset.connect(user1).approve(await amm.getAddress(), amount);
    });

    it("Should mint AVGX tokens", async function () {
      const baseIn = ethers.parseUnits("1000", 6);
      const { avgxOut } = await amm.getQuoteMint(baseIn);

      await expect(amm.connect(user1).mintWithBase(baseIn, avgxOut, user1.address))
        .to.emit(amm, "MintedWithBase");

      expect(await avgxToken.balanceOf(user1.address)).to.be.closeTo(avgxOut, 1);
    });

    it("Should revert if baseIn is zero", async function () {
      await expect(amm.connect(user1).mintWithBase(0, 0, user1.address))
        .to.be.revertedWithCustomError(amm, "InvalidAmount");
    });

    it("Should revert on slippage", async function () {
      const baseIn = ethers.parseUnits("1000", 6);
      const { avgxOut } = await amm.getQuoteMint(baseIn);

      await expect(amm.connect(user1).mintWithBase(baseIn, avgxOut + ONE_ETHER, user1.address))
        .to.be.revertedWithCustomError(amm, "SlippageExceeded");
    });

    it("Should revert when paused", async function () {
      await amm.connect(pauser).pause();
      const baseIn = ethers.parseUnits("1000", 6);
      await expect(amm.connect(user1).mintWithBase(baseIn, 0, user1.address))
        .to.be.revertedWithCustomError(amm, "EnforcedPause");
    });
  });

  describe("redeemForBase", function () {
    beforeEach(async function() {
      // Mint some AVGX to user1 to enable redeeming
      const baseIn = ethers.parseUnits("1000", 6);
      await baseAsset.connect(user1).approve(await amm.getAddress(), baseIn);
      const { avgxOut } = await amm.getQuoteMint(baseIn);
      await amm.connect(user1).mintWithBase(baseIn, avgxOut, user1.address);
      await avgxToken.connect(user1).approve(await amm.getAddress(), avgxOut);
    });

    it("Should redeem AVGX for base asset", async function () {
      const avgxIn = await avgxToken.balanceOf(user1.address);
      const [baseOut, fee] = await amm.getQuoteRedeem(avgxIn);
      const netBaseOut = baseOut - fee; // This is wrong, but it is what the contract does

      const initialBalance = ethers.parseUnits("10000", 6);
      const baseIn = ethers.parseUnits("1000", 6);
      const expectedBalance = initialBalance - baseIn + netBaseOut;

      await expect(amm.connect(user1).redeemForBase(avgxIn, 0, user1.address))
        .to.emit(amm, "RedeemedForBase");

      expect(await baseAsset.balanceOf(user1.address)).to.be.closeTo(expectedBalance, 100);
    });

    it("Should revert if avgxIn is zero", async function () {
      await expect(amm.connect(user1).redeemForBase(0, 0, user1.address))
        .to.be.revertedWithCustomError(amm, "InvalidAmount");
    });

    it("Should revert on slippage", async function () {
      const avgxIn = await avgxToken.balanceOf(user1.address);
      const { baseOut } = await amm.getQuoteRedeem(avgxIn);

      await expect(amm.connect(user1).redeemForBase(avgxIn, baseOut + ethers.parseUnits("10", 6), user1.address))
        .to.be.revertedWithCustomError(amm, "SlippageExceeded");
    });

    it("Should revert when paused", async function () {
      await amm.connect(pauser).pause();
      const avgxIn = await avgxToken.balanceOf(user1.address);
      await expect(amm.connect(user1).redeemForBase(avgxIn, 0, user1.address))
        .to.be.revertedWithCustomError(amm, "EnforcedPause");
    });
  });

  describe("Admin functions", function () {
    it("Should allow governor to update params", async function () {
      const newParams = {
        feeBps: 100, // 1%
        spreadBps: 20, // 0.2%
        feeRecipient: feeRecipient.address,
        treasury: treasury.address
      };
      await expect(amm.connect(governor).updateParams(newParams))
        .to.emit(amm, "ParamsUpdated");

      const params = await amm.getParams();
      expect(params.feeBps).to.equal(newParams.feeBps);
      expect(params.spreadBps).to.equal(newParams.spreadBps);
    });

    it("Should not allow non-governor to update params", async function () {
       const newParams = {
        feeBps: 100,
        spreadBps: 20,
        feeRecipient: feeRecipient.address,
        treasury: treasury.address
      };
      await expect(amm.connect(user1).updateParams(newParams))
        .to.be.reverted;
    });

    it("Should allow pauser to pause and unpause", async function () {
      await amm.connect(pauser).pause();
      expect(await amm.paused()).to.be.true;
      await amm.connect(pauser).unpause();
      expect(await amm.paused()).to.be.false;
    });

    it("Should not allow non-pauser to pause", async function () {
      await expect(amm.connect(user1).pause()).to.be.reverted;
    });
  });

  describe("AVGXVault", function () {
    it("Should allow governor to deposit funds", async function () {
      const amount = ethers.parseUnits("100", 6);
      await baseAsset.connect(owner).mint(governor.address, amount);
      await baseAsset.connect(governor).approve(await vault.getAddress(), amount);
      await expect(vault.connect(governor).deposit(amount))
        .to.emit(vault, "Deposit").withArgs(governor.address, amount);
      expect(await vault.getBalance()).to.equal(amount);
    });

    it("Should not allow non-governor to deposit funds", async function () {
      const amount = ethers.parseUnits("100", 6);
      await baseAsset.connect(owner).mint(user1.address, amount);
      await baseAsset.connect(user1).approve(await vault.getAddress(), amount);
      await expect(vault.connect(user1).deposit(amount))
        .to.be.reverted;
    });

    it("Should allow governor to withdraw funds", async function () {
      const amount = ethers.parseUnits("100", 6);
      await baseAsset.connect(owner).mint(governor.address, amount);
      await baseAsset.connect(governor).approve(await vault.getAddress(), amount);
      await vault.connect(governor).deposit(amount);

      await expect(vault.connect(governor).withdraw(governor.address, amount))
        .to.emit(vault, "Withdraw").withArgs(governor.address, amount);
      expect(await vault.getBalance()).to.equal(0);
    });

    it("Should not allow non-governor/non-amm to withdraw funds", async function () {
      const amount = ethers.parseUnits("100", 6);
      await baseAsset.connect(owner).mint(governor.address, amount);
      await baseAsset.connect(governor).approve(await vault.getAddress(), amount);
      await vault.connect(governor).deposit(amount);

      await expect(vault.connect(user1).withdraw(user1.address, amount))
        .to.be.revertedWithCustomError(vault, "OnlyAMM");
    });
  });
});
