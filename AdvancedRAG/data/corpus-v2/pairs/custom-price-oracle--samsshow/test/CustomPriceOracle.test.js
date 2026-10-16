const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CustomPriceOracle", function () {
  let priceOracle;
  let owner, updater, user;
  let tokenAddress;
  const pythPriceId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"; // Example ETH/USD

  beforeEach(async function () {
    [owner, updater, user] = await ethers.getSigners();
    tokenAddress = await ethers.Wallet.createRandom().getAddress();

    const CustomPriceOracleFactory = await ethers.getContractFactory("CustomPriceOracle");
    priceOracle = await CustomPriceOracleFactory.connect(owner).deploy();
    await priceOracle.waitForDeployment();
  });

  describe("Configuration", function () {
    it("Should deploy with owner as authorized updater", async function () {
      expect(await priceOracle.authorizedUpdaters(owner.address)).to.equal(true);
      expect(await priceOracle.owner()).to.equal(owner.address);
    });

    it("Should allow the owner to set a price feed ID", async function () {
      await expect(priceOracle.connect(owner).setPriceId(tokenAddress, pythPriceId))
        .to.emit(priceOracle, "PriceIdSet")
        .withArgs(tokenAddress, pythPriceId);
    });

    it("Should prevent non-owners from setting a price feed ID", async function () {
      await expect(priceOracle.connect(user).setPriceId(tokenAddress, pythPriceId))
        .to.be.revertedWithCustomError(priceOracle, "NotAuthorized");
    });

    it("Should allow owner to authorize new updater", async function () {
      await expect(priceOracle.connect(owner).setAuthorizedUpdater(updater.address, true))
        .to.emit(priceOracle, "UpdaterAuthorized")
        .withArgs(updater.address, true);
      
      expect(await priceOracle.authorizedUpdaters(updater.address)).to.equal(true);
    });
  });

  describe("Price Updates", function () {
    const mockPrice = BigInt(3500 * 10**8);
    const mockConf = BigInt(10 * 10**8);
    const mockExpo = -8;
    
    beforeEach(async function () {
      await priceOracle.connect(owner).setPriceId(tokenAddress, pythPriceId);
      await priceOracle.connect(owner).setAuthorizedUpdater(updater.address, true);
    });

    it("Should allow authorized updater to update price", async function () {
      const block = await ethers.provider.getBlock('latest');
      const publishTime = block.timestamp;

      await expect(priceOracle.connect(updater).updatePrice(
        pythPriceId,
        mockPrice,
        mockConf,
        mockExpo,
        publishTime
      )).to.emit(priceOracle, "PriceUpdated")
        .withArgs(pythPriceId, mockPrice, mockConf, mockExpo, publishTime, updater.address);
    });

    it("Should prevent unauthorized address from updating price", async function () {
      const block = await ethers.provider.getBlock('latest');
      const publishTime = block.timestamp;

      await expect(priceOracle.connect(user).updatePrice(
        pythPriceId,
        mockPrice,
        mockConf,
        mockExpo,
        publishTime
      )).to.be.revertedWithCustomError(priceOracle, "NotAuthorized");
    });

    it("Should get the latest price after update", async function () {
      const block = await ethers.provider.getBlock('latest');
      const publishTime = block.timestamp;

      await priceOracle.connect(owner).updatePrice(
        pythPriceId,
        mockPrice,
        mockConf,
        mockExpo,
        publishTime
      );

      const price = await priceOracle.getLatestPrice(tokenAddress);
      expect(price.price).to.equal(mockPrice);
      expect(price.conf).to.equal(mockConf);
      expect(price.expo).to.equal(mockExpo);
      expect(price.publishTime).to.equal(publishTime);
    });

    it("Should batch update multiple prices", async function () {
      const token2 = await ethers.Wallet.createRandom().getAddress();
      const priceId2 = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"; // BTC/USD
      
      await priceOracle.connect(owner).setPriceId(token2, priceId2);

      const block = await ethers.provider.getBlock('latest');
      const publishTime = block.timestamp;

      const priceIds = [pythPriceId, priceId2];
      const prices = [mockPrice, BigInt(50000 * 10**8)];
      const confs = [mockConf, BigInt(100 * 10**8)];
      const expos = [mockExpo, mockExpo];
      const publishTimes = [publishTime, publishTime];

      await expect(priceOracle.connect(owner).updatePrices(
        priceIds,
        prices,
        confs,
        expos,
        publishTimes
      )).to.emit(priceOracle, "PriceUpdated");

      const price1 = await priceOracle.getLatestPrice(tokenAddress);
      const price2 = await priceOracle.getLatestPrice(token2);

      expect(price1.price).to.equal(mockPrice);
      expect(price2.price).to.equal(BigInt(50000 * 10**8));
    });

    it("Should revert on stale price", async function () {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago

      await priceOracle.connect(owner).updatePrice(
        pythPriceId,
        mockPrice,
        mockConf,
        mockExpo,
        oldTimestamp
      );

      await expect(priceOracle.getLatestPrice(tokenAddress))
        .to.be.revertedWithCustomError(priceOracle, "PriceStale");
    });

    it("Should allow getting unsafe price without staleness check", async function () {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago

      await priceOracle.connect(owner).updatePrice(
        pythPriceId,
        mockPrice,
        mockConf,
        mockExpo,
        oldTimestamp
      );

      const price = await priceOracle.getPriceUnsafe(tokenAddress);
      expect(price.price).to.equal(mockPrice);
    });
  });

  describe("Aggregate Metrics", function () {
    beforeEach(async function () {
      await priceOracle.connect(owner).setPriceId(tokenAddress, pythPriceId);
    });

    it("Should allow authorized updater to update aggregate metrics", async function () {
      const liquidityChange = ethers.parseEther("100");
      const volume = ethers.parseEther("10");

      await expect(priceOracle.connect(owner).updateAggregateMetrics(
        tokenAddress,
        liquidityChange,
        volume
      )).to.emit(priceOracle, "MetricsUpdated");

      const metrics = await priceOracle.getAggregateMetrics(tokenAddress);
      expect(metrics.totalLiquidity).to.equal(liquidityChange);
      expect(metrics.totalVolume).to.equal(volume);
    });
    
    it("Should handle negative liquidity changes", async function () {
      const initialLiquidity = ethers.parseEther("200");
      const liquidityDecrease = -ethers.parseEther("50");

      await priceOracle.connect(owner).updateAggregateMetrics(tokenAddress, initialLiquidity, 0);
      await priceOracle.connect(owner).updateAggregateMetrics(tokenAddress, liquidityDecrease, 0);

      const metrics = await priceOracle.getAggregateMetrics(tokenAddress);
      expect(metrics.totalLiquidity).to.equal(ethers.parseEther("150"));
    });

    it("Should prevent unauthorized updaters from updating metrics", async function () {
      await expect(priceOracle.connect(user).updateAggregateMetrics(tokenAddress, 100, 10))
        .to.be.revertedWithCustomError(priceOracle, "NotAuthorized");
    });
  });

  describe("Price Deviation Protection", function () {
    const initialPrice = BigInt(3000 * 10**8);
    
    beforeEach(async function () {
      await priceOracle.connect(owner).setPriceId(tokenAddress, pythPriceId);
      const block = await ethers.provider.getBlock('latest');
      
      await priceOracle.connect(owner).updatePrice(
        pythPriceId,
        initialPrice,
        BigInt(10 * 10**8),
        -8,
        block.timestamp
      );
    });

    it("Should accept price within deviation limit", async function () {
      const newPrice = BigInt(3200 * 10**8); // ~6.7% increase
      const block = await ethers.provider.getBlock('latest');
      
      await expect(priceOracle.connect(owner).updatePrice(
        pythPriceId,
        newPrice,
        BigInt(10 * 10**8),
        -8,
        block.timestamp + 1
      )).to.not.be.reverted;
    });

    it("Should reject price with excessive deviation", async function () {
      const newPrice = BigInt(3500 * 10**8); // ~16.7% increase (over 10% limit)
      const block = await ethers.provider.getBlock('latest');
      
      await expect(priceOracle.connect(owner).updatePrice(
        pythPriceId,
        newPrice,
        BigInt(10 * 10**8),
        -8,
        block.timestamp + 1
      )).to.be.revertedWithCustomError(priceOracle, "PriceDeviationTooLarge");
    });
  });

  describe("Configuration Updates", function () {
    it("Should allow owner to update max staleness", async function () {
      await expect(priceOracle.connect(owner).setMaxStaleness(120))
        .to.emit(priceOracle, "MaxStalenessUpdated")
        .withArgs(120);
      
      expect(await priceOracle.maxStaleness()).to.equal(120);
    });

    it("Should allow owner to update max price deviation", async function () {
      await priceOracle.connect(owner).setMaxPriceDeviation(20);
      expect(await priceOracle.maxPriceDeviation()).to.equal(20);
    });
  });
});

