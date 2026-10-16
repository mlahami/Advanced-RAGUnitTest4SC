const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle", function () {
  let priceOracle;
  let owner;
  let feeder1;
  let feeder2;
  let feeder3;
  let nonFeeder;
  const asset = ethers.keccak256(ethers.toUtf8Bytes("ETH/USD"));
  const twapWindow = 3600n; // 1 hour
  const maxDeviation = 500n; // 5%
  const stalenessLimit = 7200n; // 2 hours
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
    await priceOracle.addFeeder(feeder1.address);
    await priceOracle.addFeeder(feeder2.address);
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

    it("Should add feeders correctly", async function () {
      expect(await priceOracle.isFeeder(feeder1.address)).to.be.true;
      expect(await priceOracle.isFeeder(feeder2.address)).to.be.true;
    });
  });

  describe("Feeder Management", function () {
    it("Should allow owner to add feeders", async function () {
      await expect(priceOracle.addFeeder(feeder3.address))
        .to.emit(priceOracle, "FeederAdded")
        .withArgs(feeder3.address);
      expect(await priceOracle.isFeeder(feeder3.address)).to.be.true;
    });

    it("Should prevent adding duplicate feeders", async function () {
      await expect(priceOracle.addFeeder(feeder1.address))
        .to.be.revertedWith("Already feeder");
    });

    it("Should allow owner to remove feeders", async function () {
      await expect(priceOracle.removeFeeder(feeder1.address))
        .to.emit(priceOracle, "FeederRemoved")
        .withArgs(feeder1.address);
      expect(await priceOracle.isFeeder(feeder1.address)).to.be.false;
    });

    it("Should prevent non-owners from adding feeders", async function () {
      await expect(priceOracle.connect(nonFeeder).addFeeder(feeder3.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should prevent non-owners from removing feeders", async function () {
      await expect(priceOracle.connect(nonFeeder).removeFeeder(feeder1.address))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Price Submission", function () {
    it("Should allow feeders to submit prices", async function () {
      await expect(priceOracle.connect(feeder1).submitPrice(asset, 1000n))
        .to.emit(priceOracle, "PriceUpdated")
        .withArgs(asset, 1000n, anyValue);
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
      await priceOracle.connect(feeder1).submitPrice(asset, 1000n);
      await expect(priceOracle.connect(feeder2).submitPrice(asset, 1000n))
        .to.emit(priceOracle, "PriceUpdated")
        .withArgs(asset, 1000n, anyValue);
    });

    it("Should calculate median price correctly", async function () {
      await priceOracle.connect(feeder1).submitPrice(asset, 900n);
      await expect(priceOracle.connect(feeder2).submitPrice(asset, 1100n))
        .to.emit(priceOracle, "PriceUpdated")
        .withArgs(asset, 1000n, anyValue);
    });
  });

  describe("Circuit Breaker", function () {
    it("Should trip circuit breaker for large price deviation", async function () {
      // First round
      await priceOracle.connect(feeder1).submitPrice(asset, 1000n);
      await priceOracle.connect(feeder2).submitPrice(asset, 1000n);

      // Second round with large deviation
      await priceOracle.connect(feeder1).submitPrice(asset, 1500n);
      await expect(priceOracle.connect(feeder2).submitPrice(asset, 1500n))
        .to.emit(priceOracle, "CircuitBreakerTripped")
        .withArgs(asset, 1500n, 1000n);
    });

    it("Should not trip circuit breaker for small price deviation", async function () {
      // First round
      await priceOracle.connect(feeder1).submitPrice(asset, 1000n);
      await priceOracle.connect(feeder2).submitPrice(asset, 1000n);

      // Second round with small deviation
      await priceOracle.connect(feeder1).submitPrice(asset, 1050n);
      await expect(priceOracle.connect(feeder2).submitPrice(asset, 1050n))
        .to.emit(priceOracle, "PriceUpdated")
        .withArgs(asset, 1050n, anyValue);
    });
  });

  describe("Price Reading", function () {
    it("Should return latest price", async function () {
      await priceOracle.connect(feeder1).submitPrice(asset, 1000n);
      await priceOracle.connect(feeder2).submitPrice(asset, 1000n);

      const [price, timestamp] = await priceOracle.latestPrice(asset);
      expect(price).to.equal(1000n);
      expect(timestamp).to.be.gt(0n);
    });

    it("Should revert when no price data exists", async function () {
      await expect(priceOracle.latestPrice(asset))
        .to.be.revertedWith("No data");
    });

    it("Should revert when price is stale", async function () {
      await priceOracle.connect(feeder1).submitPrice(asset, 1000n);
      await priceOracle.connect(feeder2).submitPrice(asset, 1000n);

      // Fast forward time beyond staleness limit
      await ethers.provider.send("evm_increaseTime", [Number(stalenessLimit) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(priceOracle.latestPrice(asset))
        .to.be.revertedWith("Price stale");
    });
  });

  describe("TWAP Calculation", function () {
    it("Should calculate TWAP correctly", async function () {
      // First round
      await priceOracle.connect(feeder1).submitPrice(asset, 1000n);
      await priceOracle.connect(feeder2).submitPrice(asset, 1000n);

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");

      // Second round
      await priceOracle.connect(feeder1).submitPrice(asset, 1100n);
      await priceOracle.connect(feeder2).submitPrice(asset, 1100n);

      const twap = await priceOracle.getTWAP(asset);
      expect(twap).to.be.closeTo(1050n, 10n); // Allow small rounding differences
    });

    it("Should revert when no TWAP data exists", async function () {
      await expect(priceOracle.getTWAP(asset))
        .to.be.revertedWith("No TWAP data");
    });
  });
});