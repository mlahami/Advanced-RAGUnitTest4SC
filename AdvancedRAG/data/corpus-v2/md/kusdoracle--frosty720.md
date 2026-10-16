# kusdoracle--frosty720

- domain: price-oracles (oracle)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/frosty720/K_Oracles @ ef83045ad9c52f2bdea56ab86aadb7f84337d27e
- license: MIT
- targets: KUSDOracle.sol, KUSDOracleFactory.sol
- validation: 17 passing tests, 0 failing; statement coverage KUSDOracle.sol 91.11 %, KUSDOracleFactory.sol 25.64 %

## Contract: KUSDOracle.sol (primary target)

```solidity
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
```

## Contract: KUSDOracleFactory.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./KUSDOracle.sol";

/**
 * @title KUSDOracleFactory
 * @dev Factory contract for deploying and managing KUSD oracles
 */
contract KUSDOracleFactory {
    // --- Auth ---
    mapping(address => uint256) public wards;
    function rely(address usr) external auth { wards[usr] = 1; emit Rely(usr); }
    function deny(address usr) external auth { wards[usr] = 0; emit Deny(usr); }
    modifier auth {
        require(wards[msg.sender] == 1, "KUSDOracleFactory/not-authorized");
        _;
    }

    // --- Data ---
    mapping(bytes32 => address) public oracles;     // asset => oracle address
    mapping(address => bytes32) public oracleAssets; // oracle => asset
    bytes32[] public assetList;                      // List of all assets
    
    // Events
    event OracleDeployed(bytes32 indexed asset, address indexed oracle);
    event OracleUpdated(bytes32 indexed asset, address indexed oldOracle, address indexed newOracle);
    event Rely(address indexed usr);
    event Deny(address indexed usr);

    constructor() {
        wards[msg.sender] = 1;
        emit Rely(msg.sender);
    }

    /**
     * @dev Deploy a new oracle for an asset
     */
    function deployOracle(bytes32 asset) external auth returns (address) {
        require(asset != bytes32(0), "KUSDOracleFactory/invalid-asset");
        require(oracles[asset] == address(0), "KUSDOracleFactory/oracle-exists");
        
        // Deploy new oracle
        KUSDOracle oracle = new KUSDOracle(asset);
        
        // Store mapping
        oracles[asset] = address(oracle);
        oracleAssets[address(oracle)] = asset;
        assetList.push(asset);
        
        // Grant factory auth to oracle for initial setup
        oracle.rely(address(this));
        oracle.rely(msg.sender);
        
        emit OracleDeployed(asset, address(oracle));
        return address(oracle);
    }

    /**
     * @dev Update oracle address for an asset
     */
    function updateOracle(bytes32 asset, address newOracle) external auth {
        require(asset != bytes32(0), "KUSDOracleFactory/invalid-asset");
        require(newOracle != address(0), "KUSDOracleFactory/invalid-oracle");
        
        address oldOracle = oracles[asset];
        require(oldOracle != address(0), "KUSDOracleFactory/oracle-not-exists");
        
        // Update mappings
        oracles[asset] = newOracle;
        oracleAssets[oldOracle] = bytes32(0);
        oracleAssets[newOracle] = asset;
        
        emit OracleUpdated(asset, oldOracle, newOracle);
    }

    /**
     * @dev Get oracle address for an asset
     */
    function getOracle(bytes32 asset) external view returns (address) {
        return oracles[asset];
    }

    /**
     * @dev Get asset for an oracle
     */
    function getAsset(address oracle) external view returns (bytes32) {
        return oracleAssets[oracle];
    }

    /**
     * @dev Get all assets
     */
    function getAllAssets() external view returns (bytes32[] memory) {
        return assetList;
    }

    /**
     * @dev Get oracle count
     */
    function getOracleCount() external view returns (uint256) {
        return assetList.length;
    }

    /**
     * @dev Batch register oracle nodes across multiple oracles
     */
    function batchRegisterNode(
        bytes32[] calldata assets,
        address nodeAddress,
        uint256 stake
    ) external auth {
        require(nodeAddress != address(0), "KUSDOracleFactory/invalid-node");
        
        for (uint256 i = 0; i < assets.length; i++) {
            address oracle = oracles[assets[i]];
            require(oracle != address(0), "KUSDOracleFactory/oracle-not-exists");
            
            KUSDOracle(oracle).registerNode(nodeAddress, stake);
        }
    }

    /**
     * @dev Batch deactivate oracle nodes across multiple oracles
     */
    function batchDeactivateNode(
        bytes32[] calldata assets,
        address nodeAddress,
        string calldata reason
    ) external auth {
        require(nodeAddress != address(0), "KUSDOracleFactory/invalid-node");
        
        for (uint256 i = 0; i < assets.length; i++) {
            address oracle = oracles[assets[i]];
            require(oracle != address(0), "KUSDOracleFactory/oracle-not-exists");
            
            KUSDOracle(oracle).deactivateNode(nodeAddress, reason);
        }
    }

    /**
     * @dev Emergency invalidate prices across all oracles
     */
    function emergencyInvalidateAll() external auth {
        for (uint256 i = 0; i < assetList.length; i++) {
            address oracle = oracles[assetList[i]];
            if (oracle != address(0)) {
                KUSDOracle(oracle).invalidatePrice();
            }
        }
    }

    /**
     * @dev Get price data for all assets
     */
    function getAllPrices() external view returns (
        bytes32[] memory assets,
        uint256[] memory prices,
        uint256[] memory timestamps,
        bool[] memory validities
    ) {
        uint256 length = assetList.length;
        assets = new bytes32[](length);
        prices = new uint256[](length);
        timestamps = new uint256[](length);
        validities = new bool[](length);
        
        for (uint256 i = 0; i < length; i++) {
            assets[i] = assetList[i];
            address oracle = oracles[assetList[i]];
            
            if (oracle != address(0)) {
                (prices[i], timestamps[i], validities[i]) = KUSDOracle(oracle).getPriceData();
            }
        }
    }
}
```

## Tests: KUSDOracle.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KUSDOracle", function () {
    let oracle;
    let factory;
    let owner;
    let node1;
    let node2;
    let unauthorized;

    const BTC_ASSET = ethers.encodeBytes32String("BTC");
    const INITIAL_PRICE = ethers.parseEther("50000"); // $50,000
    const STAKE_AMOUNT = ethers.parseEther("1000");

    beforeEach(async function () {
        [owner, node1, node2, unauthorized] = await ethers.getSigners();

        // Deploy factory
        const OracleFactory = await ethers.getContractFactory("KUSDOracleFactory");
        factory = await OracleFactory.deploy();
        await factory.waitForDeployment();

        // Deploy oracle through factory
        const tx = await factory.deployOracle(BTC_ASSET);
        const receipt = await tx.wait();
        
        // Get oracle address from event
        const event = receipt.logs.find(log => {
            try {
                const parsed = factory.interface.parseLog(log);
                return parsed.name === 'OracleDeployed';
            } catch {
                return false;
            }
        });
        
        const oracleAddress = factory.interface.parseLog(event).args.oracle;
        oracle = await ethers.getContractAt("KUSDOracle", oracleAddress);
    });

    describe("Deployment", function () {
        it("Should set the correct asset", async function () {
            expect(await oracle.asset()).to.equal(BTC_ASSET);
        });

        it("Should set deployer as authorized", async function () {
            expect(await oracle.wards(owner.address)).to.equal(1);
        });

        it("Should have initial invalid price", async function () {
            const [price, timestamp, valid] = await oracle.getPriceData();
            expect(valid).to.be.false;
        });
    });

    describe("Node Management", function () {
        it("Should register oracle node", async function () {
            await oracle.registerNode(node1.address, STAKE_AMOUNT);
            
            const nodeInfo = await oracle.nodes(node1.address);
            expect(nodeInfo.active).to.be.true;
            expect(nodeInfo.stake).to.equal(STAKE_AMOUNT);
            expect(nodeInfo.reputation).to.equal(100);
        });

        it("Should not allow unauthorized node registration", async function () {
            await expect(
                oracle.connect(unauthorized).registerNode(node1.address, STAKE_AMOUNT)
            ).to.be.revertedWith("KUSDOracle/not-authorized");
        });

        it("Should deactivate oracle node", async function () {
            await oracle.registerNode(node1.address, STAKE_AMOUNT);
            await oracle.deactivateNode(node1.address, "Test deactivation");
            
            const nodeInfo = await oracle.nodes(node1.address);
            expect(nodeInfo.active).to.be.false;
        });
    });

    describe("Price Updates", function () {
        beforeEach(async function () {
            // Register node1 as oracle node
            await oracle.registerNode(node1.address, STAKE_AMOUNT);
        });

        it("Should update price with valid sources", async function () {
            const sourcePrices = [
                ethers.parseEther("49900"), // $49,900
                ethers.parseEther("50000"), // $50,000
                ethers.parseEther("50100")  // $50,100
            ];
            const sources = [
                ethers.encodeBytes32String("binance"),
                ethers.encodeBytes32String("coinbase"),
                ethers.encodeBytes32String("coingecko")
            ];

            await oracle.connect(node1).updatePrice(INITIAL_PRICE, sourcePrices, sources);
            
            const [price, timestamp, valid] = await oracle.getPriceData();
            expect(price).to.equal(INITIAL_PRICE);
            expect(valid).to.be.true;
            expect(timestamp).to.be.greaterThan(0);
        });

        it("Should reject price update from unauthorized node", async function () {
            const sourcePrices = [ethers.parseEther("50000")];
            const sources = [ethers.encodeBytes32String("binance")];

            await expect(
                oracle.connect(unauthorized).updatePrice(INITIAL_PRICE, sourcePrices, sources)
            ).to.be.revertedWith("KUSDOracle/node-not-active");
        });

        it("Should reject price update with insufficient sources", async function () {
            const sourcePrices = [ethers.parseEther("50000")]; // Only 1 source
            const sources = [ethers.encodeBytes32String("binance")];

            await expect(
                oracle.connect(node1).updatePrice(INITIAL_PRICE, sourcePrices, sources)
            ).to.be.revertedWith("KUSDOracle/insufficient-sources");
        });

        it("Should reject price update with high deviation", async function () {
            const sourcePrices = [
                ethers.parseEther("40000"), // $40,000 (20% below)
                ethers.parseEther("45000"), // $45,000 (10% below)
                ethers.parseEther("60000")  // $60,000 (20% above)
            ];
            const sources = [
                ethers.encodeBytes32String("binance"),
                ethers.encodeBytes32String("coinbase"),
                ethers.encodeBytes32String("coingecko")
            ];

            // Try to submit price that's too far from median
            const badPrice = ethers.parseEther("70000"); // $70,000 (way above median)

            await expect(
                oracle.connect(node1).updatePrice(badPrice, sourcePrices, sources)
            ).to.be.revertedWith("KUSDOracle/price-validation-failed");
        });
    });

    describe("Price Reading", function () {
        beforeEach(async function () {
            await oracle.registerNode(node1.address, STAKE_AMOUNT);
            
            // Submit initial price
            const sourcePrices = [
                ethers.parseEther("49900"),
                ethers.parseEther("50000"),
                ethers.parseEther("50100")
            ];
            const sources = [
                ethers.encodeBytes32String("binance"),
                ethers.encodeBytes32String("coinbase"),
                ethers.encodeBytes32String("coingecko")
            ];
            
            await oracle.connect(node1).updatePrice(INITIAL_PRICE, sourcePrices, sources);
        });

        it("Should return valid price through peek()", async function () {
            const [price, valid] = await oracle.peek();
            expect(price).to.equal(ethers.zeroPadValue(ethers.toBeHex(INITIAL_PRICE), 32));
            expect(valid).to.be.true;
        });

        it("Should return price through read()", async function () {
            const price = await oracle.read();
            expect(price).to.equal(ethers.zeroPadValue(ethers.toBeHex(INITIAL_PRICE), 32));
        });

        it("Should return false for stale price", async function () {
            // Fast forward time by 2 hours (beyond staleness threshold)
            await ethers.provider.send("evm_increaseTime", [7200]);
            await ethers.provider.send("evm_mine");

            const [, valid] = await oracle.peek();
            expect(valid).to.be.false;
        });
    });

    describe("Emergency Functions", function () {
        beforeEach(async function () {
            await oracle.registerNode(node1.address, STAKE_AMOUNT);
        });

        it("Should allow emergency price update", async function () {
            const emergencyPrice = ethers.parseEther("45000");
            
            await oracle.emergencyUpdatePrice(emergencyPrice);
            
            const [price, , valid] = await oracle.getPriceData();
            expect(price).to.equal(emergencyPrice);
            expect(valid).to.be.true;
        });

        it("Should allow price invalidation", async function () {
            // First set a valid price
            const sourcePrices = [ethers.parseEther("50000")];
            const sources = [ethers.encodeBytes32String("binance")];
            
            await oracle.connect(node1).updatePrice(INITIAL_PRICE, [ethers.parseEther("50000"), ethers.parseEther("50000"), ethers.parseEther("50000")], [ethers.encodeBytes32String("binance"), ethers.encodeBytes32String("coinbase"), ethers.encodeBytes32String("coingecko")]);
            
            // Then invalidate it
            await oracle.invalidatePrice();
            
            const [, , valid] = await oracle.getPriceData();
            expect(valid).to.be.false;
        });
    });

    describe("View Functions", function () {
        it("Should return correct freshness status", async function () {
            // Initially not fresh (no price set)
            expect(await oracle.isFresh()).to.be.false;
            
            // Set price
            await oracle.registerNode(node1.address, STAKE_AMOUNT);
            await oracle.connect(node1).updatePrice(INITIAL_PRICE, [ethers.parseEther("50000"), ethers.parseEther("50000"), ethers.parseEther("50000")], [ethers.encodeBytes32String("binance"), ethers.encodeBytes32String("coinbase"), ethers.encodeBytes32String("coingecko")]);
            
            // Now should be fresh
            expect(await oracle.isFresh()).to.be.true;
        });

        it("Should return correct active node count", async function () {
            expect(await oracle.getActiveNodeCount()).to.equal(0);
            
            await oracle.registerNode(node1.address, STAKE_AMOUNT);
            expect(await oracle.getActiveNodeCount()).to.equal(1);
            
            await oracle.registerNode(node2.address, STAKE_AMOUNT);
            expect(await oracle.getActiveNodeCount()).to.equal(2);
            
            await oracle.deactivateNode(node1.address, "Test");
            expect(await oracle.getActiveNodeCount()).to.equal(1);
        });
    });
});
```
