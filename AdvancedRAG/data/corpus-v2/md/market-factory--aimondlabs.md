# market-factory--aimondlabs

- domain: games-lotteries (prediction-market)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/AimondLabs/nostra-contracts @ 75a1ed0b75610fae1a857fc78555e22e1e8db53e
- license: MIT
- targets: MarketFactory.sol, ICTFExchange.sol, IConditionalTokens.sol, ConditionalTokens.sol, MockUSDC.sol
- validation: 27 passing tests, 0 failing; statement coverage MarketFactory.sol 79.31 %, ICTFExchange.sol 100.0 %, IConditionalTokens.sol 100.0 %, ConditionalTokens.sol 81.82 %, MockUSDC.sol 50.0 %

## Contract: ConditionalTokens.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Mock Conditional Tokens
 * @notice Simplified mock implementation of Conditional Tokens Framework
 * @dev For testing purposes only
 */
contract ConditionalTokens is ERC1155, Ownable {
    struct Condition {
        address oracle;
        bytes32 questionId;
        uint256 outcomeSlotCount;
        bool isResolved;
        uint256[] payouts;
    }

    mapping(bytes32 => Condition) public conditions;
    mapping(bytes32 => bool) public preparedConditions;
    mapping(uint256 => bytes32) public tokenToCondition;

    event ConditionPreparation(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount
    );

    event ConditionResolution(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount,
        uint256[] payoutNumerators
    );
    
    event DebugReportPayouts(
        bytes32 indexed conditionId,
        uint256[] payouts
    );

    event PositionSplit(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    event PositionsMerge(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    constructor() ERC1155("") Ownable(msg.sender) {}

    function prepareCondition(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external {
        bytes32 conditionId = getConditionId(oracle, questionId, outcomeSlotCount);
        require(!preparedConditions[conditionId], "Condition already prepared");

        conditions[conditionId] = Condition({
            oracle: oracle,
            questionId: questionId,
            outcomeSlotCount: outcomeSlotCount,
            isResolved: false,
            payouts: new uint256[](outcomeSlotCount)
        });

        preparedConditions[conditionId] = true;

        emit ConditionPreparation(conditionId, oracle, questionId, outcomeSlotCount);
    }

    function splitPosition(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external {
        require(preparedConditions[conditionId], "Condition not prepared");
        require(collateralToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // Mint outcome tokens
        for (uint256 i = 0; i < partition.length; i++) {
            uint256 tokenId = getPositionId(collateralToken, getCollectionId(parentCollectionId, conditionId, partition[i]));
            _mint(msg.sender, tokenId, amount, "");
            tokenToCondition[tokenId] = conditionId;
        }

        emit PositionSplit(msg.sender, collateralToken, parentCollectionId, conditionId, partition, amount);
    }

    function mergePositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external {
        require(preparedConditions[conditionId], "Condition not prepared");

        // Burn outcome tokens
        for (uint256 i = 0; i < partition.length; i++) {
            uint256 tokenId = getPositionId(collateralToken, getCollectionId(parentCollectionId, conditionId, partition[i]));
            _burn(msg.sender, tokenId, amount);
        }

        // Transfer collateral back
        require(collateralToken.transfer(msg.sender, amount), "Transfer failed");

        emit PositionsMerge(msg.sender, collateralToken, parentCollectionId, conditionId, partition, amount);
    }

    function reportPayouts(
        bytes32 questionId,
        uint256[] calldata payouts
    ) external {
        // Find condition by questionId using the same calculation as getConditionId
        bytes32 conditionId = getConditionId(msg.sender, questionId, payouts.length);
        // Debug: Log the conditionId being used
        emit DebugReportPayouts(conditionId, payouts);
        // Debug: Check if condition exists
        require(preparedConditions[conditionId], "Condition not found");

        Condition storage condition = conditions[conditionId];
        require(!condition.isResolved, "Already resolved");
        require(payouts.length == condition.outcomeSlotCount, "Invalid payouts length");

        condition.isResolved = true;
        // Copy the payouts array
        condition.payouts = new uint256[](payouts.length);
        for (uint256 i = 0; i < payouts.length; i++) {
            condition.payouts[i] = payouts[i];
        }
        
        emit ConditionResolution(conditionId, condition.oracle, questionId, condition.outcomeSlotCount, payouts);
    }

    function redeemPositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external {
        Condition storage condition = conditions[conditionId];
        require(condition.isResolved, "Not resolved");

        uint256 totalPayout = 0;
        for (uint256 i = 0; i < indexSets.length; i++) {
            uint256 tokenId = getPositionId(collateralToken, getCollectionId(parentCollectionId, conditionId, indexSets[i]));
            uint256 balance = balanceOf(msg.sender, tokenId);
            if (balance > 0) {
                // Calculate the outcome index from the indexSet
                // For binary market: indexSet 1 = outcome 0, indexSet 2 = outcome 1
                uint256 outcomeIndex = 0;
                uint256 temp = indexSets[i];
                while (temp > 1) {
                    temp = temp >> 1;
                    outcomeIndex++;
                }
                
                require(condition.payouts.length > outcomeIndex, "Payout not set");
                uint256 payout = (balance * condition.payouts[outcomeIndex]) / 100;
                totalPayout += payout;
                _burn(msg.sender, tokenId, balance);
            }
        }
        
        // Debug: Log the total payout
        emit DebugReportPayouts(conditionId, new uint256[](0)); // Use empty array to avoid issues

        if (totalPayout > 0) {
            require(collateralToken.transfer(msg.sender, totalPayout), "Transfer failed");
        }
    }

    function getPositionId(
        IERC20 collateralToken,
        bytes32 collectionId
    ) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(collateralToken, collectionId)));
    }

    function getCollectionId(
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256 indexSet
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(parentCollectionId, conditionId, indexSet));
    }

    function getConditionId(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount));
    }

    function payoutDenominator(bytes32 conditionId) external view returns (uint256) {
        return 100; // Simplified: always 100
    }

    function payoutNumerators(
        bytes32 conditionId,
        uint256 index
    ) external view returns (uint256) {
        return conditions[conditionId].payouts[index];
    }
}
```

## Contract: IConditionalTokens.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Conditional Tokens Interface
 * @notice ERC1155-based conditional tokens following Gnosis CTF standard
 * @dev Based on Polymarket CTF Exchange implementation
 */
interface IConditionalTokens {
    /// @notice Prepares a condition with a specific oracle and question ID
    /// @param oracle - Address that will report the outcome
    /// @param questionId - Unique identifier for the question
    /// @param outcomeSlotCount - Number of possible outcomes (usually 2 for binary)
    function prepareCondition(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external;

    /// @notice Splits collateral into outcome tokens
    /// @param collateralToken - The ERC20 collateral token
    /// @param parentCollectionId - Parent collection (usually bytes32(0))
    /// @param conditionId - The condition being split
    /// @param partition - Array of outcome indices [1, 2] for binary
    /// @param amount - Amount of collateral to split
    function splitPosition(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external;

    /// @notice Merges outcome tokens back into collateral
    /// @param collateralToken - The ERC20 collateral token
    /// @param parentCollectionId - Parent collection (usually bytes32(0))
    /// @param conditionId - The condition being merged
    /// @param partition - Array of outcome indices [1, 2] for binary
    /// @param amount - Amount to merge
    function mergePositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external;

    /// @notice Reports the outcome of a condition
    /// @param questionId - The question identifier
    /// @param payouts - Array of payouts for each outcome [0, 1] or [1, 0]
    function reportPayouts(
        bytes32 questionId,
        uint256[] calldata payouts
    ) external;

    /// @notice Redeems positions after resolution
    /// @param collateralToken - The ERC20 collateral token
    /// @param parentCollectionId - Parent collection
    /// @param conditionId - The resolved condition
    /// @param indexSets - Outcome index sets to redeem
    function redeemPositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external;

    /// @notice Gets the position ID (token ID) for a given collection and outcome
    function getPositionId(
        IERC20 collateralToken,
        bytes32 collectionId
    ) external pure returns (uint256);

    /// @notice Gets the collection ID for a condition and index set
    function getCollectionId(
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256 indexSet
    ) external view returns (bytes32);

    /// @notice Generates condition ID from oracle, question, and slot count
    function getConditionId(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external pure returns (bytes32);

    /// @notice Gets payout for a resolved condition
    function payoutDenominator(bytes32 conditionId) external view returns (uint256);

    /// @notice Gets outcome payout
    function payoutNumerators(
        bytes32 conditionId,
        uint256 index
    ) external view returns (uint256);

    /// @notice Events
    event ConditionPreparation(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount
    );

    event ConditionResolution(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount,
        uint256[] payoutNumerators
    );

    event PositionSplit(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    event PositionsMerge(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    event PayoutRedemption(
        address indexed redeemer,
        IERC20 indexed collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 conditionId,
        uint256[] indexSets,
        uint256 payout
    );
}
```

## Contract: ICTFExchange.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IConditionalTokens.sol";

/**
 * @title CTF Exchange Interface
 * @notice Interface for the CTF Exchange contract
 * @dev Based on Polymarket CTF Exchange implementation
 */
interface ICTFExchange {
    /// @notice Registers a token pair for trading
    /// @param token - Token ID
    /// @param complement - Complement token ID
    /// @param conditionId - CTF condition ID
    function registerToken(
        uint256 token,
        uint256 complement,
        bytes32 conditionId
    ) external;

    /// @notice Fills an order
    /// @param order - The order to be filled
    /// @param fillAmount - The amount to fill (in maker amount terms)
    function fillOrder(
        Order memory order,
        uint256 fillAmount
    ) external;

    /// @notice Fills multiple orders
    /// @param orders - Orders to be filled
    /// @param fillAmounts - Fill amounts (in maker amount terms)
    function fillOrders(
        Order[] memory orders,
        uint256[] memory fillAmounts
    ) external;

    /// @notice Matches a taker order against maker orders
    /// @param takerOrder - Active order
    /// @param makerOrders - Passive orders to match against
    /// @param takerFillAmount - Amount to fill on taker
    /// @param makerFillAmounts - Amounts to fill on makers
    function matchOrders(
        Order memory takerOrder,
        Order[] memory makerOrders,
        uint256 takerFillAmount,
        uint256[] memory makerFillAmounts
    ) external;

    /// @notice Cancels an order
    /// @param order - The order to be cancelled
    function cancelOrder(Order memory order) external;

    /// @notice Cancels multiple orders
    /// @param orders - The orders to be cancelled
    function cancelOrders(Order[] memory orders) external;

    /// @notice Validates an order
    /// @param order - The order to be validated
    function validateOrder(Order memory order) external view;

    /// @notice Gets order status
    /// @param orderHash - The order hash
    function getOrderStatus(bytes32 orderHash) external view returns (OrderStatus memory);

    /// @notice Hashes an order
    /// @param order - The order to hash
    function hashOrder(Order memory order) external pure returns (bytes32);

    /// @notice Events
    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        uint256 makerAssetId,
        uint256 takerAssetId,
        uint256 makerAmountFilled,
        uint256 takerAmountFilled,
        uint256 fee
    );

    event OrdersMatched(
        bytes32 indexed takerOrderHash,
        address indexed takerOrderMaker,
        uint256 makerAssetId,
        uint256 takerAssetId,
        uint256 makerAmountFilled,
        uint256 takerAmountFilled
    );

    event OrderCancelled(bytes32 indexed orderHash);

    event FeeCharged(
        address indexed receiver,
        uint256 tokenId,
        uint256 amount
    );
}

// Order structures (simplified for interface)
struct Order {
    uint256 salt;
    address maker;
    address signer;
    address taker;
    uint256 tokenId;
    uint256 makerAmount;
    uint256 takerAmount;
    uint256 expiration;
    uint256 nonce;
    uint256 feeRateBps;
    Side side;
    SignatureType signatureType;
    bytes signature;
}

enum Side {
    BUY,
    SELL
}

enum SignatureType {
    EOA,
    POLY_PROXY,
    POLY_GNOSIS_SAFE
}

struct OrderStatus {
    bool isFilledOrCancelled;
    uint256 remaining;
}
```

## Contract: MarketFactory.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IConditionalTokens.sol";
import "./ICTFExchange.sol";

/**
 * @title Market Factory
 * @notice Factory for creating prediction markets
 * @dev Based on Polymarket CTF Exchange implementation
 */
contract MarketFactory is Ownable, ReentrancyGuard {
    IConditionalTokens public immutable ctf;
    address public immutable collateralToken;
    address public exchange;
    address public oracle;

    // Market registry
    mapping(bytes32 => Market) public markets;
    mapping(uint256 => bytes32) public tokenToCondition;
    mapping(bytes32 => bool) public questionIds;

    struct Market {
        bytes32 conditionId;
        string question;
        string description;
        string category;
        uint256 outcomeSlotCount;
        uint256[] tokenIds;
        uint256 endTime;
        uint256 resolutionTime;
        MarketStatus status;
        address creator;
        uint256 createdAt;
    }

    enum MarketStatus {
        Active,
        Closed,
        Resolved,
        Canceled
    }

    event MarketCreated(
        bytes32 indexed conditionId,
        bytes32 indexed questionId,
        string question,
        uint256 outcomeSlotCount,
        uint256[] tokenIds,
        address creator
    );

    event MarketResolved(
        bytes32 indexed conditionId,
        uint256[] payouts
    );

    event MarketClosed(
        bytes32 indexed conditionId
    );

    event MarketCanceled(
        bytes32 indexed conditionId
    );

    error InvalidEndTime();
    error InvalidResolutionTime();
    error InvalidOutcomeCount();
    error QuestionIdAlreadyExists();
    error MarketNotActive();
    error NotAuthorized();
    error ExchangeNotSet();

    modifier onlyExchange() {
        if (msg.sender != exchange) revert NotAuthorized();
        _;
    }

    constructor(
        address _ctf,
        address _collateralToken,
        address _oracle
    ) Ownable(msg.sender) {
        ctf = IConditionalTokens(_ctf);
        collateralToken = _collateralToken;
        oracle = _oracle;
    }

    /// @notice Creates a new binary prediction market
    /// @param questionId - Unique identifier for the question
    /// @param question - The market question
    /// @param description - Market description
    /// @param category - Market category
    /// @param endTime - Market end time
    /// @param resolutionTime - Expected resolution time
    function createBinaryMarket(
        bytes32 questionId,
        string calldata question,
        string calldata description,
        string calldata category,
        uint256 endTime,
        uint256 resolutionTime
    ) external returns (bytes32 conditionId, uint256[] memory tokenIds) {
        if (endTime <= block.timestamp) revert InvalidEndTime();
        if (resolutionTime <= endTime) revert InvalidResolutionTime();
        if (questionIds[questionId]) revert QuestionIdAlreadyExists();

        // Mark question ID as used
        questionIds[questionId] = true;

        // Prepare condition in CTF
        ctf.prepareCondition(oracle, questionId, 2);

        // Calculate condition ID
        conditionId = ctf.getConditionId(oracle, questionId, 2);

        // Calculate token IDs for YES and NO outcomes
        tokenIds = new uint256[](2);

        // YES token (index 0)
        bytes32 collectionIdYes = ctf.getCollectionId(
            bytes32(0),
            conditionId,
            1 // indexSet for outcome 0
        );
        tokenIds[0] = ctf.getPositionId(IERC20(collateralToken), collectionIdYes);

        // NO token (index 1)
        bytes32 collectionIdNo = ctf.getCollectionId(
            bytes32(0),
            conditionId,
            2 // indexSet for outcome 1
        );
        tokenIds[1] = ctf.getPositionId(IERC20(collateralToken), collectionIdNo);

        // Store market
        markets[conditionId] = Market({
            conditionId: conditionId,
            question: question,
            description: description,
            category: category,
            outcomeSlotCount: 2,
            tokenIds: tokenIds,
            endTime: endTime,
            resolutionTime: resolutionTime,
            status: MarketStatus.Active,
            creator: msg.sender,
            createdAt: block.timestamp
        });

        // Register tokens
        tokenToCondition[tokenIds[0]] = conditionId;
        tokenToCondition[tokenIds[1]] = conditionId;

        // Register with exchange
        if (exchange != address(0)) {
            ICTFExchange(exchange).registerToken(
                tokenIds[0],
                tokenIds[1],
                conditionId
            );
        }

        emit MarketCreated(
            conditionId,
            questionId,
            question,
            2,
            tokenIds,
            msg.sender
        );
    }

    /// @notice Creates a multiple choice prediction market
    /// @param questionId - Unique identifier for the question
    /// @param question - The market question
    /// @param description - Market description
    /// @param category - Market category
    /// @param outcomeSlotCount - Number of outcomes
    /// @param endTime - Market end time
    /// @param resolutionTime - Expected resolution time
    function createMultipleChoiceMarket(
        bytes32 questionId,
        string calldata question,
        string calldata description,
        string calldata category,
        uint256 outcomeSlotCount,
        uint256 endTime,
        uint256 resolutionTime
    ) external returns (bytes32 conditionId, uint256[] memory tokenIds) {
        if (outcomeSlotCount < 3 || outcomeSlotCount > 256) revert InvalidOutcomeCount();
        if (endTime <= block.timestamp) revert InvalidEndTime();
        if (resolutionTime <= endTime) revert InvalidResolutionTime();
        if (questionIds[questionId]) revert QuestionIdAlreadyExists();

        // Mark question ID as used
        questionIds[questionId] = true;

        // Prepare condition
        ctf.prepareCondition(oracle, questionId, outcomeSlotCount);
        conditionId = ctf.getConditionId(oracle, questionId, outcomeSlotCount);

        // Calculate token IDs for all outcomes
        tokenIds = new uint256[](outcomeSlotCount);
        for (uint256 i = 0; i < outcomeSlotCount; i++) {
            bytes32 collectionId = ctf.getCollectionId(
                bytes32(0),
                conditionId,
                1 << i
            );
            tokenIds[i] = ctf.getPositionId(IERC20(collateralToken), collectionId);
            tokenToCondition[tokenIds[i]] = conditionId;
        }

        // Store market
        markets[conditionId] = Market({
            conditionId: conditionId,
            question: question,
            description: description,
            category: category,
            outcomeSlotCount: outcomeSlotCount,
            tokenIds: tokenIds,
            endTime: endTime,
            resolutionTime: resolutionTime,
            status: MarketStatus.Active,
            creator: msg.sender,
            createdAt: block.timestamp
        });

        emit MarketCreated(
            conditionId,
            questionId,
            question,
            outcomeSlotCount,
            tokenIds,
            msg.sender
        );
    }

    /// @notice Closes a market (no more orders)
    function closeMarket(bytes32 conditionId) external {
        Market storage market = markets[conditionId];
        if (msg.sender != market.creator && msg.sender != oracle) revert NotAuthorized();
        if (market.status != MarketStatus.Active) revert MarketNotActive();

        market.status = MarketStatus.Closed;
        emit MarketClosed(conditionId);
    }

    /// @notice Cancels a market
    function cancelMarket(bytes32 conditionId) external {
        Market storage market = markets[conditionId];
        if (msg.sender != market.creator && msg.sender != owner()) revert NotAuthorized();
        if (market.status != MarketStatus.Active) revert MarketNotActive();

        market.status = MarketStatus.Canceled;
        emit MarketCanceled(conditionId);
    }

    /// @notice Sets the exchange address
    function setExchange(address _exchange) external onlyOwner {
        exchange = _exchange;
    }

    /// @notice Sets the oracle address
    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }

    /// @notice Gets market info
    function getMarket(bytes32 conditionId) external view returns (Market memory) {
        return markets[conditionId];
    }

    /// @notice Gets all markets created by a user
    function getMarketsByCreator(address creator) external view returns (bytes32[] memory) {
        // This would require additional storage mapping in a real implementation
        // For now, return empty array
        return new bytes32[](0);
    }

    /// @notice Checks if a question ID is already used
    function isQuestionIdUsed(bytes32 questionId) external view returns (bool) {
        return questionIds[questionId];
    }
}
```

## Contract: MockUSDC.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Mock USDC
 * @notice Mock USDC token for testing purposes
 * @dev 6 decimals like real USDC
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private constant _DECIMALS = 6;
    
    constructor() ERC20("Mock USD Coin", "mUSDC") Ownable(msg.sender) {
        // Mint 1,000,000 USDC to deployer
        _mint(msg.sender, 1_000_000_000 * 10**_DECIMALS);
    }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Mint tokens to any address (for testing)
    /// @param to - Address to mint to
    /// @param amount - Amount to mint
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Mint tokens to any address (for testing) - anyone can call
    /// @param to - Address to mint to
    /// @param amount - Amount to mint
    function mintForTesting(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: MarketFactory.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MarketFactory", function () {
  let marketFactory;
  let conditionalTokens;
  let owner;
  let user1;
  let user2;
  let collateralToken;
  let oracle;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock contracts
    const ConditionalTokensFactory = await ethers.getContractFactory("ConditionalTokens");
    conditionalTokens = await ConditionalTokensFactory.deploy();
    await conditionalTokens.waitForDeployment();

    // Mock addresses
    collateralToken = ethers.Wallet.createRandom().address;
    oracle = ethers.Wallet.createRandom().address;

    // Deploy MarketFactory
    const MarketFactoryFactory = await ethers.getContractFactory("MarketFactory");
    marketFactory = await MarketFactoryFactory.deploy(
      await conditionalTokens.getAddress(),
      collateralToken,
      oracle
    );
    await marketFactory.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct initial values", async function () {
      expect(await marketFactory.ctf()).to.equal(await conditionalTokens.getAddress());
      expect(await marketFactory.collateralToken()).to.equal(collateralToken);
      expect(await marketFactory.oracle()).to.equal(oracle);
      expect(await marketFactory.owner()).to.equal(owner.address);
    });
  });

  describe("createBinaryMarket", function () {
    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Will Bitcoin reach $100k in 2024?"));
    const question = "Will Bitcoin reach $100k in 2024?";
    const description = "A prediction market on Bitcoin's price";
    const category = "Crypto";

    it("Should create a binary market successfully", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300; // 1 day + 5 minutes buffer from now
      const resolutionTime = endTime + 3600; // 1 hour after end

      const tx = await marketFactory.createBinaryMarket(
        questionId,
        question,
        description,
        category,
        endTime,
        resolutionTime
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );

      expect(event).to.not.be.undefined;
    });

    it("Should revert with invalid end time", async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

      await expect(
        marketFactory.createBinaryMarket(
          questionId,
          question,
          description,
          category,
          pastTime,
          pastTime + 3600 // resolution time after past time
        )
      ).to.be.revertedWithCustomError(marketFactory, "InvalidEndTime");
    });

    it("Should revert with invalid resolution time", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;

      await expect(
        marketFactory.createBinaryMarket(
          questionId,
          question,
          description,
          category,
          endTime,
          endTime - 1 // Before end time
        )
      ).to.be.revertedWithCustomError(marketFactory, "InvalidResolutionTime");
    });

    it("Should revert with duplicate question ID", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create first market
      await marketFactory.createBinaryMarket(
        questionId,
        question,
        description,
        category,
        endTime,
        resolutionTime
      );

      // Try to create second market with same question ID
      await expect(
        marketFactory.createBinaryMarket(
          questionId,
          "Different question",
          "Different description",
          "Different category",
          endTime + 86400,
          resolutionTime + 86400
        )
      ).to.be.revertedWithCustomError(marketFactory, "QuestionIdAlreadyExists");
    });
  });

  describe("createMultipleChoiceMarket", function () {
    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Who will win the 2024 election?"));
    const question = "Who will win the 2024 election?";
    const description = "A prediction market on the 2024 election";
    const category = "Politics";
    const outcomeSlotCount = 3;

    it("Should create a multiple choice market successfully", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      const tx = await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );

      expect(event).to.not.be.undefined;
    });

    it("Should revert with invalid outcome count", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      await expect(
        marketFactory.createMultipleChoiceMarket(
          questionId,
          question,
          description,
          category,
          2, // Less than 3
          endTime,
          resolutionTime
        )
      ).to.be.revertedWithCustomError(marketFactory, "InvalidOutcomeCount");

      await expect(
        marketFactory.createMultipleChoiceMarket(
          questionId,
          question,
          description,
          category,
          257, // More than 256
          endTime,
          resolutionTime
        )
      ).to.be.revertedWithCustomError(marketFactory, "InvalidOutcomeCount");
    });
  });

  describe("createFedRateMarket", function () {
    let mockUSDC;

    const questionId = ethers.keccak256(ethers.toUtf8Bytes("What will the Fed do with interest rates in December 2024?"));
    const question = "What will the Fed do with interest rates in December 2024?";
    const description = "A prediction market on Federal Reserve interest rate decisions";
    const category = "Economics";
    const outcomeSlotCount = 6;

    // Fed rate outcomes:
    // 1 = Cut by 50bp or more
    // 2 = Cut by 25bp (but less than 50bp)
    // 3 = Cut by less than 25bp
    // 4 = No change
    // 5 = Raise by 25bp
    // 6 = Raise by 50bp or more

    beforeEach(async function () {
      // Deploy MockUSDC for these tests
      const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
      mockUSDC = await MockUSDCFactory.deploy();
      await mockUSDC.waitForDeployment();

      // Mint USDC to users
      await mockUSDC.mintForTesting(user1.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(user2.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(await conditionalTokens.getAddress(), ethers.parseUnits("1000000", 6));
    });

    it("Should create a Fed rate market with 6 outcomes successfully", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      const tx = await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );

      expect(event).to.not.be.undefined;

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      const market = await marketFactory.getMarket(conditionId);
      expect(market.outcomeSlotCount).to.equal(6);
      expect(market.question).to.equal(question);
    });

    it("Should allow positions on individual outcomes", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first (this already prepares the condition)
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User bets on 25bp cut only (outcome 2)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [2], // Only outcome 2 (25bp cut)
        amount
      );

      // Check token balance
      const tokenId2 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1 << 1) // 2^1 = 2
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenId2)).to.equal(amount);
    });

    it("Should allow hedging across multiple outcomes", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first (this already prepares the condition)
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User hedges on all cut scenarios (outcomes 1, 2, 3)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1, 2, 4], // Cut by 50bp+, 25bp, or <25bp (index sets: 2^0, 2^1, 2^2)
        amount
      );

      // Check token balances for all three outcomes
      // The partition [1, 2, 4] means outcomes 1, 2, and 3
      // For outcome 1: indexSet = 1 (2^0)
      // For outcome 2: indexSet = 2 (2^1)
      // For outcome 3: indexSet = 4 (2^2)
      const tokenId1 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1) // outcome 1
      );
      const tokenId2 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 2) // outcome 2
      );
      const tokenId3 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 4) // outcome 3 (2^2)
      );

      console.log("Token IDs:", { tokenId1, tokenId2, tokenId3 });
      console.log("Balances:", {
        token1: await conditionalTokens.balanceOf(user1.address, tokenId1),
        token2: await conditionalTokens.balanceOf(user1.address, tokenId2),
        token3: await conditionalTokens.balanceOf(user1.address, tokenId3)
      });

      // In a split position, the full amount is minted for each outcome
      // So for [1, 2, 3], each outcome gets the full amount
      expect(await conditionalTokens.balanceOf(user1.address, tokenId1)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenId2)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenId3)).to.equal(amount);
    });

    it("Should handle resolution with correct payouts", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first (this already prepares the condition)
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User bets on 25bp cut (outcome 2)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [2], // Only outcome 2
        amount
      );

      // Resolve market: Fed cuts by 30bp (outcome 3 wins, not outcome 2)
      const payouts = [0, 0, 100, 0, 0, 0]; // 100% to outcome 3

      // We need to impersonate the oracle address to call reportPayouts
      await ethers.provider.send("hardhat_impersonateAccount", [oracle]);
      const oracleSigner = await ethers.getSigner(oracle);

      // Fund the oracle address
      await owner.sendTransaction({
        to: oracle,
        value: ethers.parseEther("1.0")
      });

      await conditionalTokens.connect(oracleSigner).reportPayouts(questionId, payouts);

      // User should get nothing back since they bet on wrong outcome
      const tokenId2 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1 << 1)
      );

      // Check that user can redeem but gets 0 payout
      const balanceBefore = await mockUSDC.balanceOf(user1.address);
      await conditionalTokens.connect(user1).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [2]
      );
      const balanceAfter = await mockUSDC.balanceOf(user1.address);

      // User should get 0 USDC back (lost the bet)
      expect(balanceAfter).to.equal(balanceBefore);
    });
  });

  describe("Market Management", function () {
    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Test market"));
    const question = "Test market";
    const description = "Test description";
    const category = "Test";

    beforeEach(async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      await marketFactory.createBinaryMarket(
        questionId,
        question,
        description,
        category,
        endTime,
        resolutionTime
      );
    });

    it("Should close market", async function () {
      // Create a mock condition ID
      const conditionId = ethers.keccak256(ethers.toUtf8Bytes("test-condition"));

      // This will fail because the market doesn't exist, but we can test the authorization logic
      await expect(
        marketFactory.closeMarket(conditionId)
      ).to.be.revertedWithCustomError(marketFactory, "NotAuthorized");
    });

    it("Should cancel market", async function () {
      // Create a mock condition ID
      const conditionId = ethers.keccak256(ethers.toUtf8Bytes("test-condition"));

      await marketFactory.cancelMarket(conditionId);

      const market = await marketFactory.getMarket(conditionId);
      expect(market.status).to.equal(3); // MarketStatus.Canceled
    });

    it("Should revert when non-authorized user tries to close market", async function () {
      // Create a mock condition ID
      const conditionId = ethers.keccak256(ethers.toUtf8Bytes("test-condition"));

      await expect(
        marketFactory.connect(user1).closeMarket(conditionId)
      ).to.be.revertedWithCustomError(marketFactory, "NotAuthorized");
    });
  });

  describe("createSportsMatchMarket", function () {
    let mockUSDC;

    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Who will win the 2024 World Cup Final?"));
    const question = "Who will win the 2024 World Cup Final?";
    const description = "A prediction market on the World Cup Final match result";
    const category = "Sports";
    const outcomeSlotCount = 4;

    // Sports match outcomes:
    // 0 = Team A wins in regulation
    // 1 = Team A wins in extra time/penalties
    // 2 = Team B wins in regulation
    // 3 = Team B wins in extra time/penalties

    beforeEach(async function () {
      // Deploy MockUSDC for these tests
      const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
      mockUSDC = await MockUSDCFactory.deploy();
      await mockUSDC.waitForDeployment();

      // Mint USDC to users
      await mockUSDC.mintForTesting(user1.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(user2.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(await conditionalTokens.getAddress(), ethers.parseUnits("1000000", 6));
    });

    it("Should create a 4-outcome sports market successfully", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      const tx = await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );

      expect(event).to.not.be.undefined;

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      const market = await marketFactory.getMarket(conditionId);
      expect(market.outcomeSlotCount).to.equal(4);
      expect(market.question).to.equal(question);
    });

    it("Should allow positions on specific outcomes", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User1 bets on Team A winning in regulation (outcome 0)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1], // Outcome 0 (indexSet = 2^0 = 1)
        amount
      );

      // User2 bets on Team B winning in extra time (outcome 3)
      await mockUSDC.connect(user2).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user2).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [8], // Outcome 3 (indexSet = 2^3 = 8)
        amount
      );

      // Check token balances
      const tokenId0 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1) // 2^0
      );
      const tokenId3 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 8) // 2^3
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenId0)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user2.address, tokenId3)).to.equal(amount);
    });

    it("Should allow hedging across multiple outcomes", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User hedges on all Team A outcomes (0 and 1)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1, 2], // Outcomes 0 and 1 (indexSets = 2^0, 2^1)
        amount
      );

      // Check token balances for both outcomes
      const tokenId0 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1) // 2^0
      );
      const tokenId1 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 2) // 2^1
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenId0)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenId1)).to.equal(amount);
    });

    it("Should handle resolution with correct payouts", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User bets on Team A regulation win (outcome 0)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1], // Outcome 0
        amount
      );

      // Resolve market: Team B wins in extra time (outcome 3 wins)
      const payouts = [0, 0, 0, 100]; // 100% to outcome 3

      // We need to impersonate the oracle address to call reportPayouts
      await ethers.provider.send("hardhat_impersonateAccount", [oracle]);
      const oracleSigner = await ethers.getSigner(oracle);

      // Fund the oracle address
      await owner.sendTransaction({
        to: oracle,
        value: ethers.parseEther("1.0")
      });

      await conditionalTokens.connect(oracleSigner).reportPayouts(questionId, payouts);

      // User should get nothing back since they bet on wrong outcome
      const tokenId0 = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId, 1)
      );

      // Check that user can redeem but gets 0 payout
      const balanceBefore = await mockUSDC.balanceOf(user1.address);
      await conditionalTokens.connect(user1).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1]
      );
      const balanceAfter = await mockUSDC.balanceOf(user1.address);

      // User should get 0 USDC back (lost the bet)
      expect(balanceAfter).to.equal(balanceBefore);
    });

    it("Should handle complex hedging strategy", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create market first
      await marketFactory.createMultipleChoiceMarket(
        questionId,
        question,
        description,
        category,
        outcomeSlotCount,
        endTime,
        resolutionTime
      );

      const conditionId = await conditionalTokens.getConditionId(
        oracle,
        questionId,
        outcomeSlotCount
      );

      // User1: Hedges on all Team A outcomes (0, 1)
      // User2: Hedges on all Team B outcomes (2, 3)
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);
      await mockUSDC.connect(user2).approve(await conditionalTokens.getAddress(), amount);

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1, 2], // Team A outcomes (0, 1)
        amount
      );

      await conditionalTokens.connect(user2).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [4, 8], // Team B outcomes (2, 3)
        amount
      );

      // Resolve: Team A wins in regulation (outcome 0)
      const payouts = [100, 0, 0, 0]; // 100% to outcome 0

      await ethers.provider.send("hardhat_impersonateAccount", [oracle]);
      const oracleSigner = await ethers.getSigner(oracle);
      await owner.sendTransaction({
        to: oracle,
        value: ethers.parseEther("1.0")
      });

      await conditionalTokens.connect(oracleSigner).reportPayouts(questionId, payouts);

      // Check results
      const user1BalanceBefore = await mockUSDC.balanceOf(user1.address);
      const user2BalanceBefore = await mockUSDC.balanceOf(user2.address);

      // Redeem positions
      await conditionalTokens.connect(user1).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [1, 2]
      );
      await conditionalTokens.connect(user2).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId,
        [4, 8]
      );

      const user1BalanceAfter = await mockUSDC.balanceOf(user1.address);
      const user2BalanceAfter = await mockUSDC.balanceOf(user2.address);

      // User1 should get money back from outcome 0 (won)
      // User2 should get nothing from outcomes 2, 3 (lost)
      expect(user1BalanceAfter).to.be.gte(user1BalanceBefore);
      expect(user2BalanceAfter).to.equal(user2BalanceBefore);
    });
  });

  describe("createBinaryMarketsWithSplits", function () {
    let mockUSDC;

    const questionId50bp = ethers.keccak256(ethers.toUtf8Bytes("Will the Fed cut rates by 50bp in December 2024?"));
    const question50bp = "Will the Fed cut rates by 50bp in December 2024?";
    const description50bp = "A binary prediction market on 50bp rate cut";

    const questionId25bp = ethers.keccak256(ethers.toUtf8Bytes("Will the Fed cut rates by 25bp in December 2024?"));
    const question25bp = "Will the Fed cut rates by 25bp in December 2024?";
    const description25bp = "A binary prediction market on 25bp rate cut";

    const category = "Economics";

    beforeEach(async function () {
      // Deploy MockUSDC for these tests
      const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
      mockUSDC = await MockUSDCFactory.deploy();
      await mockUSDC.waitForDeployment();

      // Mint USDC to users
      await mockUSDC.mintForTesting(user1.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(user2.address, ethers.parseUnits("10000", 6));
      await mockUSDC.mintForTesting(await conditionalTokens.getAddress(), ethers.parseUnits("1000000", 6));
    });

    it("Should create two separate binary markets successfully", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create 50bp market
      const tx1 = await marketFactory.createBinaryMarket(
        questionId50bp,
        question50bp,
        description50bp,
        category,
        endTime,
        resolutionTime
      );

      // Create 25bp market
      const tx2 = await marketFactory.createBinaryMarket(
        questionId25bp,
        question25bp,
        description25bp,
        category,
        endTime,
        resolutionTime
      );

      const receipt1 = await tx1.wait();
      const receipt2 = await tx2.wait();

      const event1 = receipt1?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );
      const event2 = receipt2?.logs.find(log =>
        log.topics[0] === marketFactory.interface.getEvent("MarketCreated").topicHash
      );

      expect(event1).to.not.be.undefined;
      expect(event2).to.not.be.undefined;

      // Verify both markets exist
      const conditionId50bp = await conditionalTokens.getConditionId(oracle, questionId50bp, 2);
      const conditionId25bp = await conditionalTokens.getConditionId(oracle, questionId25bp, 2);

      const market50bp = await marketFactory.getMarket(conditionId50bp);
      const market25bp = await marketFactory.getMarket(conditionId25bp);

      expect(market50bp.question).to.equal(question50bp);
      expect(market25bp.question).to.equal(question25bp);
    });

    it("Should allow positions across both binary markets", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create both markets
      await marketFactory.createBinaryMarket(
        questionId50bp,
        question50bp,
        description50bp,
        category,
        endTime,
        resolutionTime
      );

      await marketFactory.createBinaryMarket(
        questionId25bp,
        question25bp,
        description25bp,
        category,
        endTime,
        resolutionTime
      );

      const conditionId50bp = await conditionalTokens.getConditionId(oracle, questionId50bp, 2);
      const conditionId25bp = await conditionalTokens.getConditionId(oracle, questionId25bp, 2);

      // Prepare both conditions
      // Conditions are already prepared by createBinaryMarket

      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount * 2n);

      // User bets YES on 50bp cut
      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId50bp,
        [1], // YES for 50bp
        amount
      );

      // User bets NO on 25bp cut
      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId25bp,
        [2], // NO for 25bp
        amount
      );

      // Check positions
      const tokenId50bpYes = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId50bp, 1)
      );
      const tokenId25bpNo = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId25bp, 2)
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenId50bpYes)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenId25bpNo)).to.equal(amount);
    });

    it("Should handle hedging strategy across both markets", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create both markets
      await marketFactory.createBinaryMarket(
        questionId50bp,
        question50bp,
        description50bp,
        category,
        endTime,
        resolutionTime
      );

      await marketFactory.createBinaryMarket(
        questionId25bp,
        question25bp,
        description25bp,
        category,
        endTime,
        resolutionTime
      );

      const conditionId50bp = await conditionalTokens.getConditionId(oracle, questionId50bp, 2);
      const conditionId25bp = await conditionalTokens.getConditionId(oracle, questionId25bp, 2);

      // Prepare both conditions
      // Conditions are already prepared by createBinaryMarket

      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount * 4n);

      // User hedges: YES on both markets (covers any cut scenario)
      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId50bp,
        [1], // YES for 50bp
        amount
      );

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId25bp,
        [1], // YES for 25bp
        amount
      );

      // Check that user has positions in both markets
      const tokenId50bpYes = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId50bp, 1)
      );
      const tokenId25bpYes = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId25bp, 1)
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenId50bpYes)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenId25bpYes)).to.equal(amount);
    });

    it("Should handle split positions (hedge both sides) in each market", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create 50bp market
      await marketFactory.createBinaryMarket(
        questionId50bp,
        question50bp,
        description50bp,
        category,
        endTime,
        resolutionTime
      );

      const conditionId50bp = await conditionalTokens.getConditionId(oracle, questionId50bp, 2);
      // Condition is already prepared by createBinaryMarket

      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount);

      // User splits position: both YES and NO (hedge)
      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId50bp,
        [1, 2], // Both YES and NO
        amount
      );

      // Check that user has equal amounts of both tokens
      const tokenIdYes = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId50bp, 1)
      );
      const tokenIdNo = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId50bp, 2)
      );

      expect(await conditionalTokens.balanceOf(user1.address, tokenIdYes)).to.equal(amount);
      expect(await conditionalTokens.balanceOf(user1.address, tokenIdNo)).to.equal(amount);
    });

    it("Should handle resolution scenarios across both markets", async function () {
      const latestBlock = await ethers.provider.getBlock('latest');
      const endTime = latestBlock .timestamp + 86400 + 300;
      const resolutionTime = endTime + 3600;

      // Create both markets
      await marketFactory.createBinaryMarket(
        questionId50bp,
        question50bp,
        description50bp,
        category,
        endTime,
        resolutionTime
      );

      await marketFactory.createBinaryMarket(
        questionId25bp,
        question25bp,
        description25bp,
        category,
        endTime,
        resolutionTime
      );

      const conditionId50bp = await conditionalTokens.getConditionId(oracle, questionId50bp, 2);
      const conditionId25bp = await conditionalTokens.getConditionId(oracle, questionId25bp, 2);

      // Prepare both conditions
      // Conditions are already prepared by createBinaryMarket

      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(user1).approve(await conditionalTokens.getAddress(), amount * 2n);

      // User bets YES on 50bp, NO on 25bp
      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId50bp,
        [1], // YES for 50bp
        amount
      );

      await conditionalTokens.connect(user1).splitPosition(
        mockUSDC,
        ethers.ZeroHash,
        conditionId25bp,
        [2], // NO for 25bp
        amount
      );

      // Scenario: Fed cuts by 30bp (neither 50bp nor exactly 25bp)
      // 50bp market: NO wins (Fed didn't cut by 50bp)
      // 25bp market: NO wins (Fed didn't cut by exactly 25bp)

      // Resolve 50bp market: NO wins
      await ethers.provider.send("hardhat_impersonateAccount", [oracle]);
      const oracleSigner = await ethers.getSigner(oracle);
      await owner.sendTransaction({
        to: oracle,
        value: ethers.parseEther("1.0")
      });
      await conditionalTokens.connect(oracleSigner).reportPayouts(questionId50bp, [0, 100]);

      // Resolve 25bp market: NO wins
      await conditionalTokens.connect(oracleSigner).reportPayouts(questionId25bp, [0, 100]);

      // Check if conditions are actually resolved
      const condition50bp = await conditionalTokens.conditions(conditionId50bp);
      const condition25bp = await conditionalTokens.conditions(conditionId25bp);
      console.log("50bp condition resolved:", condition50bp.isResolved);
      console.log("25bp condition resolved:", condition25bp.isResolved);

      // User should win on both markets (both NO positions)
      const tokenId50bpYes = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId50bp, 1)
      );
      const tokenId25bpNo = await conditionalTokens.getPositionId(
        mockUSDC,
        await conditionalTokens.getCollectionId(ethers.ZeroHash, conditionId25bp, 2)
      );

      // Check balances before redemption
      console.log("Token balances before redemption:");
      console.log("50bp YES:", await conditionalTokens.balanceOf(user1.address, tokenId50bpYes));
      console.log("25bp NO:", await conditionalTokens.balanceOf(user1.address, tokenId25bpNo));

      // User has YES on 50bp (should lose) and NO on 25bp (should win)
      expect(await conditionalTokens.balanceOf(user1.address, tokenId50bpYes)).to.equal(amount); // Still has tokens
      expect(await conditionalTokens.balanceOf(user1.address, tokenId25bpNo)).to.equal(amount); // Still has tokens

      // Redeem positions
      const balanceBefore = await mockUSDC.balanceOf(user1.address);
      await conditionalTokens.connect(user1).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId50bp,
        [1]
      );
      await conditionalTokens.connect(user1).redeemPositions(
        mockUSDC,
        ethers.ZeroHash,
        conditionId25bp,
        [2]
      );
      const balanceAfter = await mockUSDC.balanceOf(user1.address);

      console.log("Balance before:", balanceBefore.toString());
      console.log("Balance after:", balanceAfter.toString());
      console.log("Expected change:", amount.toString());

      // User should get back 1000 USDC (from winning 25bp NO position)
      // Net change: +1000 USDC (got back 1000 from winning position)
      expect(balanceAfter).to.equal(balanceBefore + amount);
    });
  });

  describe("Access Control", function () {
    it("Should set exchange address", async function () {
      const newExchange = ethers.Wallet.createRandom().address;
      await marketFactory.setExchange(newExchange);
      expect(await marketFactory.exchange()).to.equal(newExchange);
    });

    it("Should set oracle address", async function () {
      const newOracle = ethers.Wallet.createRandom().address;
      await marketFactory.setOracle(newOracle);
      expect(await marketFactory.oracle()).to.equal(newOracle);
    });

    it("Should revert when non-owner tries to set exchange", async function () {
      const newExchange = ethers.Wallet.createRandom().address;
      await expect(
        marketFactory.connect(user1).setExchange(newExchange)
      ).to.be.revertedWithCustomError(marketFactory, "OwnableUnauthorizedAccount");
    });
  });
});
```
