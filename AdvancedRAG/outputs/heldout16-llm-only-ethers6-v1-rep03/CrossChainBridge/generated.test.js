const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let bridge, token, owner, user1, user2, validator1, validator2, validator3;
  const bridgeFee = ethers.parseEther("0.1");
  const requiredSignatures = 2n;
  const amount = 100n;
  const targetChainId = 1337n;

  beforeEach(async function () {
    [owner, user1, user2, validator1, validator2, validator3] = await ethers.getSigners();

    // Deploy token
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Deploy bridge
    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await Bridge.deploy(await token.getAddress(), requiredSignatures, bridgeFee);
    await bridge.waitForDeployment();

    // Setup validators
    await bridge.addValidator(validator1.address);
    await bridge.addValidator(validator2.address);
    await bridge.addValidator(validator3.address);

    // Mint tokens to users
    await token.mint(user1.address, amount * 10n);
    await token.mint(user2.address, amount * 10n);

    // Approve bridge to spend tokens
    await token.connect(user1).approve(await bridge.getAddress(), ethers.MaxUint256);
    await token.connect(user2).approve(await bridge.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await bridge.owner()).to.equal(owner.address);
    });

    it("Should set the correct token address", async function () {
      expect(await bridge.token()).to.equal(await token.getAddress());
    });

    it("Should set the correct required signatures", async function () {
      expect(await bridge.requiredSignatures()).to.equal(requiredSignatures);
    });

    it("Should set the correct bridge fee", async function () {
      expect(await bridge.bridgeFee()).to.equal(bridgeFee);
    });
  });

  describe("Validator Management", function () {
    it("Should allow owner to add validators", async function () {
      const newValidator = user1.address;
      await bridge.addValidator(newValidator);
      expect(await bridge.isValidator(newValidator)).to.be.true;
    });

    it("Should not allow non-owner to add validators", async function () {
      await expect(bridge.connect(user1).addValidator(user2.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should not allow adding existing validators", async function () {
      await expect(bridge.addValidator(validator1.address))
        .to.be.revertedWith("Already validator");
    });

    it("Should allow owner to remove validators", async function () {
      await bridge.removeValidator(validator1.address);
      expect(await bridge.isValidator(validator1.address)).to.be.false;
    });

    it("Should not allow non-owner to remove validators", async function () {
      await expect(bridge.connect(user1).removeValidator(validator1.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should not allow removing non-validators", async function () {
      await expect(bridge.removeValidator(user1.address))
        .to.be.revertedWith("Not validator");
    });

    it("Should update validator count correctly", async function () {
      expect(await bridge.validatorCount()).to.equal(3n);
      await bridge.addValidator(user1.address);
      expect(await bridge.validatorCount()).to.equal(4n);
      await bridge.removeValidator(validator1.address);
      expect(await bridge.validatorCount()).to.equal(3n);
    });
  });

  describe("Lock Function", function () {
    it("Should lock tokens and emit Locked event", async function () {
      const initialBalance = await token.balanceOf(user1.address);
      const tx = await bridge.connect(user1).lock(user2.address, amount, targetChainId, { value: bridgeFee });
      const receipt = await tx.wait();

      expect(await token.balanceOf(user1.address)).to.equal(initialBalance - amount);
      expect(await bridge.collectedFees()).to.equal(bridgeFee);

      const requestId = receipt.logs[0].topics[1];
      const event = await bridge.queryFilter(bridge.filters.Locked(), receipt.blockNumber, receipt.blockNumber);
      expect(event[0].args.requestId).to.equal(requestId);
      expect(event[0].args.sender).to.equal(user1.address);
      expect(event[0].args.recipient).to.equal(user2.address);
      expect(event[0].args.amount).to.equal(amount);
      expect(event[0].args.targetChainId).to.equal(targetChainId);
    });

    it("Should revert if insufficient fee", async function () {
      await expect(bridge.connect(user1).lock(user2.address, amount, targetChainId, { value: bridgeFee - 1n }))
        .to.be.revertedWith("Insufficient fee");
    });

    it("Should revert if zero amount", async function () {
      await expect(bridge.connect(user1).lock(user2.address, 0n, targetChainId, { value: bridgeFee }))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert if zero recipient", async function () {
      await expect(bridge.connect(user1).lock(ethers.ZeroAddress, amount, targetChainId, { value: bridgeFee }))
        .to.be.revertedWith("Zero recipient");
    });
  });

  describe("Validate Function", function () {
    let requestId;

    beforeEach(async function () {
      const tx = await bridge.connect(user1).lock(user2.address, amount, targetChainId, { value: bridgeFee });
      const receipt = await tx.wait();
      requestId = receipt.logs[0].topics[1];
    });

    it("Should allow validators to validate requests", async function () {
      await bridge.connect(validator1).validate(requestId);
      expect(await bridge.hasValidated(requestId, validator1.address)).to.be.true;
      expect(await bridge.validationCount(requestId)).to.equal(1n);
    });

    it("Should not allow non-validators to validate", async function () {
      await expect(bridge.connect(user1).validate(requestId))
        .to.be.revertedWith("Not validator");
    });

    it("Should not allow double validation", async function () {
      await bridge.connect(validator1).validate(requestId);
      await expect(bridge.connect(validator1).validate(requestId))
        .to.be.revertedWith("Already validated");
    });

    it("Should mint tokens when enough validations", async function () {
      const initialBalance = await token.balanceOf(user2.address);
      await bridge.connect(validator1).validate(requestId);
      await bridge.connect(validator2).validate(requestId);

      expect(await token.balanceOf(user2.address)).to.equal(initialBalance + amount);

      const event = await bridge.queryFilter(bridge.filters.Minted(), -1, "latest");
      expect(event[0].args.requestId).to.equal(requestId);
      expect(event[0].args.recipient).to.equal(user2.address);
      expect(event[0].args.amount).to.equal(amount);
    });

    it("Should not allow validation of processed requests", async function () {
      await bridge.connect(validator1).validate(requestId);
      await bridge.connect(validator2).validate(requestId);
      await expect(bridge.connect(validator3).validate(requestId))
        .to.be.revertedWith("Already processed");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set required signatures", async function () {
      await bridge.setRequiredSignatures(3n);
      expect(await bridge.requiredSignatures()).to.equal(3n);
    });

    it("Should not allow non-owner to set required signatures", async function () {
      await expect(bridge.connect(user1).setRequiredSignatures(3n))
        .to.be.revertedWith("Not owner");
    });

    it("Should revert if required signatures is zero", async function () {
      await expect(bridge.setRequiredSignatures(0n))
        .to.be.revertedWith("Invalid threshold");
    });

    it("Should revert if required signatures exceeds validator count", async function () {
      await expect(bridge.setRequiredSignatures(4n))
        .to.be.revertedWith("Invalid threshold");
    });

    it("Should allow owner to withdraw fees", async function () {
      await bridge.connect(user1).lock(user2.address, amount, targetChainId, { value: bridgeFee });
      const initialBalance = await ethers.provider.getBalance(owner.address);

      const tx = await bridge.withdrawFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await bridge.collectedFees()).to.equal(0n);
      expect(await ethers.provider.getBalance(owner.address)).to.equal(initialBalance + bridgeFee - gasUsed);
    });

    it("Should not allow non-owner to withdraw fees", async function () {
      await expect(bridge.connect(user1).withdrawFees())
        .to.be.revertedWith("Not owner");
    });
  });
});