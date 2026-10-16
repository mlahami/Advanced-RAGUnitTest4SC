// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RateLimiter
 * @notice Token-bucket rate limiter that protects a dummy vault.
 *         Each caller gets an independent bucket that refills over time.
 *         Useful for testing security-aware prompt responses.
 * Complexity: Moderate
 */
contract RateLimiter {
    struct Bucket {
        uint256 tokens;       // current token count
        uint256 lastRefill;   // last refill timestamp
    }

    uint256 public immutable capacity;      // max tokens in bucket
    uint256 public immutable refillRate;    // tokens per second
    uint256 public immutable costPerCall;   // tokens consumed per action

    address public owner;
    mapping(address => Bucket) public buckets;
    mapping(address => uint256) public vaultBalance; // dummy per-user vault

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event BucketRefilled(address indexed user, uint256 newTokens);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    constructor(uint256 _capacity, uint256 _refillRate, uint256 _costPerCall) {
        require(_capacity > 0 && _refillRate > 0 && _costPerCall > 0, "Zero param");
        capacity     = _capacity;
        refillRate   = _refillRate;
        costPerCall  = _costPerCall;
        owner        = msg.sender;
    }

    // â”€â”€â”€ Rate-limited vault actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function deposit() external payable {
        _consumeTokens(msg.sender);
        vaultBalance[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _consumeTokens(msg.sender);
        require(vaultBalance[msg.sender] >= amount, "Insufficient balance");
        vaultBalance[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    // â”€â”€â”€ Views â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function availableTokens(address user) external view returns (uint256) {
        return _currentTokens(user);
    }

    // â”€â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function _consumeTokens(address user) internal {
        uint256 current = _currentTokens(user);
        require(current >= costPerCall, "Rate limit exceeded");
        buckets[user].tokens    = current - costPerCall;
        buckets[user].lastRefill = block.timestamp;
    }

    function _currentTokens(address user) internal view returns (uint256) {
        Bucket storage b = buckets[user];
        if (b.lastRefill == 0) return capacity; // new user starts full
        uint256 elapsed  = block.timestamp - b.lastRefill;
        uint256 refilled = elapsed * refillRate;
        uint256 total    = b.tokens + refilled;
        return total > capacity ? capacity : total;
    }
}

