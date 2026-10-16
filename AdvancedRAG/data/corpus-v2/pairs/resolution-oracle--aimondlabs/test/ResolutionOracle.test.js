const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ResolutionOracle", function () {
  let resolutionOracle;
  let conditionalTokens;
  let owner;
  let resolver1;
  let resolver2;
  let user1;

  beforeEach(async function () {
    [owner, resolver1, resolver2, user1] = await ethers.getSigners();

    // Deploy mock contracts
    const ConditionalTokensFactory = await ethers.getContractFactory("ConditionalTokens");
    conditionalTokens = await ConditionalTokensFactory.deploy();

    // Deploy ResolutionOracle
    const ResolutionOracleFactory = await ethers.getContractFactory("ResolutionOracle");
    resolutionOracle = await ResolutionOracleFactory.deploy(await conditionalTokens.getAddress());

    // Add additional resolvers
    await resolutionOracle.addResolver(resolver1.address);
    await resolutionOracle.addResolver(resolver2.address);
  });

  describe("Deployment", function () {
    it("Should set the correct initial values", async function () {
      expect(await resolutionOracle.ctf()).to.equal(await conditionalTokens.getAddress());
      expect(await resolutionOracle.owner()).to.equal(owner.address);
      expect(await resolutionOracle.resolvers(owner.address)).to.be.true;
    });
  });

  describe("Resolver Management", function () {
    it("Should add resolver", async function () {
      const newResolver = ethers.Wallet.createRandom().address;
      await resolutionOracle.addResolver(newResolver);
      expect(await resolutionOracle.resolvers(newResolver)).to.be.true;
    });

    it("Should remove resolver", async function () {
      await resolutionOracle.removeResolver(resolver1.address);
      expect(await resolutionOracle.resolvers(resolver1.address)).to.be.false;
    });

    it("Should revert when non-owner tries to add resolver", async function () {
      const newResolver = ethers.Wallet.createRandom().address;
      await expect(
        resolutionOracle.connect(user1).addResolver(newResolver)
      ).to.be.revertedWithCustomError(resolutionOracle, "OwnableUnauthorizedAccount");
    });
  });

  describe("Resolution Process", function () {
    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Test question"));
    const outcomeSlotCount = 2;
    const payouts = [100, 0]; // YES wins

    it("Should propose resolution", async function () {
      const tx = await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === resolutionOracle.interface.getEvent("ResolutionProposed").topicHash
      );

      expect(event).to.not.be.undefined;

      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      const resolution = await resolutionOracle.getResolution(conditionId);
      expect(resolution.status).to.equal(1); // ResolutionStatus.Proposed
      expect(resolution.payouts[0]).to.equal(100);
      expect(resolution.payouts[1]).to.equal(0);
    });

    it("Should finalize resolution after dispute period", async function () {
      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Prepare condition first
      await conditionalTokens.prepareCondition(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Propose resolution
      await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      // Fast forward time past dispute period
      await ethers.provider.send("evm_increaseTime", [86400 + 1]); // 1 day + 1 second
      await ethers.provider.send("evm_mine", []);

      // Finalize resolution
      const tx = await resolutionOracle.connect(resolver1).finalizeResolution(
        questionId,
        outcomeSlotCount
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === resolutionOracle.interface.getEvent("ResolutionFinalized").topicHash
      );

      expect(event).to.not.be.undefined;

      const resolution = await resolutionOracle.getResolution(conditionId);
      expect(resolution.status).to.equal(3); // ResolutionStatus.Finalized
      expect(await resolutionOracle.isResolved(conditionId)).to.be.true;
    });

    it("Should allow admin to immediately finalize", async function () {
      // Prepare condition first
      await conditionalTokens.prepareCondition(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      const tx = await resolutionOracle.adminFinalizeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === resolutionOracle.interface.getEvent("ResolutionFinalized").topicHash
      );

      expect(event).to.not.be.undefined;

      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      const resolution = await resolutionOracle.getResolution(conditionId);
      expect(resolution.status).to.equal(3); // ResolutionStatus.Finalized
    });

    it("Should allow dispute during dispute period", async function () {
      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Propose resolution
      await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      // Dispute resolution
      const tx = await resolutionOracle.connect(user1).disputeResolution(
        questionId,
        outcomeSlotCount
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === resolutionOracle.interface.getEvent("ResolutionDisputed").topicHash
      );

      expect(event).to.not.be.undefined;

      const resolution = await resolutionOracle.getResolution(conditionId);
      expect(resolution.status).to.equal(2); // ResolutionStatus.Disputed
    });

    it("Should revert when trying to finalize before dispute period ends", async function () {
      // Propose resolution
      await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      // Try to finalize immediately
      await expect(
        resolutionOracle.connect(resolver1).finalizeResolution(
          questionId,
          outcomeSlotCount
        )
      ).to.be.revertedWithCustomError(resolutionOracle, "DisputePeriodActive");
    });

    it("Should revert when non-resolver tries to propose", async function () {
      await expect(
        resolutionOracle.connect(user1).proposeResolution(
          questionId,
          outcomeSlotCount,
          payouts
        )
      ).to.be.revertedWithCustomError(resolutionOracle, "NotResolver");
    });

    it("Should revert with invalid payouts length", async function () {
      await expect(
        resolutionOracle.connect(resolver1).proposeResolution(
          questionId,
          outcomeSlotCount,
          [100] // Wrong length
        )
      ).to.be.revertedWithCustomError(resolutionOracle, "InvalidPayoutsLength");
    });

    it("Should revert when trying to propose duplicate resolution", async function () {
      // Propose first resolution
      await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      // Try to propose again
      await expect(
        resolutionOracle.connect(resolver2).proposeResolution(
          questionId,
          outcomeSlotCount,
          payouts
        )
      ).to.be.revertedWithCustomError(resolutionOracle, "AlreadyResolved");
    });
  });

  describe("Utility Functions", function () {
    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Test question"));
    const outcomeSlotCount = 2;
    const payouts = [100, 0];

    it("Should check if resolution can be disputed", async function () {
      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Before proposal
      expect(await resolutionOracle.canDispute(conditionId)).to.be.false;

      // After proposal
      await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      expect(await resolutionOracle.canDispute(conditionId)).to.be.true;

      // After dispute period
      await ethers.provider.send("evm_increaseTime", [86400 + 1]);
      await ethers.provider.send("evm_mine", []);

      expect(await resolutionOracle.canDispute(conditionId)).to.be.false;
    });

    it("Should check if condition is resolved", async function () {
      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Prepare condition first
      await conditionalTokens.prepareCondition(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Before resolution
      expect(await resolutionOracle.isResolved(conditionId)).to.be.false;

      // After admin finalization
      await resolutionOracle.adminFinalizeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      expect(await resolutionOracle.isResolved(conditionId)).to.be.true;
    });
  });
});