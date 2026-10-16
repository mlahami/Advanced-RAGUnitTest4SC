const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let owner, validator1, validator2, validator3, user, recipient;
  let token, bridge;
  const BRIDGE_FEE = ethers.parseEther("0.1");
  const REQUIRED_SIGNATURES = 2n;
  const AMOUNT = 100n;
  const TARGET_CHAIN_ID = 1337n;

  beforeEach(async function () {
    [owner, validator1, validator2, validator3, user, recipient] = await ethers.getSigners();

    // Deploy token fixture
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to user and approve bridge
    await token.mint(user.address, AMOUNT * 10n);
    await token.connect(user).approve(await bridge.getAddress(), ethers.MaxUint256);

    // Deploy bridge
    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await Bridge.deploy(
      await token.getAddress(),
      REQUIRED_SIGNATURES,
      BRIDGE_FEE
    );
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

    it("Should set the correct token", async function () {
      expect(await bridge.token()).to.equal(await token.getAddress());
    });

    it("Should set the correct required signatures", async function () {
      expect(await bridge.requiredSignatures()).to.equal(REQUIRED_SIGNATURES);
    });

    it("Should set the correct bridge fee", async function () {
      expect(await bridge.bridgeFee()).to.equal(BRIDGE_FEE);
    });
  });

  describe("Validator Management", function () {
    it("Should allow owner to add validators", async function () {
      const newValidator = validator3;
      await expect(bridge.addValidator(newValidator.address))
        .to.emit(bridge, "ValidatorAdded")
        .withArgs(newValidator.address);
      expect(await bridge.isValidator(newValidator.address)).to.be.true;
    });

    it("Should prevent adding duplicate validators", async function () {
      await expect(bridge.addValidator(validator1.address))
        .to.be.revertedWith("Already validator");
    });

    it("Should allow owner to remove validators", async function () {
      await expect(bridge.removeValidator(validator1.address))
        .to.emit(bridge, "ValidatorRemoved")
        .withArgs(validator1.address);
      expect(await bridge.isValidator(validator1.address)).to.be.false;
    });

    it("Should prevent removing non-validators", async function () {
      await expect(bridge.removeValidator(user.address))
        .to.be.revertedWith("Not validator");
    });

    it("Should prevent non-owners from adding validators", async function () {
      await expect(bridge.connect(user).addValidator(user.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should prevent non-owners from removing validators", async function () {
      await expect(bridge.connect(user).removeValidator(validator1.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should update validator count correctly", async function () {
      expect(await bridge.validatorCount()).to.equal(3n);
      await bridge.addValidator(validator3.address);
      expect(await bridge.validatorCount()).to.equal(4n);
    });
  });

  describe("Lock Function", function () {
    it("Should lock tokens and emit Locked event", async function () {
      const initialBalance = await token.balanceOf(user.address);
      const tx = await bridge.connect(user).lock(
        recipient.address,
        AMOUNT,
        TARGET_CHAIN_ID,
        { value: BRIDGE_FEE }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "Locked");

      expect(event.args.sender).to.equal(user.address);
      expect(event.args.recipient).to.equal(recipient.address);
      expect(event.args.amount).to.equal(AMOUNT);
      expect(event.args.targetChainId).to.equal(TARGET_CHAIN_ID);

      // Check token balance
      expect(await token.balanceOf(user.address)).to.equal(initialBalance - AMOUNT);
      expect(await token.balanceOf(await bridge.getAddress())).to.equal(0n);

      // Check bridge state
      const requestId = event.args.requestId;
      const request = await bridge.requests(requestId);
      expect(request.sender).to.equal(user.address);
      expect(request.recipient).to.equal(recipient.address);
      expect(request.amount).to.equal(AMOUNT);
      expect(request.targetChainId).to.equal(TARGET_CHAIN_ID);
      expect(request.processed).to.be.false;
    });

    it("Should revert if insufficient fee is sent", async function () {
      await expect(bridge.connect(user).lock(
        recipient.address,
        AMOUNT,
        TARGET_CHAIN_ID,
        { value: BRIDGE_FEE - 1n }
      )).to.be.revertedWith("Insufficient fee");
    });

    it("Should revert if amount is zero", async function () {
      await expect(bridge.connect(user).lock(
        recipient.address,
        0n,
        TARGET_CHAIN_ID,
        { value: BRIDGE_FEE }
      )).to.be.revertedWith("Zero amount");
    });

    it("Should revert if recipient is zero address", async function () {
      await expect(bridge.connect(user).lock(
        ethers.ZeroAddress,
        AMOUNT,
        TARGET_CHAIN_ID,
        { value: BRIDGE_FEE }
      )).to.be.revertedWith("Zero recipient");
    });

    it("Should collect fees correctly", async function () {
      await bridge.connect(user).lock(
        recipient.address,
        AMOUNT,
        TARGET_CHAIN_ID,
        { value: BRIDGE_FEE }
      );
      expect(await bridge.collectedFees()).to.equal(BRIDGE_FEE);
    });
  });

  describe("Validate Function", function () {
    let requestId;

    beforeEach(async function () {
      const tx = await bridge.connect(user).lock(
        recipient.address,
        AMOUNT,
        TARGET_CHAIN_ID,
        { value: BRIDGE_FEE }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "Locked");
      requestId = event.args.requestId;
    });

    it("Should allow validators to validate requests", async function () {
      await expect(bridge.connect(validator1).validate(requestId))
        .to.emit(bridge, "ValidatorAdded")
        .withArgs(validator1.address);

      const validationCount = await bridge.validationCount(requestId);
      expect(validationCount).to.equal(1n);
    });

    it("Should prevent non-validators from validating", async function () {
      await expect(bridge.connect(user).validate(requestId))
        .to.be.revertedWith("Not validator");
    });

    it("Should prevent duplicate validations", async function () {
      await bridge.connect(validator1).validate(requestId);
      await expect(bridge.connect(validator1).validate(requestId))
        .to.be.revertedWith("Already validated");
    });

    it("Should prevent validation of processed requests", async function () {
      await bridge.connect(validator1).validate(requestId);
      await bridge.connect(validator2).validate(requestId);
      // Request should be processed after 2 validations (requiredSignatures)
      await expect(bridge.connect(validator3).validate(requestId))
        .to.be.revertedWith("Already processed");
    });

    it("Should mint tokens when enough validations are received", async function () {
      const initialBalance = await token.balanceOf(recipient.address);

      await bridge.connect(validator1).validate(requestId);
      await expect(bridge.connect(validator2).validate(requestId))
        .to.emit(bridge, "Minted")
        .withArgs(requestId, recipient.address, AMOUNT);

      expect(await token.balanceOf(recipient.address)).to.equal(initialBalance + AMOUNT);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set required signatures", async function () {
      await expect(bridge.setRequiredSignatures(3n))
        .to.emit(bridge, "RequiredSignaturesSet")
        .withArgs(3n);
      expect(await bridge.requiredSignatures()).to.equal(3n);
    });

    it("Should prevent setting invalid required signatures", async function () {
      await expect(bridge.setRequiredSignatures(0n))
        .to.be.revertedWith("Invalid threshold");
      await expect(bridge.setRequiredSignatures(4n))
        .to.be.revertedWith("Invalid threshold");
    });

    it("Should prevent non-owners from setting required signatures", async function () {
      await expect(bridge.connect(user).setRequiredSignatures(3n))
        .to.be.revertedWith("Not owner");
    });

    it("Should allow owner to withdraw fees", async function () {
      await bridge.connect(user).lock(
        recipient.address,
        AMOUNT,
        TARGET_CHAIN_ID,
        { value: BRIDGE_FEE }
      );

      const initialBalance = await ethers.provider.getBalance(owner.address);
      const tx = await bridge.withdrawFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await bridge.collectedFees()).to.equal(0n);
      expect(await ethers.provider.getBalance(owner.address))
        .to.equal(initialBalance + BRIDGE_FEE - gasUsed);
    });

    it("Should prevent non-owners from withdrawing fees", async function () {
      await expect(bridge.connect(user).withdrawFees())
        .to.be.revertedWith("Not owner");
    });
  });
});