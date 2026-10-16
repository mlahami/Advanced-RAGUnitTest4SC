const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MarketFactory", function () {
  let marketFactory;
  let conditionalTokens;
  let owner;
  let user1;
  let user2;
  let collateralToken;
  let oracle;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock contracts
    const ConditionalTokensFactory = await ethers.getContractFactory("ConditionalTokens");
    conditionalTokens = await ConditionalTokensFactory.deploy();
    await conditionalTokens.waitForDeployment();

    // Mock addresses
    collateralToken = ethers.Wallet.createRandom().address;
    oracle = ethers.Wallet.createRandom().address;

    // Deploy MarketFactory
    const MarketFactoryFactory = await ethers.getContractFactory("MarketFactory");
    marketFactory = await MarketFactoryFactory.deploy(
      await conditionalTokens.getAddress(),
      collateralToken,
      oracle
    );
    await marketFactory.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct initial values", async function () {
      expect(await marketFactory.ctf()).to.equal(await conditionalTokens.getAddress());
      expect(await marketFactory.collateralToken()).to.equal(collateralToken);
      expect(await marketFactory.oracle()).to.equal(oracle);
      expect(await marketFactory.owner()).to.equal(owner.address);
    });
  });

  describe("createBinaryMarket", function () {
    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Will Bitcoin reach $100k in 2024?"));
    const question = "Will Bitcoin reach $100k in 2024?";
    const description = "A prediction market on Bitcoin's price";
    const category = "Crypto";

    it("Should create a binary market successfully", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300; // 1 day + 5 minutes buffer from now
      const resolutionTime = endTime + 3600; // 1 hour after end

      const tx = await marketFactory.createBinaryMarket(
        questionId,
        question,
        description,
        category,
        endTime,
        resolutionTime
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );

      expect(event).to.not.be.undefined;
    });

    it("Should revert with invalid end time", async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

      await expect(
        marketFactory.createBinaryMarket(
          questionId,
          question,
          description,
          category,
          pastTime,
          pastTime + 3600 // resolution time after past time
        )
      ).to.be.revertedWithCustomError(marketFactory, "InvalidEndTime");
    });

    it("Should revert with invalid resolution time", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;

      await expect(
        marketFactory.createBinaryMarket(
          questionId,
          question,
          description,
          category,
          endTime,
          endTime - 1 // Before end time
        )
      ).to.be.revertedWithCustomError(marketFactory, "InvalidResolutionTime");
    });

    it("Should revert with duplicate question ID", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create first market
      await marketFactory.createBinaryMarket(
        questionId,
        question,
        description,
        category,
        endTime,
        resolutionTime
      );

      // Try to create second market with same question ID
      await expect(
        marketFactory.createBinaryMarket(
          questionId,
          "Different question",
          "Different description",
          "Different category",
          endTime + 86400,
          resolutionTime + 86400
        )
      ).to.be.revertedWithCustomError(marketFactory, "QuestionIdAlreadyExists");
    });
  });

  describe("createMultipleChoiceMarket", function () {
    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Who will win the 2024 election?"));
    const question = "Who will win the 2024 election?";
    const description = "A prediction market on the 2024 election";
    const category = "Politics";
    const outcomeSlotCount = 3;

    it("Should create a multiple choice market successfully", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      const tx = await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );

      expect(event).to.not.be.undefined;
    });

    it("Should revert with invalid outcome count", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      await expect(
        marketFactory.createMultipleChoiceMarket(
          questionId,
          question,
          description,
          category,
          2, // Less than 3
          endTime,
          resolutionTime
        )
      ).to.be.revertedWithCustomError(marketFactory, "InvalidOutcomeCount");

      await expect(
        marketFactory.createMultipleChoiceMarket(
          questionId,
          question,
          description,
          category,
          257, // More than 256
          endTime,
          resolutionTime
        )
      ).to.be.revertedWithCustomError(marketFactory, "InvalidOutcomeCount");
    });
  });

  describe("createFedRateMarket", function () {
    let mockUSDC;

    const questionId = ethers.keccak256(ethers.toUtf8Bytes("What will the Fed do with interest rates in December 2024?"));
    const question = "What will the Fed do with interest rates in December 2024?";
    const description = "A prediction market on Federal Reserve interest rate decisions";
    const category = "Economics";
    const outcomeSlotCount = 6;

    // Fed rate outcomes:
    // 1 = Cut by 50bp or more
    // 2 = Cut by 25bp (but less than 50bp)
    // 3 = Cut by less than 25bp
    // 4 = No change
    // 5 = Raise by 25bp
    // 6 = Raise by 50bp or more

    beforeEach(async function () {
      // Deploy MockUSDC for these tests
      const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
      mockUSDC = await MockUSDCFactory.deploy();
      await mockUSDC.waitForDeployment();

      // Mint USDC to users
      await mockUSDC.mintForTesting(user1.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(user2.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(await conditionalTokens.getAddress(), ethers.parseUnits("1000000", 6));
    });

    it("Should create a Fed rate market with 6 outcomes successfully", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      const tx = await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );

      expect(event).to.not.be.undefined;

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      const market = await marketFactory.getMarket(conditionId);
      expect(market.outcomeSlotCount).to.equal(6);
      expect(market.question).to.equal(question);
    });

    it("Should allow positions on individual outcomes", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first (this already prepares the condition)
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User bets on 25bp cut only (outcome 2)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [2], // Only outcome 2 (25bp cut)
        amount
      );

      // Check token balance
      const tokenId2 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1 << 1) // 2^1 = 2
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenId2)).to.equal(amount);
    });

    it("Should allow hedging across multiple outcomes", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first (this already prepares the condition)
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User hedges on all cut scenarios (outcomes 1, 2, 3)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1, 2, 4], // Cut by 50bp+, 25bp, or <25bp (index sets: 2^0, 2^1, 2^2)
        amount
      );

      // Check token balances for all three outcomes
      // The partition [1, 2, 4] means outcomes 1, 2, and 3
      // For outcome 1: indexSet = 1 (2^0)
      // For outcome 2: indexSet = 2 (2^1)
      // For outcome 3: indexSet = 4 (2^2)
      const tokenId1 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1) // outcome 1
      );
      const tokenId2 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 2) // outcome 2
      );
      const tokenId3 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 4) // outcome 3 (2^2)
      );

      console.log("Token IDs:", { tokenId1, tokenId2, tokenId3 });
      console.log("Balances:", {
        token1: await conditionalTokens.balanceOf(user1.address, tokenId1),
        token2: await conditionalTokens.balanceOf(user1.address, tokenId2),
        token3: await conditionalTokens.balanceOf(user1.address, tokenId3)
      });

      // In a split position, the full amount is minted for each outcome
      // So for [1, 2, 3], each outcome gets the full amount
      expect(await conditionalTokens.balanceOf(user1.address, tokenId1)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenId2)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenId3)).to.equal(amount);
    });

    it("Should handle resolution with correct payouts", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first (this already prepares the condition)
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User bets on 25bp cut (outcome 2)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [2], // Only outcome 2
        amount
      );

      // Resolve market: Fed cuts by 30bp (outcome 3 wins, not outcome 2)
      const payouts = [0, 0, 100, 0, 0, 0]; // 100% to outcome 3

      // We need to impersonate the oracle address to call reportPayouts
      await ethers.provider.send("hardhat_impersonateAccount", [oracle]);
      const oracleSigner = await ethers.getSigner(oracle);

      // Fund the oracle address
      await owner.sendTransaction({
        to: oracle,
        value: ethers.parseEther("1.0")
      });

      await conditionalTokens.connect(oracleSigner).reportPayouts(questionId, payouts);

      // User should get nothing back since they bet on wrong outcome
      const tokenId2 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1 << 1)
      );

      // Check that user can redeem but gets 0 payout
      const balanceBefore = await mockUSDC.balanceOf(user1.address);
      await conditionalTokens.connect(user1).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [2]
      );
      const balanceAfter = await mockUSDC.balanceOf(user1.address);

      // User should get 0 USDC back (lost the bet)
      expect(balanceAfter).to.equal(balanceBefore);
    });
  });

  describe("Market Management", function () {
    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Test market"));
    const question = "Test market";
    const description = "Test description";
    const category = "Test";

    beforeEach(async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      await marketFactory.createBinaryMarket(
        questionId,
        question,
        description,
        category,
        endTime,
        resolutionTime
      );
    });

    it("Should close market", async function () {
      // Create a mock condition ID
      const conditionId = ethers.keccak256(ethers.toUtf8Bytes("test-condition"));

      // This will fail because the market doesn't exist, but we can test the authorization logic
      await expect(
        marketFactory.closeMarket(conditionId)
      ).to.be.revertedWithCustomError(marketFactory, "NotAuthorized");
    });

    it("Should cancel market", async function () {
      // Create a mock condition ID
      const conditionId = ethers.keccak256(ethers.toUtf8Bytes("test-condition"));

      await marketFactory.cancelMarket(conditionId);

      const market = await marketFactory.getMarket(conditionId);
      expect(market.status).to.equal(3); // MarketStatus.Canceled
    });

    it("Should revert when non-authorized user tries to close market", async function () {
      // Create a mock condition ID
      const conditionId = ethers.keccak256(ethers.toUtf8Bytes("test-condition"));

      await expect(
        marketFactory.connect(user1).closeMarket(conditionId)
      ).to.be.revertedWithCustomError(marketFactory, "NotAuthorized");
    });
  });

  describe("createSportsMatchMarket", function () {
    let mockUSDC;

    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Who will win the 2024 World Cup Final?"));
    const question = "Who will win the 2024 World Cup Final?";
    const description = "A prediction market on the World Cup Final match result";
    const category = "Sports";
    const outcomeSlotCount = 4;

    // Sports match outcomes:
    // 0 = Team A wins in regulation
    // 1 = Team A wins in extra time/penalties
    // 2 = Team B wins in regulation
    // 3 = Team B wins in extra time/penalties

    beforeEach(async function () {
      // Deploy MockUSDC for these tests
      const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
      mockUSDC = await MockUSDCFactory.deploy();
      await mockUSDC.waitForDeployment();

      // Mint USDC to users
      await mockUSDC.mintForTesting(user1.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(user2.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(await conditionalTokens.getAddress(), ethers.parseUnits("1000000", 6));
    });

    it("Should create a 4-outcome sports market successfully", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      const tx = await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );

      expect(event).to.not.be.undefined;

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      const market = await marketFactory.getMarket(conditionId);
      expect(market.outcomeSlotCount).to.equal(4);
      expect(market.question).to.equal(question);
    });

    it("Should allow positions on specific outcomes", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User1 bets on Team A winning in regulation (outcome 0)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1], // Outcome 0 (indexSet = 2^0 = 1)
        amount
      );

      // User2 bets on Team B winning in extra time (outcome 3)
      await mockUSDC.connect(user2).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user2).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [8], // Outcome 3 (indexSet = 2^3 = 8)
        amount
      );

      // Check token balances
      const tokenId0 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1) // 2^0
      );
      const tokenId3 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 8) // 2^3
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenId0)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user2.address, tokenId3)).to.equal(amount);
    });

    it("Should allow hedging across multiple outcomes", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User hedges on all Team A outcomes (0 and 1)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1, 2], // Outcomes 0 and 1 (indexSets = 2^0, 2^1)
        amount
      );

      // Check token balances for both outcomes
      const tokenId0 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1) // 2^0
      );
      const tokenId1 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 2) // 2^1
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenId0)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenId1)).to.equal(amount);
    });

    it("Should handle resolution with correct payouts", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User bets on Team A regulation win (outcome 0)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1], // Outcome 0
        amount
      );

      // Resolve market: Team B wins in extra time (outcome 3 wins)
      const payouts = [0, 0, 0, 100]; // 100% to outcome 3

      // We need to impersonate the oracle address to call reportPayouts
      await ethers.provider.send("hardhat_impersonateAccount", [oracle]);
      const oracleSigner = await ethers.getSigner(oracle);

      // Fund the oracle address
      await owner.sendTransaction({
        to: oracle,
        value: ethers.parseEther("1.0")
      });

      await conditionalTokens.connect(oracleSigner).reportPayouts(questionId, payouts);

      // User should get nothing back since they bet on wrong outcome
      const tokenId0 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1)
      );

      // Check that user can redeem but gets 0 payout
      const balanceBefore = await mockUSDC.balanceOf(user1.address);
      await conditionalTokens.connect(user1).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1]
      );
      const balanceAfter = await mockUSDC.balanceOf(user1.address);

      // User should get 0 USDC back (lost the bet)
      expect(balanceAfter).to.equal(balanceBefore);
    });

    it("Should handle complex hedging strategy", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User1: Hedges on all Team A outcomes (0, 1)
      // User2: Hedges on all Team B outcomes (2, 3)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);
      await mockUSDC.connect(user2).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1, 2], // Team A outcomes (0, 1)
        amount
      );

      await conditionalTokens.connect(user2).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [4, 8], // Team B outcomes (2, 3)
        amount
      );

      // Resolve: Team A wins in regulation (outcome 0)
      const payouts = [100, 0, 0, 0]; // 100% to outcome 0

      await ethers.provider.send("hardhat_impersonateAccount", [oracle]);
      const oracleSigner = await ethers.getSigner(oracle);
      await owner.sendTransaction({
        to: oracle,
        value: ethers.parseEther("1.0")
      });

      await conditionalTokens.connect(oracleSigner).reportPayouts(questionId, payouts);

      // Check results
      const user1BalanceBefore = await mockUSDC.balanceOf(user1.address);
      const user2BalanceBefore = await mockUSDC.balanceOf(user2.address);

      // Redeem positions
      await conditionalTokens.connect(user1).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1, 2]
      );
      await conditionalTokens.connect(user2).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [4, 8]
      );

      const user1BalanceAfter = await mockUSDC.balanceOf(user1.address);
      const user2BalanceAfter = await mockUSDC.balanceOf(user2.address);

      // User1 should get money back from outcome 0 (won)
      // User2 should get nothing from outcomes 2, 3 (lost)
      expect(user1BalanceAfter).to.be.gte(user1BalanceBefore);
      expect(user2BalanceAfter).to.equal(user2BalanceBefore);
    });
  });

  describe("createBinaryMarketsWithSplits", function () {
    let mockUSDC;

    const questionId50bp = ethers.keccak256(ethers.toUtf8Bytes("Will the Fed cut rates by 50bp in December 2024?"));
    const question50bp = "Will the Fed cut rates by 50bp in December 2024?";
    const description50bp = "A binary prediction market on 50bp rate cut";

    const questionId25bp = ethers.keccak256(ethers.toUtf8Bytes("Will the Fed cut rates by 25bp in December 2024?"));
    const question25bp = "Will the Fed cut rates by 25bp in December 2024?";
    const description25bp = "A binary prediction market on 25bp rate cut";

    const category = "Economics";

    beforeEach(async function () {
      // Deploy MockUSDC for these tests
      const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
      mockUSDC = await MockUSDCFactory.deploy();
      await mockUSDC.waitForDeployment();

      // Mint USDC to users
      await mockUSDC.mintForTesting(user1.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(user2.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(await conditionalTokens.getAddress(), ethers.parseUnits("1000000", 6));
    });

    it("Should create two separate binary markets successfully", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create 50bp market
      const tx1 = await marketFactory.createBinaryMarket(
        questionId50bp,
        question50bp,
        description50bp,
        category,
        endTime,
        resolutionTime
      );

      // Create 25bp market
      const tx2 = await marketFactory.createBinaryMarket(
        questionId25bp,
        question25bp,
        description25bp,
        category,
        endTime,
        resolutionTime
      );

      const receipt1 = await tx1.wait();
      const receipt2 = await tx2.wait();

      const event1 = receipt1?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );
      const event2 = receipt2?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );

      expect(event1).to.not.be.undefined;
      expect(event2).to.not.be.undefined;

      // Verify both markets exist
      const conditionId50bp = await conditionalTokens.getConditionId(oracle, questionId50bp, 2);
      const conditionId25bp = await conditionalTokens.getConditionId(oracle, questionId25bp, 2);

      const market50bp = await marketFactory.getMarket(conditionId50bp);
      const market25bp = await marketFactory.getMarket(conditionId25bp);

      expect(market50bp.question).to.equal(question50bp);
      expect(market25bp.question).to.equal(question25bp);
    });

    it("Should allow positions across both binary markets", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create both markets
      await marketFactory.createBinaryMarket(
        questionId50bp,
        question50bp,
        description50bp,
        category,
        endTime,
        resolutionTime
      );

      await marketFactory.createBinaryMarket(
        questionId25bp,
        question25bp,
        description25bp,
        category,
        endTime,
        resolutionTime
      );

      const conditionId50bp = await conditionalTokens.getConditionId(oracle, questionId50bp, 2);
      const conditionId25bp = await conditionalTokens.getConditionId(oracle, questionId25bp, 2);

      // Prepare both conditions
      // Conditions are already prepared by createBinaryMarket

      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount * 2n);

      // User bets YES on 50bp cut
      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId50bp,
        [1], // YES for 50bp
        amount
      );

      // User bets NO on 25bp cut
      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId25bp,
        [2], // NO for 25bp
        amount
      );

      // Check positions
      const tokenId50bpYes = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId50bp, 1)
      );
      const tokenId25bpNo = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId25bp, 2)
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenId50bpYes)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenId25bpNo)).to.equal(amount);
    });

    it("Should handle hedging strategy across both markets", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create both markets
      await marketFactory.createBinaryMarket(
        questionId50bp,
        question50bp,
        description50bp,
        category,
        endTime,
        resolutionTime
      );

      await marketFactory.createBinaryMarket(
        questionId25bp,
        question25bp,
        description25bp,
        category,
        endTime,
        resolutionTime
      );

      const conditionId50bp = await conditionalTokens.getConditionId(oracle, questionId50bp, 2);
      const conditionId25bp = await conditionalTokens.getConditionId(oracle, questionId25bp, 2);

      // Prepare both conditions
      // Conditions are already prepared by createBinaryMarket

      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount * 4n);

      // User hedges: YES on both markets (covers any cut scenario)
      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId50bp,
        [1], // YES for 50bp
        amount
      );

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId25bp,
        [1], // YES for 25bp
        amount
      );

      // Check that user has positions in both markets
      const tokenId50bpYes = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId50bp, 1)
      );
      const tokenId25bpYes = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId25bp, 1)
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenId50bpYes)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenId25bpYes)).to.equal(amount);
    });

    it("Should handle split positions (hedge both sides) in each market", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create 50bp market
      await marketFactory.createBinaryMarket(
        questionId50bp,
        question50bp,
        description50bp,
        category,
        endTime,
        resolutionTime
      );

      const conditionId50bp = await conditionalTokens.getConditionId(oracle, questionId50bp, 2);
      // Condition is already prepared by createBinaryMarket

      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      // User splits position: both YES and NO (hedge)
      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId50bp,
        [1, 2], // Both YES and NO
        amount
      );

      // Check that user has equal amounts of both tokens
      const tokenIdYes = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId50bp, 1)
      );
      const tokenIdNo = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId50bp, 2)
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenIdYes)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenIdNo)).to.equal(amount);
    });

    it("Should handle resolution scenarios across both markets", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create both markets
      await marketFactory.createBinaryMarket(
        questionId50bp,
        question50bp,
        description50bp,
        category,
        endTime,
        resolutionTime
      );

      await marketFactory.createBinaryMarket(
        questionId25bp,
        question25bp,
        description25bp,
        category,
        endTime,
        resolutionTime
      );

      const conditionId50bp = await conditionalTokens.getConditionId(oracle, questionId50bp, 2);
      const conditionId25bp = await conditionalTokens.getConditionId(oracle, questionId25bp, 2);

      // Prepare both conditions
      // Conditions are already prepared by createBinaryMarket

      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount * 2n);

      // User bets YES on 50bp, NO on 25bp
      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId50bp,
        [1], // YES for 50bp
        amount
      );

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId25bp,
        [2], // NO for 25bp
        amount
      );

      // Scenario: Fed cuts by 30bp (neither 50bp nor exactly 25bp)
      // 50bp market: NO wins (Fed didn't cut by 50bp)
      // 25bp market: NO wins (Fed didn't cut by exactly 25bp)

      // Resolve 50bp market: NO wins
      await ethers.provider.send("hardhat_impersonateAccount", [oracle]);
      const oracleSigner = await ethers.getSigner(oracle);
      await owner.sendTransaction({
        to: oracle,
        value: ethers.parseEther("1.0")
      });
      await conditionalTokens.connect(oracleSigner).reportPayouts(questionId50bp, [0, 100]);

      // Resolve 25bp market: NO wins
      await conditionalTokens.connect(oracleSigner).reportPayouts(questionId25bp, [0, 100]);

      // Check if conditions are actually resolved
      const condition50bp = await conditionalTokens.conditions(conditionId50bp);
      const condition25bp = await conditionalTokens.conditions(conditionId25bp);
      console.log("50bp condition resolved:", condition50bp.isResolved);
      console.log("25bp condition resolved:", condition25bp.isResolved);

      // User should win on both markets (both NO positions)
      const tokenId50bpYes = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId50bp, 1)
      );
      const tokenId25bpNo = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId25bp, 2)
      );

      // Check balances before redemption
      console.log("Token balances before redemption:");
      console.log("50bp YES:", await conditionalTokens.balanceOf(user1.address, tokenId50bpYes));
      console.log("25bp NO:", await conditionalTokens.balanceOf(user1.address, tokenId25bpNo));

      // User has YES on 50bp (should lose) and NO on 25bp (should win)
      expect(await conditionalTokens.balanceOf(user1.address, tokenId50bpYes)).to.equal(amount); // Still has tokens
      expect(await conditionalTokens.balanceOf(user1.address, tokenId25bpNo)).to.equal(amount); // Still has tokens

      // Redeem positions
      const balanceBefore = await mockUSDC.balanceOf(user1.address);
      await conditionalTokens.connect(user1).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId50bp,
        [1]
      );
      await conditionalTokens.connect(user1).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId25bp,
        [2]
      );
      const balanceAfter = await mockUSDC.balanceOf(user1.address);

      console.log("Balance before:", balanceBefore.toString());
      console.log("Balance after:", balanceAfter.toString());
      console.log("Expected change:", amount.toString());

      // User should get back 1000 USDC (from winning 25bp NO position)
      // Net change: +1000 USDC (got back 1000 from winning position)
      expect(balanceAfter).to.equal(balanceBefore + amount);
    });
  });

  describe("Access Control", function () {
    it("Should set exchange address", async function () {
      const newExchange = ethers.Wallet.createRandom().address;
      await marketFactory.setExchange(newExchange);
      expect(await marketFactory.exchange()).to.equal(newExchange);
    });

    it("Should set oracle address", async function () {
      const newOracle = ethers.Wallet.createRandom().address;
      await marketFactory.setOracle(newOracle);
      expect(await marketFactory.oracle()).to.equal(newOracle);
    });

    it("Should revert when non-owner tries to set exchange", async function () {
      const newExchange = ethers.Wallet.createRandom().address;
      await expect(
        marketFactory.connect(user1).setExchange(newExchange)
      ).to.be.revertedWithCustomError(marketFactory, "OwnableUnauthorizedAccount");
    });
  });
});