const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle", function () {
  let priceOracle;
  let owner, feeder1, feeder2, feeder3, nonFeeder;
  const asset = ethers.keccak256(ethers.toUtf8Bytes("ETH/USD"));
  const twapWindow = 3600n; // 1 hour
  const maxDeviation = 500n; // 5%
  const stalenessLimit = 600n; // 10 minutes
  const requiredFeeders = 2n;

  beforeEach(async function () {
    [owner, feeder1, feeder2, feeder3, nonFeeder] = await ethers.getSigners();

    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    priceOracle = await PriceOracle.deploy(
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
      await expect(priceOracle.connect(feeder1).submitPrice(asset, 1000n))
        .to.not.be.reverted;
    });

    it("Should prevent non-feeders from submitting prices", async function () {
      await expect(priceOracle.connect(nonFeeder).submitPrice(asset, 1000n))
        .to.be.revertedWith("Not feeder");
    });

    it("Should prevent zero price submissions", async function () {
      await expect(priceOracle.connect(feeder1).submitPrice(asset, 0n))
        .to.be.revertedWith("Zero price");
    });

    it("Should prevent duplicate submissions from the same feeder", async function () {
      await priceOracle.connect(feeder1).submitPrice(asset, 1000n);
      await expect(priceOracle.connect(feeder1).submitPrice(asset, 1000n))
        .to.be.revertedWith("Already submitted");
    });

    it("Should aggregate prices when required feeders submit", async function () {
      await expect(priceOracle.connect(feeder1).submitPrice(asset, 1000n))
        .to.not.be.reverted;

      await expect(priceOracle.connect(feeder2).submitPrice(asset, 1100n))
        .to.emit(priceOracle, "PriceUpdated")
        .withArgs(asset, 1050n, anyValue); // (1000 + 1100) / 2 = 1050
    });

    it("Should trip circuit breaker for large price deviation", async function () {
      // First round
      await priceOracle.connect(feeder1).submitPrice(asset, 1000n);
      await priceOracle.connect(feeder2).submitPrice(asset, 1000n);

      // Second round with large deviation
      await expect(priceOracle.connect(feeder1).submitPrice(asset, 1500n))
        .to.not.be.reverted;

      await expect(priceOracle.connect(feeder2).submitPrice(asset, 1500n))
        .to.emit(priceOracle, "CircuitBreakerTripped")
        .withArgs(asset, 1500n, 1000n);
    });
  });

  describe("Price Reading", function () {
    beforeEach(async function () {
      // Submit initial prices
      await priceOracle.connect(feeder1).submitPrice(asset, 1000n);
      await priceOracle.connect(feeder2).submitPrice(asset, 1000n);
    });

    it("Should return the latest price", async function () {
      const [price, timestamp] = await priceOracle.latestPrice(asset);
      expect(price).to.equal(1000n);
      expect(timestamp).to.be.closeTo(await time.latest(), 5n);
    });

    it("Should revert for stale price", async function () {
      // Fast forward time beyond staleness limit
      await time.increase(stalenessLimit + 1n);

      await expect(priceOracle.latestPrice(asset))
        .to.be.revertedWith("Price stale");
    });

    it("Should calculate TWAP correctly", async function () {
      // Fast forward time to ensure TWAP window is active
      await time.increase(60n);

      // Submit new prices
      await priceOracle.connect(feeder1).submitPrice(asset, 1100n);
      await priceOracle.connect(feeder2).submitPrice(asset, 1100n);

      const twap = await priceOracle.getTWAP(asset);
      // Expected TWAP: (1000 * 60 + 1100 * 60) / 120 = 1050
      expect(twap).to.equal(1050n);
    });

    it("Should revert for no TWAP data", async function () {
      const newAsset = ethers.keccak256(ethers.toUtf8Bytes("BTC/USD"));
      await expect(priceOracle.getTWAP(newAsset))
        .to.be.revertedWith("No TWAP data");
    });
  });
});