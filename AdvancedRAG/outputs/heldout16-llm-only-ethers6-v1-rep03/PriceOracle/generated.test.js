const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle", function () {
  let oracle;
  let owner, feeder1, feeder2, feeder3, nonFeeder;
  const asset = ethers.keccak256(ethers.toUtf8Bytes("ETH/USD"));
  const twapWindow = 3600n; // 1 hour
  const maxDeviation = 500n; // 5%
  const stalenessLimit = 86400n; // 1 day
  const requiredFeeders = 2n;

  beforeEach(async function () {
    [owner, feeder1, feeder2, feeder3, nonFeeder] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("PriceOracle");
    oracle = await Oracle.deploy(twapWindow, maxDeviation, stalenessLimit, requiredFeeders);
    await oracle.waitForDeployment();

    // Add feeders
    await oracle.addFeeder(feeder1.address);
    await oracle.addFeeder(feeder2.address);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await oracle.owner()).to.equal(owner.address);
    });

    it("Should set the correct configuration", async function () {
      expect(await oracle.twapWindow()).to.equal(twapWindow);
      expect(await oracle.maxDeviation()).to.equal(maxDeviation);
      expect(await oracle.stalenessLimit()).to.equal(stalenessLimit);
      expect(await oracle.requiredFeeders()).to.equal(requiredFeeders);
    });
  });

  describe("Feeder Management", function () {
    it("Should allow owner to add feeders", async function () {
      await expect(oracle.addFeeder(feeder3.address))
        .to.emit(oracle, "FeederAdded")
        .withArgs(feeder3.address);
      expect(await oracle.isFeeder(feeder3.address)).to.be.true;
    });

    it("Should prevent non-owner from adding feeders", async function () {
      await expect(oracle.connect(nonFeeder).addFeeder(feeder3.address))
        .to.be.revertedWith("Not owner");
    });

    it("Should prevent adding existing feeders", async function () {
      await expect(oracle.addFeeder(feeder1.address))
        .to.be.revertedWith("Already feeder");
    });

    it("Should allow owner to remove feeders", async function () {
      await expect(oracle.removeFeeder(feeder1.address))
        .to.emit(oracle, "FeederRemoved")
        .withArgs(feeder1.address);
      expect(await oracle.isFeeder(feeder1.address)).to.be.false;
    });

    it("Should prevent non-owner from removing feeders", async function () {
      await expect(oracle.connect(nonFeeder).removeFeeder(feeder1.address))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Price Submission", function () {
    it("Should allow feeders to submit prices", async function () {
      await expect(oracle.connect(feeder1).submitPrice(asset, 1000n))
        .to.not.be.reverted;
    });

    it("Should prevent non-feeders from submitting prices", async function () {
      await expect(oracle.connect(nonFeeder).submitPrice(asset, 1000n))
        .to.be.revertedWith("Not feeder");
    });

    it("Should prevent zero price submissions", async function () {
      await expect(oracle.connect(feeder1).submitPrice(asset, 0n))
        .to.be.revertedWith("Zero price");
    });

    it("Should prevent duplicate submissions from same feeder", async function () {
      await oracle.connect(feeder1).submitPrice(asset, 1000n);
      await expect(oracle.connect(feeder1).submitPrice(asset, 1000n))
        .to.be.revertedWith("Already submitted");
    });

    it("Should aggregate prices when required feeders submit", async function () {
      await expect(oracle.connect(feeder1).submitPrice(asset, 1000n))
        .to.emit(oracle, "PriceUpdated")
        .withArgs(asset, 1000n, await ethers.provider.getBlock("latest").timestamp);
    });

    it("Should not aggregate prices until required feeders submit", async function () {
      await oracle.connect(feeder1).submitPrice(asset, 1000n);
      const tx = await oracle.connect(feeder2).submitPrice(asset, 1000n);
      await expect(tx).to.emit(oracle, "PriceUpdated");
    });

    it("Should trip circuit breaker for large price deviation", async function () {
      // First submission
      await oracle.connect(feeder1).submitPrice(asset, 1000n);
      await oracle.connect(feeder2).submitPrice(asset, 1000n);

      // Second submission with large deviation
      await expect(oracle.connect(feeder1).submitPrice(asset, 1500n))
        .to.emit(oracle, "CircuitBreakerTripped")
        .withArgs(asset, 1500n, 1000n);
    });
  });

  describe("Price Reading", function () {
    beforeEach(async function () {
      // Submit initial prices
      await oracle.connect(feeder1).submitPrice(asset, 1000n);
      await oracle.connect(feeder2).submitPrice(asset, 1000n);
    });

    it("Should return latest price", async function () {
      const [price, timestamp] = await oracle.latestPrice(asset);
      expect(price).to.equal(1000n);
      expect(timestamp).to.be.closeTo(await ethers.provider.getBlock("latest").timestamp, 2);
    });

    it("Should revert for stale price", async function () {
      // Fast forward time beyond staleness limit
      await ethers.provider.send("evm_increaseTime", [Number(stalenessLimit) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(oracle.latestPrice(asset))
        .to.be.revertedWith("Price stale");
    });

    it("Should revert when no data exists", async function () {
      const newAsset = ethers.keccak256(ethers.toUtf8Bytes("BTC/USD"));
      await expect(oracle.latestPrice(newAsset))
        .to.be.revertedWith("No data");
    });

    it("Should calculate TWAP correctly", async function () {
      // Fast forward time to ensure TWAP window is active
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");

      // Submit new price
      await oracle.connect(feeder1).submitPrice(asset, 1200n);
      await oracle.connect(feeder2).submitPrice(asset, 1200n);

      const twap = await oracle.getTWAP(asset);
      // Expected TWAP is (1000 + 1200) / 2 = 1100
      expect(twap).to.equal(1100n);
    });

    it("Should revert when no TWAP data exists", async function () {
      const newAsset = ethers.keccak256(ethers.toUtf8Bytes("BTC/USD"));
      await expect(oracle.getTWAP(newAsset))
        .to.be.revertedWith("No TWAP data");
    });
  });
});