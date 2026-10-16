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
      const price = 3000n;
      await expect(priceOracle.connect(feeder1).submitPrice(asset, price))
        .to.not.be.reverted;
    });

    it("Should prevent non-feeders from submitting prices", async function () {
      const price = 3000n;
      await expect(priceOracle.connect(nonFeeder).submitPrice(asset, price))
        .to.be.revertedWith("Not feeder");
    });

    it("Should prevent zero price submissions", async function () {
      await expect(priceOracle.connect(feeder1).submitPrice(asset, 0n))
        .to.be.revertedWith("Zero price");
    });

    it("Should prevent duplicate submissions from the same feeder", async function () {
      const price = 3000n;
      await priceOracle.connect(feeder1).submitPrice(asset, price);
      await expect(priceOracle.connect(feeder1).submitPrice(asset, price))
        .to.be.revertedWith("Already submitted");
    });

    it("Should aggregate prices when required feeders submit", async function () {
      const price1 = 3000n;
      const price2 = 3100n;

      await expect(priceOracle.connect(feeder1).submitPrice(asset, price1))
        .to.not.be.reverted;

      await expect(priceOracle.connect(feeder2).submitPrice(asset, price2))
        .to.emit(priceOracle, "PriceUpdated")
        .withArgs(asset, (price1 + price2) / 2n, anyValue);
    });

    it("Should trip circuit breaker for large price deviation", async function () {
      const initialPrice = 3000n;
      const largePrice = 4500n; // 50% increase (over 5% max deviation)

      // First round
      await priceOracle.connect(feeder1).submitPrice(asset, initialPrice);
      await priceOracle.connect(feeder2).submitPrice(asset, initialPrice);

      // Second round with large deviation
      await priceOracle.connect(feeder1).submitPrice(asset, largePrice);
      await expect(priceOracle.connect(feeder2).submitPrice(asset, largePrice))
        .to.emit(priceOracle, "CircuitBreakerTripped")
        .withArgs(asset, (largePrice + largePrice) / 2n, initialPrice);
    });
  });

  describe("Price Reading", function () {
    it("Should return the latest price", async function () {
      const price = 3000n;
      await priceOracle.connect(feeder1).submitPrice(asset, price);
      await priceOracle.connect(feeder2).submitPrice(asset, price);

      const [latestPrice, timestamp] = await priceOracle.latestPrice(asset);
      expect(latestPrice).to.equal(price);
      expect(timestamp).to.be.closeTo(await time.latest(), 5);
    });

    it("Should revert when no price data exists", async function () {
      await expect(priceOracle.latestPrice(asset))
        .to.be.revertedWith("No data");
    });

    it("Should revert when price is stale", async function () {
      const price = 3000n;
      await priceOracle.connect(feeder1).submitPrice(asset, price);
      await priceOracle.connect(feeder2).submitPrice(asset, price);

      // Fast forward time beyond staleness limit
      await time.increase(stalenessLimit + 1n);

      await expect(priceOracle.latestPrice(asset))
        .to.be.revertedWith("Price stale");
    });

    it("Should calculate TWAP correctly", async function () {
      const price1 = 3000n;
      const price2 = 3100n;

      // First round
      await priceOracle.connect(feeder1).submitPrice(asset, price1);
      await priceOracle.connect(feeder2).submitPrice(asset, price1);

      // Wait 1 hour (twapWindow)
      await time.increase(twapWindow);

      // Second round
      await priceOracle.connect(feeder1).submitPrice(asset, price2);
      await priceOracle.connect(feeder2).submitPrice(asset, price2);

      // Calculate expected TWAP
      const expectedTWAP = (price1 * twapWindow + price2 * twapWindow) / (2n * twapWindow);

      const twap = await priceOracle.getTWAP(asset);
      expect(twap).to.equal(expectedTWAP);
    });

    it("Should revert when no TWAP data exists", async function () {
      await expect(priceOracle.getTWAP(asset))
        .to.be.revertedWith("No TWAP data");
    });
  });
});