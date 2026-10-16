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
    await token.connect(user1).approve(await bridge.getAddress(), ethers.MaxUint256);
    await token.connect(user2).approve(await bridge.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await bridge.owner()).to.equal(owner.address);
    });

    it("Should set the correct token", async function () {
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
      const newValidator = user1;
      await bridge.addValidator(newValidator.address);
      expect(await bridge.isValidator(newValidator.address)).to.be.true;
      expect(await bridge.validatorCount()).to.equal(4n);
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
      expect(await bridge.validatorCount()).to.equal(2n);
    });

    it("Should not allow non-owner to remove validators", async function () {
      await expect(bridge.connect(user1).removeValidator(validator1.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should not allow removing non-validators", async function () {
      await expect(bridge.removeValidator(user1.address))
        .to.be.revertedWith("Not validator");
    });

    it("Should allow owner to set required signatures", async function () {
      await bridge.setRequiredSignatures(3n);
      expect(await bridge.requiredSignatures()).to.equal(3n);
    });

    it("Should not allow non-owner to set required signatures", async function () {
      await expect(bridge.connect(user1).setRequiredSignatures(3n))
        .to.be.revertedWith("Not owner");
    });

    it("Should not allow setting invalid required signatures", async function () {
      await expect(bridge.setRequiredSignatures(0n))
        .to.be.revertedWith("Invalid threshold");
      await expect(bridge.setRequiredSignatures(4n))
        .to.be.revertedWith("Invalid threshold");
    });
  });

  describe("Lock Function", function () {
    it("Should lock tokens and emit Locked event", async function () {
      const initialBalance = await token.balanceOf(user1.address);
      const tx = await bridge.connect(user1).lock(user2.address, amount, targetChainId, { value: bridgeFee });
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => log.fragment.name === "Locked");
      expect(event.args.requestId).to.exist;
      expect(event.args.sender).to.equal(user1.address);
      expect(event.args.recipient).to.equal(user2.address);
      expect(event.args.amount).to.equal(amount);
      expect(event.args.targetChainId).to.equal(targetChainId);

      // Check state changes
      expect(await token.balanceOf(user1.address)).to.equal(initialBalance - amount);
      expect(await bridge.collectedFees()).to.equal(bridgeFee);
    });

    it("Should not allow locking with insufficient fee", async function () {
      await expect(bridge.connect(user1).lock(user2.address, amount, targetChainId, { value: 0 }))
        .to.be.revertedWith("Insufficient fee");
    });

    it("Should not allow locking zero amount", async function () {
      await expect(bridge.connect(user1).lock(user2.address, 0n, targetChainId, { value: bridgeFee }))
        .to.be.revertedWith("Zero amount");
    });

    it("Should not allow locking to zero address", async function () {
      await expect(bridge.connect(user1).lock(ethers.ZeroAddress, amount, targetChainId, { value: bridgeFee }))
        .to.be.revertedWith("Zero recipient");
    });
  });

  describe("Validate Function", function () {
    let requestId;

    beforeEach(async function () {
      const tx = await bridge.connect(user1).lock(user2.address, amount, targetChainId, { value: bridgeFee });
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "Locked");
      requestId = event.args.requestId;
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

    it("Should not allow validating already processed requests", async function () {
      await bridge.connect(validator1).validate(requestId);
      await bridge.connect(validator2).validate(requestId);
      await expect(bridge.connect(validator3).validate(requestId))
        .to.be.revertedWith("Already processed");
    });

    it("Should not allow double validation from same validator", async function () {
      await bridge.connect(validator1).validate(requestId);
      await expect(bridge.connect(validator1).validate(requestId))
        .to.be.revertedWith("Already validated");
    });

    it("Should mint tokens when enough validations are received", async function () {
      const initialBalance = await token.balanceOf(user2.address);
      await bridge.connect(validator1).validate(requestId);
      const tx = await bridge.connect(validator2).validate(requestId);
      const receipt = await tx.wait();

      // Check event
      const event = receipt.logs.find(log => log.fragment.name === "Minted");
      expect(event.args.requestId).to.equal(requestId);
      expect(event.args.recipient).to.equal(user2.address);
      expect(event.args.amount).to.equal(amount);

      // Check state changes
      expect(await token.balanceOf(user2.address)).to.equal(initialBalance + amount);
      const request = await bridge.requests(requestId);
      expect(request.processed).to.be.true;
    });
  });

  describe("Withdraw Fees", function () {
    it("Should allow owner to withdraw fees", async function () {
      await bridge.connect(user1).lock(user2.address, amount, targetChainId, { value: bridgeFee });
      const initialBalance = await ethers.provider.getBalance(owner.address);

      const tx = await bridge.withdrawFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(owner.address);
      expect(finalBalance).to.equal(initialBalance + bridgeFee - gasUsed);
      expect(await bridge.collectedFees()).to.equal(0n);
    });

    it("Should not allow non-owner to withdraw fees", async function () {
      await expect(bridge.connect(user1).withdrawFees())
        .to.be.revertedWith("Not owner");
    });

    it("Should fail if transfer fails", async function () {
      // Mock a contract that will fail to receive funds
      const MockReceiver = await ethers.getContractFactory("BenchmarkTarget");
      const mockReceiver = await MockReceiver.deploy();
      await mockReceiver.waitForDeployment();

      // Set the owner to the mock receiver that will fail
      const Bridge = await ethers.getContractFactory("CrossChainBridge");
      const failingBridge = await Bridge.deploy(await token.getAddress(), requiredSignatures, bridgeFee);
      await failingBridge.waitForDeployment();

      // Transfer ownership to the mock receiver
      await failingBridge.addValidator(validator1.address);
      await failingBridge.addValidator(validator2.address);
      await failingBridge.addValidator(validator3.address);

      // Lock some tokens to collect fees
      await failingBridge.connect(user1).lock(user2.address, amount, targetChainId, { value: bridgeFee });

      // Set the owner to the mock receiver
      await failingBridge.setRequiredSignatures(1n);
      await failingBridge.connect(validator1).validate(
        ethers.keccak256(ethers.solidityPacked(["address", "address", "uint256", "uint256", "uint256"],
          [user1.address, user2.address, amount, targetChainId, 0n]))
      );

      // Now try to withdraw fees - this should fail
      await expect(failingBridge.withdrawFees())
        .to.be.revertedWith("Transfer failed");
    });
  });
});