const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let bridge, token, owner, validator1, validator2, validator3, user;
  const requiredSignatures = 2n;
  const bridgeFee = ethers.parseEther("0.1");

  beforeEach(async function () {
    [owner, validator1, validator2, validator3, user] = await ethers.getSigners();

    // Deploy token fixture
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to user and approve bridge
    await token.mint(user.address, 1000n);
    await token.connect(user).approve(await token.getAddress(), 1000n);

    // Deploy bridge
    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await Bridge.deploy(await token.getAddress(), requiredSignatures, bridgeFee);
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
      expect(await bridge.requiredSignatures()).to.equal(requiredSignatures);
    });

    it("Should set the correct bridge fee", async function () {
      expect(await bridge.bridgeFee()).to.equal(bridgeFee);
    });
  });

  describe("Validator Management", function () {
    it("Should allow owner to add validators", async function () {
      const newValidator = validator3.address;
      await expect(bridge.addValidator(newValidator))
        .to.emit(bridge, "ValidatorAdded")
        .withArgs(newValidator);
      expect(await bridge.isValidator(newValidator)).to.be.true;
    });

    it("Should not allow adding existing validators", async function () {
      await expect(bridge.addValidator(validator1.address))
        .to.be.revertedWith("Already validator");
    });

    it("Should allow owner to remove validators", async function () {
      await expect(bridge.removeValidator(validator1.address))
        .to.emit(bridge, "ValidatorRemoved")
        .withArgs(validator1.address);
      expect(await bridge.isValidator(validator1.address)).to.be.false;
    });

    it("Should not allow removing non-validators", async function () {
      await expect(bridge.removeValidator(user.address))
        .to.be.revertedWith("Not validator");
    });

    it("Should not allow non-owners to add validators", async function () {
      await expect(bridge.connect(user).addValidator(user.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should not allow non-owners to remove validators", async function () {
      await expect(bridge.connect(user).removeValidator(validator1.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should return correct validator count", async function () {
      expect(await bridge.validatorCount()).to.equal(3n);
    });
  });

  describe("Signature Threshold", function () {
    it("Should allow owner to set required signatures", async function () {
      await expect(bridge.setRequiredSignatures(1n))
        .to.not.be.reverted;
      expect(await bridge.requiredSignatures()).to.equal(1n);
    });

    it("Should not allow setting zero required signatures", async function () {
      await expect(bridge.setRequiredSignatures(0n))
        .to.be.revertedWith("Invalid threshold");
    });

    it("Should not allow setting required signatures above validator count", async function () {
      await expect(bridge.setRequiredSignatures(4n))
        .to.be.revertedWith("Invalid threshold");
    });

    it("Should not allow non-owners to set required signatures", async function () {
      await expect(bridge.connect(user).setRequiredSignatures(1n))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Locking", function () {
    it("Should lock tokens and emit Locked event", async function () {
      const amount = 100n;
      const targetChainId = 137n;
      const recipient = user.address;

      await expect(bridge.connect(user).lock(recipient, amount, targetChainId, { value: bridgeFee }))
        .to.emit(bridge, "Locked")
        .withArgs(
          ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint256", "uint256", "uint256"],
            [user.address, recipient, amount, targetChainId, 0n]
          )),
          user.address,
          recipient,
          amount,
          targetChainId
        );

      // Check token balance
      expect(await token.balanceOf(await bridge.getAddress())).to.equal(amount);
      expect(await token.balanceOf(user.address)).to.equal(900n);

      // Check collected fees
      expect(await bridge.collectedFees()).to.equal(bridgeFee);
    });

    it("Should not allow locking with insufficient fee", async function () {
      const amount = 100n;
      const targetChainId = 137n;
      const recipient = user.address;

      await expect(bridge.connect(user).lock(recipient, amount, targetChainId, { value: 0n }))
        .to.be.revertedWith("Insufficient fee");
    });

    it("Should not allow locking zero amount", async function () {
      const amount = 0n;
      const targetChainId = 137n;
      const recipient = user.address;

      await expect(bridge.connect(user).lock(recipient, amount, targetChainId, { value: bridgeFee }))
        .to.be.revertedWith("Zero amount");
    });

    it("Should not allow locking to zero address", async function () {
      const amount = 100n;
      const targetChainId = 137n;
      const recipient = ethers.ZeroAddress;

      await expect(bridge.connect(user).lock(recipient, amount, targetChainId, { value: bridgeFee }))
        .to.be.revertedWith("Zero recipient");
    });
  });

  describe("Validation and Minting", function () {
    let requestId;

    beforeEach(async function () {
      const amount = 100n;
      const targetChainId = 137n;
      const recipient = user.address;

      const tx = await bridge.connect(user).lock(recipient, amount, targetChainId, { value: bridgeFee });
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "Locked");
      requestId = event.args[0];
    });

    it("Should allow validators to validate requests", async function () {
      await expect(bridge.connect(validator1).validate(requestId))
        .to.not.be.reverted;

      expect(await bridge.hasValidated(requestId, validator1.address)).to.be.true;
      expect(await bridge.validationCount(requestId)).to.equal(1n);
    });

    it("Should not allow non-validators to validate requests", async function () {
      await expect(bridge.connect(user).validate(requestId))
        .to.be.revertedWith("Not validator");
    });

    it("Should not allow validating already processed requests", async function () {
      // First validator validates
      await bridge.connect(validator1).validate(requestId);

      // Second validator validates (should process the request)
      await bridge.connect(validator2).validate(requestId);

      // Try to validate again
      await expect(bridge.connect(validator3).validate(requestId))
        .to.be.revertedWith("Already processed");
    });

    it("Should not allow double validation from same validator", async function () {
      await bridge.connect(validator1).validate(requestId);
      await expect(bridge.connect(validator1).validate(requestId))
        .to.be.revertedWith("Already validated");
    });

    it("Should mint tokens when enough validations are received", async function () {
      const amount = 100n;
      const recipient = user.address;

      // First validation
      await bridge.connect(validator1).validate(requestId);

      // Check that request is not processed yet
      const request = await bridge.requests(requestId);
      expect(request.processed).to.be.false;

      // Second validation (should process)
      const tx = await bridge.connect(validator2).validate(requestId);
      await expect(tx)
        .to.emit(bridge, "Minted")
        .withArgs(requestId, recipient, amount);

      // Check that request is processed
      const updatedRequest = await bridge.requests(requestId);
      expect(updatedRequest.processed).to.be.true;

      // Check token balance
      expect(await token.balanceOf(recipient)).to.equal(1000n + amount);
    });
  });

  describe("Fee Withdrawal", function () {
    it("Should allow owner to withdraw fees", async function () {
      // Create a lock to collect fees
      await bridge.connect(user).lock(user.address, 100n, 137n, { value: bridgeFee });

      const initialBalance = await ethers.provider.getBalance(owner.address);

      const tx = await bridge.withdrawFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(owner.address);
      expect(finalBalance).to.equal(initialBalance + bridgeFee - gasUsed);
      expect(await bridge.collectedFees()).to.equal(0n);
    });

    it("Should not allow non-owners to withdraw fees", async function () {
      await expect(bridge.connect(user).withdrawFees())
        .to.be.revertedWith("Not owner");
    });

    it("Should handle failed fee transfer", async function () {
      // Create a mock contract that will fail when receiving ETH
      const MockReceiver = await ethers.getContractFactory("BenchmarkTarget");
      const mockReceiver = await MockReceiver.deploy();
      await mockReceiver.waitForDeployment();

      // Set the owner to the mock receiver that will fail
      await bridge.setOwner(await mockReceiver.getAddress());

      // Create a lock to collect fees
      await bridge.connect(user).lock(user.address, 100n, 137n, { value: bridgeFee });

      // Try to withdraw fees (should fail)
      await expect(bridge.withdrawFees())
        .to.be.revertedWith("Transfer failed");
    });
  });
});