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
