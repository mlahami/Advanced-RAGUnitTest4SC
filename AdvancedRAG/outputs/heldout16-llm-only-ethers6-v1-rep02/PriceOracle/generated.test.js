const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle", function () {
  let oracle;
  let owner;
  let feeder1, feeder2, feeder3;
  let asset;
  const TWAP_WINDOW = 3600n; // 1 hour
  const MAX_DEVIATION = 500n; // 5%
  const STALENESS_LIMIT = 7200n; // 2 hours
  const REQUIRED_FEEDERS = 2n;

  beforeEach(async function () {
    [owner, feeder1, feeder2, feeder3] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("PriceOracle");
    oracle = await Oracle.deploy(
      TWAP_WINDOW,
      MAX_DEVIATION,
      STALENESS_LIMIT,
      REQUIRED_FEEDERS
    );
    await oracle.waitForDeployment();

    // Add feeders
    await oracle.addFeeder(feeder1.address);
    await oracle.addFeeder(feeder2.address);

    asset = ethers.keccak256(ethers.toUtf8Bytes("ETH/USD"));
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await oracle.owner()).to.equal(owner.address);
    });

    it("Should set the correct configuration", async function () {
      expect(await oracle.twapWindow()).to.equal(TWAP_WINDOW);
      expect(await oracle.maxDeviation()).to.equal(MAX_DEVIATION);
      expect(await oracle.stalenessLimit()).to.equal(STALENESS_LIMIT);
      expect(await oracle.requiredFeeders()).to.equal(REQUIRED_FEEDERS);
    });
  });

  describe("Feeder Management", function () {
    it("Should allow owner to add feeders", async function () {
      await expect(oracle.addFeeder(feeder3.address))
        .to.emit(oracle, "FeederAdded")
        .withArgs(feeder3.address);
      expect(await oracle.isFeeder(feeder3.address)).to.be.true;
    });

    it("Should prevent adding existing feeders", async function () {
      await expect(oracle.addFeeder(feeder1.address)).to.be.revertedWith("Already feeder");
    });

    it("Should allow owner to remove feeders", async function () {
      await expect(oracle.removeFeeder(feeder1.address))
        .to.emit(oracle, "FeederRemoved")
        .withArgs(feeder1.address);
      expect(await oracle.isFeeder(feeder1.address)).to.be.false;
    });

    it("Should prevent non-owner from managing feeders", async function () {
      await expect(oracle.connect(feeder1).addFeeder(feeder3.address)).to.be.revertedWith("Not owner");
      await expect(oracle.connect(feeder1).removeFeeder(feeder2.address)).to.be.revertedWith("Not owner");
    });
  });

  describe("Price Submission", function () {
    it("Should allow feeders to submit prices", async function () {
      await expect(oracle.connect(feeder1).submitPrice(asset, 1000n))
        .to.emit(oracle, "PriceUpdated")
        .withArgs(asset, 1000n, anyValue);
    });

    it("Should prevent non-feeders from submitting prices", async function () {
      await expect(oracle.connect(owner).submitPrice(asset, 1000n)).to.be.revertedWith("Not feeder");
    });

    it("Should prevent zero price submissions", async function () {
      await expect(oracle.connect(feeder1).submitPrice(asset, 0n)).to.be.revertedWith("Zero price");
    });

    it("Should prevent duplicate submissions from same feeder", async function () {
      await oracle.connect(feeder1).submitPrice(asset, 1000n);
      await expect(oracle.connect(feeder1).submitPrice(asset, 1000n)).to.be.revertedWith("Already submitted");
    });

    it("Should aggregate prices when required feeders submit", async function () {
      await oracle.connect(feeder1).submitPrice(asset, 1000n);
      await expect(oracle.connect(feeder2).submitPrice(asset, 1100n))
        .to.emit(oracle, "PriceUpdated")
        .withArgs(asset, 1050n, anyValue); // (1000 + 1100) / 2 = 1050
    });

    it("Should trip circuit breaker on large deviation", async function () {
      // First submission
      await oracle.connect(feeder1).submitPrice(asset, 1000n);
      await oracle.connect(feeder2).submitPrice(asset, 1000n);

      // Second submission with large deviation
      await oracle.connect(feeder1).submitPrice(asset, 1500n); // 50% deviation
      await expect(oracle.connect(feeder2).submitPrice(asset, 1500n))
        .to.emit(oracle, "CircuitBreakerTripped")
        .withArgs(asset, 1500n, 1000n);
    });
  });

  describe("Price Reading", function () {
    it("Should return latest price", async function () {
      await oracle.connect(feeder1).submitPrice(asset, 1000n);
      await oracle.connect(feeder2).submitPrice(asset, 1000n);

      const [price, timestamp] = await oracle.latestPrice(asset);
      expect(price).to.equal(1000n);
      expect(timestamp).to.be.gt(0n);
    });

    it("Should revert for stale price", async function () {
      await oracle.connect(feeder1).submitPrice(asset, 1000n);
      await oracle.connect(feeder2).submitPrice(asset, 1000n);

      // Fast forward time beyond staleness limit
      await ethers.provider.send("evm_increaseTime", [Number(STALENESS_LIMIT) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(oracle.latestPrice(asset)).to.be.revertedWith("Price stale");
    });

    it("Should calculate TWAP correctly", async function () {
      // First submission
      await oracle.connect(feeder1).submitPrice(asset, 1000n);
      await oracle.connect(feeder2).submitPrice(asset, 1000n);

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [3600]); // 1 hour
      await ethers.provider.send("evm_mine");

      // Second submission
      await oracle.connect(feeder1).submitPrice(asset, 2000n);
      await oracle.connect(feeder2).submitPrice(asset, 2000n);

      const twap = await oracle.getTWAP(asset);
      // Expected TWAP: (1000 * 3600 + 2000 * 3600) / (3600 + 3600) = 1500
      expect(twap).to.equal(1500n);
    });
  });
});