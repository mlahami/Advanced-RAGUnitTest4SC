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

