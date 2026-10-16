const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle", function () {
  let priceOracle;
  let owner, feeder1, feeder2, feeder3, nonFeeder;
  const asset = ethers.keccak256(ethers.toUtf8Bytes("TEST_ASSET"));
  const twapWindow = 3600n; // 1 hour
  const maxDeviation = 500n; // 5%
  const stalenessLimit = 300n; // 5 minutes
  const requiredFeeders = 2n;

  beforeEach(async function () {
    [owner, feeder1, feeder2, feeder3, nonFeeder] = await ethers.getSigners();

    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    priceOracle = await PriceOracle.connect(owner).deploy(
      twapWindow,
      maxDeviation,
      stalenessLimit,
      requiredFeeders
    );
    await priceOracle.waitForDeployment();

    // Add feeders
    await priceOracle.connect(owner).addFeeder(feeder1.address);
    await priceOracle.connect(owner).addFeeder(feeder2.address);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await priceOracle.owner()).to.equal(owner.address);
    });

    it("Should set the correct configuration parameters", async function () {
      expect(await priceOracle.twapWindow()).to.equal(twapWindow);
      expect(await priceOracle.maxDeviation()).to.equal(maxDeviation);
      expect(await priceOracle.stalenessLimit()).to.equal(stalenessLimit);
      expect(await priceOracle.requiredFeeders()).to.equal(requiredFeeders);
    });
  });

  describe("Feeder Management", function () {
    it("Should allow owner to add feeders", async function () {
      await expect(priceOracle.connect(owner).addFeeder(feeder3.address))
        .to.emit(priceOracle, "FeederAdded")
        .withArgs(feeder3.address);

      expect(await priceOracle.isFeeder(feeder3.address)).to.be.true;
    });

    it("Should prevent non-owner from adding feeders", async function () {
      await expect(priceOracle.connect(nonFeeder).addFeeder(feeder3.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should prevent adding duplicate feeders", async function () {
      await expect(priceOracle.connect(owner).addFeeder(feeder1.address))
        .to.be.revertedWith("Already feeder");
    });

    it("Should allow owner to remove feeders", async function () {
      await expect(priceOracle.connect(owner).removeFeeder(feeder1.address))
        .to.emit(priceOracle, "FeederRemoved")
        .withArgs(feeder1.address);

      expect(await priceOracle.isFeeder(feeder1.address)).to.be.false;
    });

    it("Should prevent non-owner from removing feeders", async function () {
      await expect(priceOracle.connect(nonFeeder).removeFeeder(feeder1.address))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Price Submission", function () {
    it("Should allow feeders to submit prices", async function () {
      await expect(priceOracle.connect(feeder1).submitPrice(asset, 100n))
        .to.not.be.reverted;
    });

    it("Should prevent non-feeders from submitting prices", async function () {
      await expect(priceOracle.connect(nonFeeder).submitPrice(asset, 100n))
        .to.be.revertedWith("Not feeder");
    });

    it("Should prevent zero price submissions", async function () {
      await expect(priceOracle.connect(feeder1).submitPrice(asset, 0n))
        .to.be.revertedWith("Zero price");
    });

    it("Should prevent duplicate submissions from the same feeder", async function () {
      await priceOracle.connect(feeder1).submitPrice(asset, 100n);
      await expect(priceOracle.connect(feeder1).submitPrice(asset, 100n))
        .to.be.revertedWith("Already submitted");
    });

    it("Should aggregate prices when enough feeders submit", async function () {
      await priceOracle.connect(feeder1).submitPrice(asset, 100n);
      await expect(priceOracle.connect(feeder2).submitPrice(asset, 200n))
        .to.emit(priceOracle, "PriceUpdated")
        .withArgs(asset, 150n, await ethers.provider.getBlock("latest").timestamp);
    });
  });

  describe("Price Reading", function () {
    beforeEach(async function () {
      await priceOracle.connect(feeder1).submitPrice(asset, 100n);
      await priceOracle.connect(feeder2).submitPrice(asset, 200n);
    });

    it("Should return the latest price", async function () {
      const [price, timestamp] = await priceOracle.latestPrice(asset);
      expect(price).to.equal(150n);
      expect(timestamp).to.be.closeTo(await ethers.provider.getBlock("latest").timestamp, 2);
    });

    it("Should revert when no price data exists", async function () {
      const newAsset = ethers.keccak256(ethers.toUtf8Bytes("NEW_ASSET"));
      await expect(priceOracle.latestPrice(newAsset))
        .to.be.revertedWith("No data");
    });

    it("Should revert when price is stale", async function () {
      // Fast forward time beyond staleness limit
      await ethers.provider.send("evm_increaseTime", [Number(stalenessLimit) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(priceOracle.latestPrice(asset))
        .to.be.revertedWith("Price stale");
    });

    it("Should calculate TWAP correctly", async function () {
      // Submit another price after some time
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");

      await priceOracle.connect(feeder1).submitPrice(asset, 300n);
      await priceOracle.connect(feeder2).submitPrice(asset, 400n);

      const twap = await priceOracle.getTWAP(asset);
      // Expected TWAP: (150*3600 + 350*3600) / (3600 + 3600) = 350
      expect(twap).to.equal(350n);
    });

    it("Should revert when no TWAP data exists", async function () {
      const newAsset = ethers.keccak256(ethers.toUtf8Bytes("NEW_ASSET"));
      await expect(priceOracle.getTWAP(newAsset))
        .to.be.revertedWith("No TWAP data");
    });
  });

  describe("Circuit Breaker", function () {
    it("Should trip circuit breaker when price deviates too much", async function () {
      // First submission
      await priceOracle.connect(feeder1).submitPrice(asset, 1000n);
      await priceOracle.connect(feeder2).submitPrice(asset, 1000n);

      // Second submission with large deviation
      await priceOracle.connect(feeder1).submitPrice(asset, 1500n);
      await expect(priceOracle.connect(feeder2).submitPrice(asset, 1500n))
        .to.emit(priceOracle, "CircuitBreakerTripped")
        .withArgs(asset, 1500n, 1000n);
    });

    it("Should not trip circuit breaker when price deviation is within limits", async function () {
      // First submission
      await priceOracle.connect(feeder1).submitPrice(asset, 1000n);
      await priceOracle.connect(feeder2).submitPrice(asset, 1000n);

      // Second submission with small deviation
      await priceOracle.connect(feeder1).submitPrice(asset, 1050n);
      await expect(priceOracle.connect(feeder2).submitPrice(asset, 1050n))
        .to.emit(priceOracle, "PriceUpdated")
        .withArgs(asset, 1050n, await ethers.provider.getBlock("latest").timestamp);
    });
  });
});