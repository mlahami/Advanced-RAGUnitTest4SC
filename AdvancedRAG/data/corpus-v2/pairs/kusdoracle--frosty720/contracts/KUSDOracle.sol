// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title KUSDOracle
 * @dev Price oracle for KUSD system compatible with MakerDAO DSS
 * Implements PipLike interface for seamless integration
 */
contract KUSDOracle {
    // --- Auth ---
    mapping(address => uint256) public wards;
    function rely(address usr) external auth { wards[usr] = 1; emit Rely(usr); }
    function deny(address usr) external auth { wards[usr] = 0; emit Deny(usr); }
    modifier auth {
        require(wards[msg.sender] == 1, "KUSDOracle/not-authorized");
        _;
    }

    // --- Data ---
    struct PriceData {
        uint256 price;      // Price in USD (18 decimals)
        uint256 timestamp;  // When price was last updated
        bool valid;         // Is price data valid
    }

    struct OracleNode {
        address nodeAddress;
        uint256 stake;
        uint256 reputation;
        bool active;
        uint256 lastUpdate;
    }

    // State variables
    bytes32 public immutable asset;           // Asset symbol (BTC, ETH, etc.)
    PriceData public priceData;              // Current price data
    mapping(address => OracleNode) public nodes; // Oracle node registry
    address[] public nodeList;               // List of all nodes
    
    // Configuration
    uint256 public constant STALENESS_THRESHOLD = 3600;  // 1 hour
    uint256 public constant MAX_DEVIATION = 1000;        // 10% (basis points)
    uint256 public constant MIN_SOURCES = 3;             // Minimum price sources
    uint256 public requiredConfirmations = 3;            // Required confirmations
    
    // Events
    event PriceUpdate(uint256 indexed price, uint256 timestamp, address updater);
    event NodeRegistered(address indexed node, uint256 stake);
    event NodeDeactivated(address indexed node, string reason);
    event Rely(address indexed usr);
    event Deny(address indexed usr);

    constructor(bytes32 _asset) {
        asset = _asset;
        wards[msg.sender] = 1;
        emit Rely(msg.sender);
    }

    // --- MakerDAO DSS Compatible Interface ---
    /**
     * @dev Returns current price and validity (PipLike interface)
     * This is the main function called by MakerDAO DSS contracts
     */
    function peek() external view returns (bytes32, bool) {
        bool fresh = block.timestamp - priceData.timestamp <= STALENESS_THRESHOLD;
        bool valid = priceData.valid && fresh && priceData.price > 0;
        
        return (bytes32(priceData.price), valid);
    }

    /**
     * @dev Returns current price (alternative interface)
     */
    function read() external view returns (bytes32) {
        require(priceData.valid, "KUSDOracle/invalid-price");
        require(block.timestamp - priceData.timestamp <= STALENESS_THRESHOLD, "KUSDOracle/stale-price");
        
        return bytes32(priceData.price);
    }

    // --- Oracle Node Management ---
    /**
     * @dev Register a new oracle node
     */
    function registerNode(address nodeAddress, uint256 stake) external auth {
        require(nodeAddress != address(0), "KUSDOracle/invalid-address");
        require(!nodes[nodeAddress].active, "KUSDOracle/node-already-active");
        
        nodes[nodeAddress] = OracleNode({
            nodeAddress: nodeAddress,
            stake: stake,
            reputation: 100, // Start with 100% reputation
            active: true,
            lastUpdate: 0
        });
        
        nodeList.push(nodeAddress);
        emit NodeRegistered(nodeAddress, stake);
    }

    /**
     * @dev Deactivate an oracle node
     */
    function deactivateNode(address nodeAddress, string calldata reason) external auth {
        require(nodes[nodeAddress].active, "KUSDOracle/node-not-active");
        
        nodes[nodeAddress].active = false;
        emit NodeDeactivated(nodeAddress, reason);
    }

    // --- Price Updates ---
    /**
     * @dev Update price with validation from multiple sources
     */
    function updatePrice(
        uint256 newPrice,
        uint256[] calldata sourcePrices,
        bytes32[] calldata sources
    ) external {
        require(nodes[msg.sender].active, "KUSDOracle/node-not-active");
        require(newPrice > 0, "KUSDOracle/invalid-price");
        require(sourcePrices.length >= MIN_SOURCES, "KUSDOracle/insufficient-sources");
        require(sourcePrices.length == sources.length, "KUSDOracle/mismatched-arrays");
        
        // Validate price against sources
        require(_validatePrice(newPrice, sourcePrices), "KUSDOracle/price-validation-failed");
        
        // Update price data
        priceData = PriceData({
            price: newPrice,
            timestamp: block.timestamp,
            valid: true
        });
        
        // Update node info
        nodes[msg.sender].lastUpdate = block.timestamp;
        
        emit PriceUpdate(newPrice, block.timestamp, msg.sender);
    }

    /**
     * @dev Emergency price update (governance only)
     */
    function emergencyUpdatePrice(uint256 newPrice) external auth {
        require(newPrice > 0, "KUSDOracle/invalid-price");
        
        priceData = PriceData({
            price: newPrice,
            timestamp: block.timestamp,
            valid: true
        });
        
        emit PriceUpdate(newPrice, block.timestamp, msg.sender);
    }

    /**
     * @dev Invalidate current price (emergency stop)
     */
    function invalidatePrice() external auth {
        priceData.valid = false;
    }

    // --- Internal Functions ---
    /**
     * @dev Validate price against multiple sources
     */
    function _validatePrice(
        uint256 newPrice,
        uint256[] calldata sourcePrices
    ) internal pure returns (bool) {
        if (sourcePrices.length < MIN_SOURCES) return false;
        
        // Calculate median of source prices
        uint256 median = _calculateMedian(sourcePrices);
        
        // Check if new price is within acceptable deviation from median
        uint256 deviation = newPrice > median ? 
            ((newPrice - median) * 10000) / median :
            ((median - newPrice) * 10000) / median;
            
        return deviation <= MAX_DEVIATION;
    }

    /**
     * @dev Calculate median of price array
     */
    function _calculateMedian(uint256[] calldata prices) internal pure returns (uint256) {
        uint256[] memory sortedPrices = new uint256[](prices.length);
        
        // Copy array
        for (uint256 i = 0; i < prices.length; i++) {
            sortedPrices[i] = prices[i];
        }
        
        // Simple bubble sort (fine for small arrays)
        for (uint256 i = 0; i < sortedPrices.length - 1; i++) {
            for (uint256 j = 0; j < sortedPrices.length - i - 1; j++) {
                if (sortedPrices[j] > sortedPrices[j + 1]) {
                    uint256 temp = sortedPrices[j];
                    sortedPrices[j] = sortedPrices[j + 1];
                    sortedPrices[j + 1] = temp;
                }
            }
        }
        
        // Return median
        uint256 mid = sortedPrices.length / 2;
        if (sortedPrices.length % 2 == 0) {
            return (sortedPrices[mid - 1] + sortedPrices[mid]) / 2;
        } else {
            return sortedPrices[mid];
        }
    }

    // --- View Functions ---
    /**
     * @dev Get current price info
     */
    function getPriceData() external view returns (uint256 price, uint256 timestamp, bool valid) {
        return (priceData.price, priceData.timestamp, priceData.valid);
    }

    /**
     * @dev Check if price is fresh
     */
    function isFresh() external view returns (bool) {
        return block.timestamp - priceData.timestamp <= STALENESS_THRESHOLD;
    }

    /**
     * @dev Get active node count
     */
    function getActiveNodeCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodes[nodeList[i]].active) {
                count++;
            }
        }
        return count;
    }
}
