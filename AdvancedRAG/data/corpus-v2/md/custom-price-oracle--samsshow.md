# custom-price-oracle--samsshow

- domain: price-oracles (oracle)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/SamsShow/ShadowNox @ 0b1cdad52958e19eca86c05b13f094afe27ae14c
- license: MIT
- targets: CustomPriceOracle.sol
- validation: 17 passing tests, 0 failing; statement coverage CustomPriceOracle.sol 85.71 %

## Contract: CustomPriceOracle.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CustomPriceOracle
 * @notice Custom pull-based oracle for Shadow Economy on Arcology
 * @dev Uses Pyth Hermes API off-chain, stores prices on-chain without Pyth contract dependency
 * 
 * IMPORTANT: Pyth Network is not deployed on Arcology blockchain.
 * This oracle fetches real prices from Pyth's Hermes API off-chain and stores them on Arcology.
 * 
 * Architecture:
 * 1. Fisher bots fetch prices from Pyth Hermes API (https://hermes.pyth.network)
 * 2. Bots call updatePrice() to store latest prices on-chain
 * 3. DeFi contracts consume prices via getPrice()
 * 4. Price freshness validation ensures data quality
 * 
 * Security Features:
 * - Multi-signature support for price updates (optional)
 * - Staleness checks (configurable per price feed)
 * - Price deviation limits to prevent manipulation
 * - Aggregate metrics for privacy-preserving DeFi
 */
contract CustomPriceOracle {
    // Price data structure
    struct Price {
        int64 price;           // Price with implied decimals
        uint64 conf;           // Confidence interval
        int32 expo;            // Price exponent (e.g., -8 means divide by 10^8)
        uint256 publishTime;   // When price was published
    }

    // Aggregate market metrics
    struct AggregateMetrics {
        uint256 totalLiquidity;
        uint256 totalVolume;
        uint256 lastUpdateTime;
    }

    // Storage
    address public owner;
    mapping(address => bool) public authorizedUpdaters; // Fisher bots authorized to update prices
    mapping(bytes32 => Price) public prices;            // priceId => Price
    mapping(address => bytes32) public tokenToPriceId;  // token address => priceId
    mapping(address => AggregateMetrics) public aggregateMetrics; // token => metrics
    
    // Configuration
    uint256 public maxStaleness = 60 seconds;           // Maximum price age before considered stale
    uint256 public maxPriceDeviation = 10;              // Max 10% price change per update (prevents manipulation)

    // Events
    event PriceUpdated(
        bytes32 indexed priceId,
        int64 price,
        uint64 conf,
        int32 expo,
        uint256 publishTime,
        address updater
    );
    event PriceIdSet(address indexed token, bytes32 indexed priceId);
    event MetricsUpdated(address indexed token, uint256 liquidity, uint256 volume, uint256 timestamp);
    event UpdaterAuthorized(address indexed updater, bool authorized);
    event MaxStalenessUpdated(uint256 newMaxStaleness);

    // Errors
    error NotAuthorized();
    error PriceNotSet();
    error PriceStale();
    error InvalidPrice();
    error PriceDeviationTooLarge();
    error InvalidPriceId();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAuthorized();
        _;
    }

    modifier onlyAuthorized() {
        if (!authorizedUpdaters[msg.sender] && msg.sender != owner) {
            revert NotAuthorized();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedUpdaters[msg.sender] = true; // Owner is authorized by default
    }

    /**
     * @notice Authorize/deauthorize a price updater (Fisher bot)
     * @param _updater Address of the updater
     * @param _authorized True to authorize, false to revoke
     */
    function setAuthorizedUpdater(address _updater, bool _authorized) external onlyOwner {
        authorizedUpdaters[_updater] = _authorized;
        emit UpdaterAuthorized(_updater, _authorized);
    }

    /**
     * @notice Set price feed ID for a token
     * @param _token Token address
     * @param _priceId Pyth price feed ID (from Hermes API)
     */
    function setPriceId(address _token, bytes32 _priceId) external onlyOwner {
        if (_priceId == bytes32(0)) revert InvalidPriceId();
        tokenToPriceId[_token] = _priceId;
        emit PriceIdSet(_token, _priceId);
    }

    /**
     * @notice Update price for a specific feed
     * @dev Called by Fisher bots after fetching from Pyth Hermes API
     * @param _priceId Price feed ID
     * @param _price Price value
     * @param _conf Confidence interval
     * @param _expo Price exponent
     * @param _publishTime When the price was published
     */
    function updatePrice(
        bytes32 _priceId,
        int64 _price,
        uint64 _conf,
        int32 _expo,
        uint256 _publishTime
    ) external onlyAuthorized {
        if (_priceId == bytes32(0)) revert InvalidPriceId();
        if (_price <= 0) revert InvalidPrice();
        if (_publishTime > block.timestamp) revert InvalidPrice();

        // Check price deviation for existing prices (anti-manipulation)
        Price storage existingPrice = prices[_priceId];
        if (existingPrice.publishTime > 0) {
            uint256 percentChange = _calculatePercentChange(existingPrice.price, _price);
            if (percentChange > maxPriceDeviation) {
                revert PriceDeviationTooLarge();
            }
        }

        // Store price
        prices[_priceId] = Price({
            price: _price,
            conf: _conf,
            expo: _expo,
            publishTime: _publishTime
        });

        emit PriceUpdated(_priceId, _price, _conf, _expo, _publishTime, msg.sender);
    }

    /**
     * @notice Batch update multiple prices (gas efficient)
     * @param _priceIds Array of price feed IDs
     * @param _prices Array of prices
     * @param _confs Array of confidence intervals
     * @param _expos Array of exponents
     * @param _publishTimes Array of publish times
     */
    function updatePrices(
        bytes32[] calldata _priceIds,
        int64[] calldata _prices,
        uint64[] calldata _confs,
        int32[] calldata _expos,
        uint256[] calldata _publishTimes
    ) external onlyAuthorized {
        uint256 length = _priceIds.length;
        require(
            length == _prices.length &&
            length == _confs.length &&
            length == _expos.length &&
            length == _publishTimes.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < length; i++) {
            bytes32 priceId = _priceIds[i];
            int64 price = _prices[i];
            uint64 conf = _confs[i];
            int32 expo = _expos[i];
            uint256 publishTime = _publishTimes[i];
            
            if (priceId == bytes32(0)) revert InvalidPriceId();
            if (price <= 0) revert InvalidPrice();
            if (publishTime > block.timestamp) revert InvalidPrice();

            // Check price deviation for existing prices
            Price storage existingPrice = prices[priceId];
            if (existingPrice.publishTime > 0) {
                uint256 percentChange = _calculatePercentChange(existingPrice.price, price);
                if (percentChange > maxPriceDeviation) {
                    revert PriceDeviationTooLarge();
                }
            }

            // Store price
            prices[priceId] = Price({
                price: price,
                conf: conf,
                expo: expo,
                publishTime: publishTime
            });

            emit PriceUpdated(priceId, price, conf, expo, publishTime, msg.sender);
        }
    }

    /**
     * @notice Update aggregate metrics for a token (privacy-preserving)
     * @param _token Token address
     * @param _liquidityChange Change in liquidity (can be negative)
     * @param _volumeIncrease Volume to add
     */
    function updateAggregateMetrics(
        address _token,
        int256 _liquidityChange,
        uint256 _volumeIncrease
    ) external onlyAuthorized {
        AggregateMetrics storage metrics = aggregateMetrics[_token];
        
        if (_liquidityChange > 0) {
            metrics.totalLiquidity += uint256(_liquidityChange);
        } else if (_liquidityChange < 0) {
            uint256 decrease = uint256(-_liquidityChange);
            if (metrics.totalLiquidity >= decrease) {
                metrics.totalLiquidity -= decrease;
            } else {
                metrics.totalLiquidity = 0;
            }
        }
        
        metrics.totalVolume += _volumeIncrease;
        metrics.lastUpdateTime = block.timestamp;

        emit MetricsUpdated(_token, metrics.totalLiquidity, metrics.totalVolume, block.timestamp);
    }

    /**
     * @notice Get latest price for a token
     * @param _token Token address
     * @return Latest price struct
     */
    function getLatestPrice(address _token) external view returns (Price memory) {
        bytes32 priceId = tokenToPriceId[_token];
        if (priceId == bytes32(0)) revert PriceNotSet();
        
        Price memory price = prices[priceId];
        if (price.publishTime == 0) revert PriceNotSet();
        
        // Check staleness
        if (block.timestamp - price.publishTime > maxStaleness) {
            revert PriceStale();
        }
        
        return price;
    }

    /**
     * @notice Get price by price ID (useful for direct queries)
     * @param _priceId Price feed ID
     * @return Price struct
     */
    function getPrice(bytes32 _priceId) external view returns (Price memory) {
        Price memory price = prices[_priceId];
        if (price.publishTime == 0) revert PriceNotSet();
        
        if (block.timestamp - price.publishTime > maxStaleness) {
            revert PriceStale();
        }
        
        return price;
    }

    /**
     * @notice Get price without staleness check (unsafe, use with caution)
     * @param _token Token address
     * @return Price struct
     */
    function getPriceUnsafe(address _token) external view returns (Price memory) {
        bytes32 priceId = tokenToPriceId[_token];
        if (priceId == bytes32(0)) revert PriceNotSet();
        return prices[priceId];
    }

    /**
     * @notice Get aggregate metrics for a token
     * @param _token Token address
     * @return Aggregate metrics struct
     */
    function getAggregateMetrics(address _token) external view returns (AggregateMetrics memory) {
        return aggregateMetrics[_token];
    }

    /**
     * @notice Update maximum staleness threshold
     * @param _maxStaleness New maximum staleness in seconds
     */
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        maxStaleness = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    /**
     * @notice Update maximum price deviation percentage
     * @param _maxDeviation New max deviation (e.g., 10 = 10%)
     */
    function setMaxPriceDeviation(uint256 _maxDeviation) external onlyOwner {
        maxPriceDeviation = _maxDeviation;
    }

    /**
     * @notice Calculate percentage change between two prices
     * @param _oldPrice Old price
     * @param _newPrice New price
     * @return Percentage change (0-100)
     */
    function _calculatePercentChange(int64 _oldPrice, int64 _newPrice) internal pure returns (uint256) {
        if (_oldPrice == 0) return 0;
        
        int64 diff = _newPrice > _oldPrice ? _newPrice - _oldPrice : _oldPrice - _newPrice;
        uint256 percentChange = (uint256(uint64(diff)) * 100) / uint256(uint64(_oldPrice));
        
        return percentChange;
    }

    /**
     * @notice Transfer ownership
     * @param _newOwner New owner address
     */
    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Invalid owner");
        owner = _newOwner;
        authorizedUpdaters[_newOwner] = true;
    }
}
```

## Tests: CustomPriceOracle.test.js

```javascript
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
```
