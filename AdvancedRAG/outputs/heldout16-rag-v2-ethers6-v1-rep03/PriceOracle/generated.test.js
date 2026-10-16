const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle", function () {
  let oracle;
  let owner;
  let feeder1;
  let feeder2;
  let feeder3;
  let nonFeeder;
  const asset = ethers.keccak256(ethers.toUtf8Bytes("TEST_ASSET"));
  const twapWindow = 3600n; // 1 hour
  const maxDeviation = 500n; // 5%
  const stalenessLimit = 7200n; // 2 hours
  const requiredFeeders = 2n;

  beforeEach(async function () {
    [owner, feeder1, feeder2, feeder3, nonFeeder] = await ethers.getSigners();

    const OracleFactory = await ethers.getContractFactory("PriceOracle");
    oracle = await OracleFactory.deploy(
      twapWindow,
      maxDeviation,
      stalenessLimit,
      requiredFeeders
    );
    await oracle.waitForDeployment();

    // Add feeders
    await oracle.addFeeder(feeder1.address);
    await oracle.addFeeder(feeder2.address);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await oracle.owner()).to.equal(owner.address);
    });

    it("Should set the correct configuration parameters", async function () {
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

    it("Should prevent adding duplicate feeders", async function () {
      await expect(oracle.addFeeder(feeder1.address)).to.be.revertedWith("Already feeder");
    });

    it("Should allow owner to remove feeders", async function () {
      await expect(oracle.removeFeeder(feeder1.address))
        .to.emit(oracle, "FeederRemoved")
        .withArgs(feeder1.address);
      expect(await oracle.isFeeder(feeder1.address)).to.be.false;
    });

    it("Should prevent non-owners from adding feeders", async function () {
      await expect(oracle.connect(nonFeeder).addFeeder(feeder3.address)).to.be.revertedWith("Not owner");
    });

    it("Should prevent non-owners from removing feeders", async function () {
      await expect(oracle.connect(nonFeeder).removeFeeder(feeder1.address)).to.be.revertedWith("Not owner");
    });
  });

  describe("Price Submission", function () {
    it("Should allow feeders to submit prices", async function () {
      await expect(oracle.connect(feeder1).submitPrice(asset, 100n))
        .to.emit(oracle, "PriceUpdated")
        .withArgs(asset, 100n, anyValue);
    });

    it("Should prevent non-feeders from submitting prices", async function () {
      await expect(oracle.connect(nonFeeder).submitPrice(asset, 100n)).to.be.revertedWith("Not feeder");
    });

    it("Should prevent zero price submissions", async function () {
      await expect(oracle.connect(feeder1).submitPrice(asset, 0n)).to.be.revertedWith("Zero price");
    });

    it("Should prevent duplicate submissions from the same feeder", async function () {
      await oracle.connect(feeder1).submitPrice(asset, 100n);
      await expect(oracle.connect(feeder1).submitPrice(asset, 100n)).to.be.revertedWith("Already submitted");
    });

    it("Should aggregate prices when required feeders submit", async function () {
      await oracle.connect(feeder1).submitPrice(asset, 100n);
      await expect(oracle.connect(feeder2).submitPrice(asset, 200n))
        .to.emit(oracle, "PriceUpdated")
        .withArgs(asset, 150n, anyValue); // (100 + 200) / 2 = 150
    });

    it("Should trip circuit breaker for large price deviations", async function () {
      // First submission
      await oracle.connect(feeder1).submitPrice(asset, 100n);
      await oracle.connect(feeder2).submitPrice(asset, 100n);

      // Second submission with large deviation
      await oracle.connect(feeder1).submitPrice(asset, 100n);
      await expect(oracle.connect(feeder2).submitPrice(asset, 160n))
        .to.emit(oracle, "CircuitBreakerTripped")
        .withArgs(asset, 130n, 100n); // (100 + 160) / 2 = 130, deviation from 100 is 30% (130-100)/100 = 30% > 5%
    });
  });

  describe("Price Reading", function () {
    it("Should return the latest price", async function () {
      await oracle.connect(feeder1).submitPrice(asset, 100n);
      await oracle.connect(feeder2).submitPrice(asset, 200n);

      const [price, timestamp] = await oracle.latestPrice(asset);
      expect(price).to.equal(150n);
      expect(timestamp).to.be.gt(0n);
    });

    it("Should revert when no price data exists", async function () {
      await expect(oracle.latestPrice(asset)).to.be.revertedWith("No data");
    });

    it("Should revert when price is stale", async function () {
      await oracle.connect(feeder1).submitPrice(asset, 100n);
      await oracle.connect(feeder2).submitPrice(asset, 200n);

      // Fast forward time beyond staleness limit
      await ethers.provider.send("evm_increaseTime", [Number(stalenessLimit) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(oracle.latestPrice(asset)).to.be.revertedWith("Price stale");
    });

    it("Should calculate TWAP correctly", async function () {
      // First round
      await oracle.connect(feeder1).submitPrice(asset, 100n);
      await oracle.connect(feeder2).submitPrice(asset, 100n);

      // Wait 1 hour
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");

      // Second round
      await oracle.connect(feeder1).submitPrice(asset, 200n);
      await oracle.connect(feeder2).submitPrice(asset, 200n);

      // Wait another hour
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");

      // Third round
      await oracle.connect(feeder1).submitPrice(asset, 300n);
      await oracle.connect(feeder2).submitPrice(asset, 300n);

      const twap = await oracle.getTWAP(asset);
      // Expected TWAP: (100*3600 + 200*3600 + 300*3600) / (3600*3) = 200
      expect(twap).to.equal(200n);
    });

    it("Should revert when no TWAP data exists", async function () {
      await expect(oracle.getTWAP(asset)).to.be.revertedWith("No TWAP data");
    });
  });
});