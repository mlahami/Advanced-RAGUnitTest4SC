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
  const REQUIRED_SIGNATURES = 2n;
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
    await token.connect(user).approve(await token.getAddress(), AMOUNT * 10n);

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
      await expect(bridge.addValidator(other.address))
        .to.emit(bridge, "ValidatorAdded")
        .withArgs(other.address);

      expect(await bridge.isValidator(other.address)).to.be.true;
      expect(await bridge.validatorCount()).to.equal(4n);
    });

    it("Should prevent non-owner from adding validators", async function () {
      await expect(bridge.connect(user).addValidator(other.address))
        .to.be.revertedWith("Not owner");
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

    it("Should prevent non-owner from removing validators", async function () {
      await expect(bridge.connect(user).removeValidator(validator1.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should prevent removing non-validators", async function () {
      await expect(bridge.removeValidator(other.address))
        .to.be.revertedWith("Not validator");
    });

    it("Should allow owner to update required signatures", async function () {
      await expect(bridge.setRequiredSignatures(3n))
        .to.not.be.reverted;

      expect(await bridge.requiredSignatures()).to.equal(3n);
    });

    it("Should prevent non-owner from updating required signatures", async function () {
      await expect(bridge.connect(user).setRequiredSignatures(3n))
        .to.be.revertedWith("Not owner");
    });

    it("Should prevent setting invalid required signatures", async function () {
      await expect(bridge.setRequiredSignatures(0n))
        .to.be.revertedWith("Invalid threshold");

      await expect(bridge.setRequiredSignatures(4n))
        .to.be.revertedWith("Invalid threshold");
    });
  });

  describe("Locking Tokens", function () {
    it("Should lock tokens and emit Locked event", async function () {
      const recipient = other.address;
      const initialBalance = await token.balanceOf(user.address);

      await expect(bridge.connect(user).lock(recipient, AMOUNT, TARGET_CHAIN_ID, { value: BRIDGE_FEE }))
        .to.emit(bridge, "Locked")
        .withArgs(
          ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint256", "uint256", "uint256"],
            [user.address, recipient, AMOUNT, TARGET_CHAIN_ID, 0n]
          )),
          user.address,
          recipient,
          AMOUNT,
          TARGET_CHAIN_ID
        );

      expect(await token.balanceOf(user.address)).to.equal(initialBalance - AMOUNT);
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

  describe("Validating and Minting", function () {
    let requestId;

    beforeEach(async function () {
      const tx = await bridge.connect(user).lock(other.address, AMOUNT, TARGET_CHAIN_ID, { value: BRIDGE_FEE });
      const receipt = await tx.wait();
      requestId = receipt.logs[0].topics[1];
    });

    it("Should allow validators to validate requests", async function () {
      await expect(bridge.connect(validator1).validate(requestId))
        .to.not.be.reverted;

      expect(await bridge.hasValidated(requestId, validator1.address)).to.be.true;
      expect(await bridge.validationCount(requestId)).to.equal(1n);
    });

    it("Should prevent non-validators from validating", async function () {
      await expect(bridge.connect(user).validate(requestId))
        .to.be.revertedWith("Not validator");
    });

    it("Should prevent validating already processed requests", async function () {
      await bridge.connect(validator1).validate(requestId);
      await bridge.connect(validator2).validate(requestId);

      await expect(bridge.connect(validator3).validate(requestId))
        .to.be.revertedWith("Already processed");
    });

    it("Should prevent double validation from same validator", async function () {
      await bridge.connect(validator1).validate(requestId);

      await expect(bridge.connect(validator1).validate(requestId))
        .to.be.revertedWith("Already validated");
    });

    it("Should mint tokens when enough validations are received", async function () {
      const initialBalance = await token.balanceOf(other.address);

      await bridge.connect(validator1).validate(requestId);
      await expect(bridge.connect(validator2).validate(requestId))
        .to.emit(bridge, "Minted")
        .withArgs(requestId, other.address, AMOUNT);

      expect(await token.balanceOf(other.address)).to.equal(initialBalance + AMOUNT);
      const request = await bridge.requests(requestId);
      expect(request.processed).to.be.true;
    });
  });

  describe("Fee Withdrawal", function () {
    it("Should allow owner to withdraw fees", async function () {
      // Lock some tokens to collect fees
      await bridge.connect(user).lock(other.address, AMOUNT, TARGET_CHAIN_ID, { value: BRIDGE_FEE });

      const initialBalance = await ethers.provider.getBalance(owner.address);
      const tx = await bridge.withdrawFees();
      const receipt = await tx.wait();

      // Calculate gas cost
      const gasUsed = receipt.gasUsed;
      const gasPrice = receipt.gasPrice;
      const gasCost = gasUsed * gasPrice;

      const finalBalance = await ethers.provider.getBalance(owner.address);
      expect(finalBalance).to.equal(initialBalance + BRIDGE_FEE - gasCost);
      expect(await bridge.collectedFees()).to.equal(0n);
    });

    it("Should prevent non-owner from withdrawing fees", async function () {
      await expect(bridge.connect(user).withdrawFees())
        .to.be.revertedWith("Not owner");
    });
  });
});