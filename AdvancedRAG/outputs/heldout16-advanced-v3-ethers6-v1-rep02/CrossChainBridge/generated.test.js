const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let bridge;
  let token;
  let owner;
  let validator1;
  let validator2;
  let validator3;
  let user;
  let other;

  const BRIDGE_FEE = ethers.parseEther("0.1");
  const TARGET_CHAIN_ID = 1337n;
  const AMOUNT = 100n;
  const ZERO_ADDRESS = ethers.ZeroAddress;

  beforeEach(async function () {
    [owner, validator1, validator2, validator3, user, other] = await ethers.getSigners();

    // Deploy token fixture
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to user and approve bridge
    await token.mint(user.address, AMOUNT * 10n);
    await token.connect(user).approve(owner.address, AMOUNT * 10n);

    // Deploy bridge
    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await Bridge.deploy(await token.getAddress(), 2n, BRIDGE_FEE);
    await bridge.waitForDeployment();

    // Add validators
    await bridge.addValidator(validator1.address);
    await bridge.addValidator(validator2.address);
    await bridge.addValidator(validator3.address);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await bridge.owner()).to.equal(owner.address);
    });

    it("Should set the correct token address", async function () {
      expect(await bridge.token()).to.equal(await token.getAddress());
    });

    it("Should set the correct required signatures", async function () {
      expect(await bridge.requiredSignatures()).to.equal(2n);
    });

    it("Should set the correct bridge fee", async function () {
      expect(await bridge.bridgeFee()).to.equal(BRIDGE_FEE);
    });
  });

  describe("Validator Management", function () {
    it("Should allow owner to add validators", async function () {
      await expect(bridge.addValidator(other.address))
        .to.emit(bridge, "ValidatorAdded")
        .withArgs(other.address);

      expect(await bridge.isValidator(other.address)).to.be.true;
      expect(await bridge.validatorCount()).to.equal(4n);
    });

    it("Should prevent adding existing validators", async function () {
      await expect(bridge.addValidator(validator1.address))
        .to.be.revertedWith("Already validator");
    });

    it("Should allow owner to remove validators", async function () {
      await expect(bridge.removeValidator(validator1.address))
        .to.emit(bridge, "ValidatorRemoved")
        .withArgs(validator1.address);

      expect(await bridge.isValidator(validator1.address)).to.be.false;
      expect(await bridge.validatorCount()).to.equal(2n);
    });

    it("Should prevent removing non-validators", async function () {
      await expect(bridge.removeValidator(other.address))
        .to.be.revertedWith("Not validator");
    });

    it("Should prevent non-owners from adding validators", async function () {
      await expect(bridge.connect(user).addValidator(other.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should prevent non-owners from removing validators", async function () {
      await expect(bridge.connect(user).removeValidator(validator1.address))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Signature Threshold", function () {
    it("Should allow owner to set required signatures", async function () {
      await bridge.setRequiredSignatures(3n);
      expect(await bridge.requiredSignatures()).to.equal(3n);
    });

    it("Should prevent setting threshold to zero", async function () {
      await expect(bridge.setRequiredSignatures(0n))
        .to.be.revertedWith("Invalid threshold");
    });

    it("Should prevent setting threshold above validator count", async function () {
      await expect(bridge.setRequiredSignatures(4n))
        .to.be.revertedWith("Invalid threshold");
    });

    it("Should prevent non-owners from setting threshold", async function () {
      await expect(bridge.connect(user).setRequiredSignatures(3n))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Locking Tokens", function () {
    it("Should lock tokens and emit Locked event", async function () {
      const recipient = other.address;
      const amount = AMOUNT;

      const tx = await bridge.connect(user).lock(recipient, amount, TARGET_CHAIN_ID, { value: BRIDGE_FEE });
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "Locked");

      expect(event.args.sender).to.equal(user.address);
      expect(event.args.recipient).to.equal(recipient);
      expect(event.args.amount).to.equal(amount);
      expect(event.args.targetChainId).to.equal(TARGET_CHAIN_ID);

      // Check state changes
      const requestId = event.args.requestId;
      const request = await bridge.requests(requestId);
      expect(request.sender).to.equal(user.address);
      expect(request.recipient).to.equal(recipient);
      expect(request.amount).to.equal(amount);
      expect(request.targetChainId).to.equal(TARGET_CHAIN_ID);
      expect(request.processed).to.be.false;

      // Check token balances
      expect(await token.balanceOf(user.address)).to.equal(AMOUNT * 10n - amount);
      expect(await token.balanceOf(await bridge.getAddress())).to.equal(amount);

      // Check fees
      expect(await bridge.collectedFees()).to.equal(BRIDGE_FEE);
    });

    it("Should prevent locking with insufficient fee", async function () {
      await expect(bridge.connect(user).lock(other.address, AMOUNT, TARGET_CHAIN_ID, { value: BRIDGE_FEE - 1n }))
        .to.be.revertedWith("Insufficient fee");
    });

    it("Should prevent locking zero amount", async function () {
      await expect(bridge.connect(user).lock(other.address, 0n, TARGET_CHAIN_ID, { value: BRIDGE_FEE }))
        .to.be.revertedWith("Zero amount");
    });

    it("Should prevent locking to zero address", async function () {
      await expect(bridge.connect(user).lock(ZERO_ADDRESS, AMOUNT, TARGET_CHAIN_ID, { value: BRIDGE_FEE }))
        .to.be.revertedWith("Zero recipient");
    });
  });

  describe("Validation and Minting", function () {
    let requestId;

    beforeEach(async function () {
      const tx = await bridge.connect(user).lock(other.address, AMOUNT, TARGET_CHAIN_ID, { value: BRIDGE_FEE });
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "Locked");
      requestId = event.args.requestId;
    });

    it("Should allow validators to validate requests", async function () {
      // First validation
      await expect(bridge.connect(validator1).validate(requestId))
        .to.not.emit(bridge, "Minted");

      expect(await bridge.hasValidated(requestId, validator1.address)).to.be.true;
      expect(await bridge.validationCount(requestId)).to.equal(1n);

      // Second validation should trigger minting
      const tx = await bridge.connect(validator2).validate(requestId);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "Minted");

      expect(event.args.requestId).to.equal(requestId);
      expect(event.args.recipient).to.equal(other.address);
      expect(event.args.amount).to.equal(AMOUNT);

      // Check state changes
      const request = await bridge.requests(requestId);
      expect(request.processed).to.be.true;

      // Check token balances
      expect(await token.balanceOf(other.address)).to.equal(AMOUNT);
    });

    it("Should prevent non-validators from validating", async function () {
      await expect(bridge.connect(user).validate(requestId))
        .to.be.revertedWith("Not validator");
    });

    it("Should prevent validating already processed requests", async function () {
      // First validate to trigger processing
      await bridge.connect(validator1).validate(requestId);
      await bridge.connect(validator2).validate(requestId);

      // Try to validate again
      await expect(bridge.connect(validator3).validate(requestId))
        .to.be.revertedWith("Already processed");
    });

    it("Should prevent double validation from same validator", async function () {
      await bridge.connect(validator1).validate(requestId);
      await expect(bridge.connect(validator1).validate(requestId))
        .to.be.revertedWith("Already validated");
    });
  });

  describe("Fee Withdrawal", function () {
    it("Should allow owner to withdraw fees", async function () {
      // Create some lock transactions to collect fees
      await bridge.connect(user).lock(other.address, AMOUNT, TARGET_CHAIN_ID, { value: BRIDGE_FEE });
      await bridge.connect(user).lock(other.address, AMOUNT, TARGET_CHAIN_ID, { value: BRIDGE_FEE });

      const initialBalance = await ethers.provider.getBalance(owner.address);
      const collectedFees = await bridge.collectedFees();

      const tx = await bridge.withdrawFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(owner.address);
      expect(finalBalance).to.equal(initialBalance + collectedFees - gasUsed);
      expect(await bridge.collectedFees()).to.equal(0n);
    });

    it("Should prevent non-owners from withdrawing fees", async function () {
      await expect(bridge.connect(user).withdrawFees())
        .to.be.revertedWith("Not owner");
    });

    it("Should handle zero fee withdrawal", async function () {
      await expect(bridge.withdrawFees())
        .to.not.be.reverted;
    });
  });
});