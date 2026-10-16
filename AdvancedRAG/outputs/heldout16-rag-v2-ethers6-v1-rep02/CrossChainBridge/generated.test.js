const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let owner, validator1, validator2, validator3, user, recipient;
  let token, bridge;
  const bridgeFee = ethers.parseEther("0.1");
  const requiredSignatures = 2n;

  beforeEach(async function () {
    [owner, validator1, validator2, validator3, user, recipient] = await ethers.getSigners();

    // Deploy token fixture
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Deploy bridge
    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await Bridge.deploy(
      await token.getAddress(),
      requiredSignatures,
      bridgeFee
    );
    await bridge.waitForDeployment();

    // Setup validators
    await bridge.addValidator(validator1.address);
    await bridge.addValidator(validator2.address);
    await bridge.addValidator(validator3.address);

    // Mint tokens to user and approve bridge
    await token.mint(user.address, 1000n);
    await token.connect(user).approve(await bridge.getAddress(), 1000n);
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
      const newValidator = validator3.address;
      await expect(bridge.addValidator(newValidator))
        .to.emit(bridge, "ValidatorAdded")
        .withArgs(newValidator);
      expect(await bridge.isValidator(newValidator)).to.be.true;
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

  describe("Signature Threshold", function () {
    it("Should allow owner to set required signatures", async function () {
      await expect(bridge.setRequiredSignatures(1n))
        .to.emit(bridge, "RequiredSignaturesUpdated")
        .withArgs(1n);
      expect(await bridge.requiredSignatures()).to.equal(1n);
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
      await expect(bridge.connect(user).setRequiredSignatures(1n))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Lock Functionality", function () {
    it("Should lock tokens and emit Locked event", async function () {
      const amount = 100n;
      const targetChainId = 1337n;

      await expect(bridge.connect(user).lock(recipient.address, amount, targetChainId, { value: bridgeFee }))
        .to.emit(bridge, "Locked")
        .withArgs(
          ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint256", "uint256", "uint256"],
            [user.address, recipient.address, amount, targetChainId, 0n]
          )),
          user.address,
          recipient.address,
          amount,
          targetChainId
        );

      // Verify tokens were burned
      expect(await token.balanceOf(user.address)).to.equal(900n);
      expect(await token.balanceOf(await bridge.getAddress())).to.equal(0n);

      // Verify fee was collected
      expect(await bridge.collectedFees()).to.equal(bridgeFee);
    });

    it("Should prevent locking with insufficient fee", async function () {
      await expect(bridge.connect(user).lock(recipient.address, 100n, 1337n, { value: 0n }))
        .to.be.revertedWith("Insufficient fee");
    });

    it("Should prevent locking zero amount", async function () {
      await expect(bridge.connect(user).lock(recipient.address, 0n, 1337n, { value: bridgeFee }))
        .to.be.revertedWith("Zero amount");
    });

    it("Should prevent locking to zero address", async function () {
      await expect(bridge.connect(user).lock(ethers.ZeroAddress, 100n, 1337n, { value: bridgeFee }))
        .to.be.revertedWith("Zero recipient");
    });
  });

  describe("Validation and Minting", function () {
    let requestId;

    beforeEach(async function () {
      const amount = 100n;
      const targetChainId = 1337n;
      const tx = await bridge.connect(user).lock(recipient.address, amount, targetChainId, { value: bridgeFee });
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment.name === "Locked");
      requestId = event.args[0];
    });

    it("Should allow validators to validate requests", async function () {
      await expect(bridge.connect(validator1).validate(requestId))
        .to.emit(bridge, "ValidationAdded")
        .withArgs(requestId, validator1.address);

      expect(await bridge.validationCount(requestId)).to.equal(1n);
      expect(await bridge.hasValidated(requestId, validator1.address)).to.be.true;
    });

    it("Should prevent non-validators from validating", async function () {
      await expect(bridge.connect(user).validate(requestId))
        .to.be.revertedWith("Not validator");
    });

    it("Should prevent double validation", async function () {
      await bridge.connect(validator1).validate(requestId);
      await expect(bridge.connect(validator1).validate(requestId))
        .to.be.revertedWith("Already validated");
    });

    it("Should mint tokens when threshold is reached", async function () {
      // First validator validates
      await bridge.connect(validator1).validate(requestId);

      // Second validator validates and triggers mint
      await expect(bridge.connect(validator2).validate(requestId))
        .to.emit(bridge, "Minted")
        .withArgs(requestId, recipient.address, 100n);

      // Verify tokens were minted
      expect(await token.balanceOf(recipient.address)).to.equal(100n);

      // Verify request is marked as processed
      const request = await bridge.requests(requestId);
      expect(request.processed).to.be.true;
    });

    it("Should prevent validation of processed requests", async function () {
      // First validator validates
      await bridge.connect(validator1).validate(requestId);

      // Second validator validates and triggers mint
      await bridge.connect(validator2).validate(requestId);

      // Third validator tries to validate
      await expect(bridge.connect(validator3).validate(requestId))
        .to.be.revertedWith("Already processed");
    });
  });

  describe("Fee Withdrawal", function () {
    it("Should allow owner to withdraw fees", async function () {
      // Lock some tokens to collect fees
      await bridge.connect(user).lock(recipient.address, 100n, 1337n, { value: bridgeFee });

      const initialBalance = await ethers.provider.getBalance(owner.address);

      const tx = await bridge.withdrawFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(owner.address);
      expect(finalBalance).to.equal(initialBalance + bridgeFee - gasUsed);

      // Verify fees were reset
      expect(await bridge.collectedFees()).to.equal(0n);
    });

    it("Should prevent non-owners from withdrawing fees", async function () {
      await expect(bridge.connect(user).withdrawFees())
        .to.be.revertedWith("Not owner");
    });

    it("Should handle failed transfers", async function () {
      // Lock some tokens to collect fees
      await bridge.connect(user).lock(recipient.address, 100n, 1337n, { value: bridgeFee });

      // Make owner a contract that will fail to receive ETH
      const FailingContract = await ethers.getContractFactory("BenchmarkTarget");
      const failingContract = await FailingContract.deploy();
      await failingContract.waitForDeployment();

      // Transfer ownership to the failing contract
      await bridge.connect(owner).transferOwnership(await failingContract.getAddress());

      // Attempt to withdraw fees
      await expect(bridge.connect(failingContract).withdrawFees())
        .to.be.revertedWith("Transfer failed");
    });
  });
});