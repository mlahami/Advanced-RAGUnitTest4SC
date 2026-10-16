// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PriceOracle
 * @notice Time-weighted average price (TWAP) oracle with:
 *         - Trusted feeder network (M-of-N aggregation)
 *         - Configurable TWAP window
 *         - Staleness guard
 *         - Circuit breaker (max deviation from last accepted price)
 *
 *         Great for testing oracle manipulation and sandwich attack prompts.
 * Complexity: Complex
 */
contract PriceOracle {
    struct RoundData {
        uint256 price;
        uint256 timestamp;
    }

    struct TWAPAccumulator {
        uint256 priceCumulative;
        uint256 lastTimestamp;
        uint256 lastPrice;
    }

    address public owner;
    uint256 public twapWindow;       // seconds
    uint256 public maxDeviation;     // bps, e.g. 500 = 5% max jump
    uint256 public stalenessLimit;   // seconds

    mapping(address => bool)    public isFeeder;
    uint256 public               requiredFeeders;

    // asset => round history
    mapping(bytes32 => RoundData[])     public rounds;
    mapping(bytes32 => TWAPAccumulator) public twaps;

    // pending round aggregation
    mapping(bytes32 => mapping(address => uint256)) public pendingPrice;
    mapping(bytes32 => address[])                   public pendingFeeders;
    mapping(bytes32 => uint256)                     public pendingRound;

    event PriceUpdated(bytes32 indexed asset, uint256 price, uint256 timestamp);
    event FeederAdded(address feeder);
    event FeederRemoved(address feeder);
    event CircuitBreakerTripped(bytes32 indexed asset, uint256 newPrice, uint256 lastPrice);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyFeeder() { require(isFeeder[msg.sender], "Not feeder"); _; }

    constructor(
        uint256 _twapWindow,
        uint256 _maxDeviation,
        uint256 _stalenessLimit,
        uint256 _requiredFeeders
    ) {
        owner            = msg.sender;
        twapWindow       = _twapWindow;
        maxDeviation     = _maxDeviation;
        stalenessLimit   = _stalenessLimit;
        requiredFeeders  = _requiredFeeders;
    }

    // â”€â”€â”€ Feeders submit prices â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function submitPrice(bytes32 asset, uint256 price) external onlyFeeder {
        require(price > 0, "Zero price");

        // One submission per feeder per round
        uint256 round = pendingRound[asset];
        require(pendingPrice[asset][msg.sender] == 0, "Already submitted");
        pendingPrice[asset][msg.sender] = price;
        pendingFeeders[asset].push(msg.sender);

        if (pendingFeeders[asset].length >= requiredFeeders) {
            _aggregateRound(asset, round);
        }
    }

    // â”€â”€â”€ Reads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function latestPrice(bytes32 asset) external view returns (uint256 price, uint256 timestamp) {
        RoundData[] storage history = rounds[asset];
        require(history.length > 0, "No data");
        RoundData storage r = history[history.length - 1];
        require(block.timestamp - r.timestamp <= stalenessLimit, "Price stale");
        return (r.price, r.timestamp);
    }

    function getTWAP(bytes32 asset) external view returns (uint256) {
        TWAPAccumulator storage acc = twaps[asset];
        require(acc.lastTimestamp > 0, "No TWAP data");
        uint256 elapsed = block.timestamp - acc.lastTimestamp;
        if (elapsed == 0) return acc.lastPrice;
        uint256 cumulative = acc.priceCumulative + acc.lastPrice * elapsed;
        return cumulative / (acc.lastTimestamp - _twapStart(asset) + elapsed);
    }

    // â”€â”€â”€ Admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function addFeeder(address f) external onlyOwner {
        require(!isFeeder[f], "Already feeder");
        isFeeder[f] = true;
        emit FeederAdded(f);
    }

    function removeFeeder(address f) external onlyOwner {
        isFeeder[f] = false;
        emit FeederRemoved(f);
    }

    // â”€â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function _aggregateRound(bytes32 asset, uint256 /*round*/) internal {
        address[] storage feeders = pendingFeeders[asset];
        uint256 sum;
        for (uint256 i = 0; i < feeders.length; i++) {
            sum += pendingPrice[asset][feeders[i]];
        }
        uint256 median = sum / feeders.length; // simple mean; replace with median for production

        // Circuit breaker
        RoundData[] storage history = rounds[asset];
        if (history.length > 0) {
            uint256 last = history[history.length - 1].price;
            uint256 diff = median > last ? median - last : last - median;
            if (diff * 10_000 > last * maxDeviation) {
                emit CircuitBreakerTripped(asset, median, last);
                _clearPending(asset);
                return;
            }
        }

        // Commit price
        rounds[asset].push(RoundData(median, block.timestamp));

        // Update TWAP accumulator
        TWAPAccumulator storage acc = twaps[asset];
        if (acc.lastTimestamp > 0) {
            acc.priceCumulative += acc.lastPrice * (block.timestamp - acc.lastTimestamp);
        }
        acc.lastPrice     = median;
        acc.lastTimestamp = block.timestamp;

        pendingRound[asset]++;
        _clearPending(asset);

        emit PriceUpdated(asset, median, block.timestamp);
    }

    function _clearPending(bytes32 asset) internal {
        address[] storage feeders = pendingFeeders[asset];
        for (uint256 i = 0; i < feeders.length; i++) {
            delete pendingPrice[asset][feeders[i]];
        }
        delete pendingFeeders[asset];
    }

    function _twapStart(bytes32 asset) internal view returns (uint256) {
        RoundData[] storage h = rounds[asset];
        if (h.length == 0) return block.timestamp;
        uint256 windowStart = block.timestamp - twapWindow;
        return h[0].timestamp < windowStart ? windowStart : h[0].timestamp;
    }
}

