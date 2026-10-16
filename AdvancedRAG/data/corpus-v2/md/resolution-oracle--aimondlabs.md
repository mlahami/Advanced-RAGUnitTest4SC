# resolution-oracle--aimondlabs

- domain: price-oracles (oracle)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/AimondLabs/nostra-contracts @ 75a1ed0b75610fae1a857fc78555e22e1e8db53e
- license: MIT
- targets: ResolutionOracle.sol, IConditionalTokens.sol, ConditionalTokens.sol
- validation: 14 passing tests, 0 failing; statement coverage ResolutionOracle.sol 100.0 %, IConditionalTokens.sol 100.0 %, ConditionalTokens.sol 27.27 %

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

## Contract: ResolutionOracle.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IConditionalTokens.sol";

/**
 * @title Resolution Oracle
 * @notice Resolves prediction market outcomes
 * @dev Based on Polymarket CTF Exchange implementation
 */
contract ResolutionOracle is Ownable, ReentrancyGuard {
    IConditionalTokens public immutable ctf;
    
    mapping(bytes32 => Resolution) public resolutions;
    mapping(address => bool) public resolvers;
    mapping(bytes32 => bool) public resolvedConditions;

    uint256 public constant DISPUTE_PERIOD = 1 days;
    uint256 public constant FINALIZATION_DELAY = 2 days;

    struct Resolution {
        bytes32 conditionId;
        bytes32 questionId;
        uint256[] payouts;
        uint256 timestamp;
        address resolver;
        ResolutionStatus status;
        uint256 disputePeriodEnd;
    }

    enum ResolutionStatus {
        Unresolved,
        Proposed,
        Disputed,
        Finalized
    }

    event ResolutionProposed(
        bytes32 indexed conditionId,
        bytes32 indexed questionId,
        uint256[] payouts,
        address resolver
    );

    event ResolutionDisputed(
        bytes32 indexed conditionId,
        address disputer
    );

    event ResolutionFinalized(
        bytes32 indexed conditionId,
        bytes32 indexed questionId,
        uint256[] payouts
    );

    event ResolverAdded(address indexed resolver);
    event ResolverRemoved(address indexed resolver);

    error AlreadyResolved();
    error InvalidPayoutsLength();
    error NotResolver();
    error NotProposed();
    error DisputePeriodActive();
    error ResolutionNotFound();
    error InvalidConditionId();

    modifier onlyResolver() {
        if (!resolvers[msg.sender]) revert NotResolver();
        _;
    }

    constructor(address _ctf) Ownable(msg.sender) {
        ctf = IConditionalTokens(_ctf);
        resolvers[msg.sender] = true;
    }

    /// @notice Proposes a resolution
    /// @param questionId - The question identifier
    /// @param outcomeSlotCount - Number of outcomes
    /// @param payouts - Array of payouts for each outcome
    function proposeResolution(
        bytes32 questionId,
        uint256 outcomeSlotCount,
        uint256[] calldata payouts
    ) external onlyResolver nonReentrant {
        if (payouts.length != outcomeSlotCount) revert InvalidPayoutsLength();

        bytes32 conditionId = ctf.getConditionId(
            address(this),
            questionId,
            outcomeSlotCount
        );

        if (resolvedConditions[conditionId]) revert AlreadyResolved();

        // Check if resolution already exists
        Resolution storage existingResolution = resolutions[conditionId];
        if (existingResolution.status != ResolutionStatus.Unresolved) {
            revert AlreadyResolved();
        }

        // Store proposed resolution
        resolutions[conditionId] = Resolution({
            conditionId: conditionId,
            questionId: questionId,
            payouts: payouts,
            timestamp: block.timestamp,
            resolver: msg.sender,
            status: ResolutionStatus.Proposed,
            disputePeriodEnd: block.timestamp + DISPUTE_PERIOD
        });

        emit ResolutionProposed(conditionId, questionId, payouts, msg.sender);
    }

    /// @notice Finalizes resolution after dispute period
    /// @param questionId - The question identifier
    /// @param outcomeSlotCount - Number of outcomes
    function finalizeResolution(
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external onlyResolver nonReentrant {
        bytes32 conditionId = ctf.getConditionId(
            address(this),
            questionId,
            outcomeSlotCount
        );

        Resolution storage resolution = resolutions[conditionId];
        if (resolution.status != ResolutionStatus.Proposed) revert NotProposed();
        if (block.timestamp < resolution.disputePeriodEnd) revert DisputePeriodActive();

        // Report to CTF
        ctf.reportPayouts(questionId, resolution.payouts);

        resolution.status = ResolutionStatus.Finalized;
        resolvedConditions[conditionId] = true;

        emit ResolutionFinalized(conditionId, questionId, resolution.payouts);
    }

    /// @notice Admin can immediately finalize (bypass dispute period)
    /// @param questionId - The question identifier
    /// @param outcomeSlotCount - Number of outcomes
    /// @param payouts - Array of payouts for each outcome
    function adminFinalizeResolution(
        bytes32 questionId,
        uint256 outcomeSlotCount,
        uint256[] calldata payouts
    ) external onlyOwner nonReentrant {
        if (payouts.length != outcomeSlotCount) revert InvalidPayoutsLength();

        bytes32 conditionId = ctf.getConditionId(
            address(this),
            questionId,
            outcomeSlotCount
        );

        if (resolvedConditions[conditionId]) revert AlreadyResolved();

        // Report to CTF
        ctf.reportPayouts(questionId, payouts);

        // Store resolution
        resolutions[conditionId] = Resolution({
            conditionId: conditionId,
            questionId: questionId,
            payouts: payouts,
            timestamp: block.timestamp,
            resolver: msg.sender,
            status: ResolutionStatus.Finalized,
            disputePeriodEnd: 0
        });

        resolvedConditions[conditionId] = true;

        emit ResolutionFinalized(conditionId, questionId, payouts);
    }

    /// @notice Disputes a proposed resolution
    /// @param questionId - The question identifier
    /// @param outcomeSlotCount - Number of outcomes
    function disputeResolution(
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external nonReentrant {
        bytes32 conditionId = ctf.getConditionId(
            address(this),
            questionId,
            outcomeSlotCount
        );

        Resolution storage resolution = resolutions[conditionId];
        if (resolution.status != ResolutionStatus.Proposed) revert ResolutionNotFound();
        if (block.timestamp >= resolution.disputePeriodEnd) revert DisputePeriodActive();

        resolution.status = ResolutionStatus.Disputed;

        emit ResolutionDisputed(conditionId, msg.sender);
    }

    /// @notice Adds a resolver
    /// @param resolver - Address to add as resolver
    function addResolver(address resolver) external onlyOwner {
        resolvers[resolver] = true;
        emit ResolverAdded(resolver);
    }

    /// @notice Removes a resolver
    /// @param resolver - Address to remove as resolver
    function removeResolver(address resolver) external onlyOwner {
        resolvers[resolver] = false;
        emit ResolverRemoved(resolver);
    }

    /// @notice Gets resolution info
    /// @param conditionId - The condition ID
    function getResolution(bytes32 conditionId) external view returns (Resolution memory) {
        return resolutions[conditionId];
    }

    /// @notice Checks if a condition is resolved
    /// @param conditionId - The condition ID
    function isResolved(bytes32 conditionId) external view returns (bool) {
        return resolvedConditions[conditionId];
    }

    /// @notice Checks if a resolution can be disputed
    /// @param conditionId - The condition ID
    function canDispute(bytes32 conditionId) external view returns (bool) {
        Resolution memory resolution = resolutions[conditionId];
        return resolution.status == ResolutionStatus.Proposed && 
               block.timestamp < resolution.disputePeriodEnd;
    }
}
```

## Tests: ResolutionOracle.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ResolutionOracle", function () {
  let resolutionOracle;
  let conditionalTokens;
  let owner;
  let resolver1;
  let resolver2;
  let user1;

  beforeEach(async function () {
    [owner, resolver1, resolver2, user1] = await ethers.getSigners();

    // Deploy mock contracts
    const ConditionalTokensFactory = await ethers.getContractFactory("ConditionalTokens");
    conditionalTokens = await ConditionalTokensFactory.deploy();

    // Deploy ResolutionOracle
    const ResolutionOracleFactory = await ethers.getContractFactory("ResolutionOracle");
    resolutionOracle = await ResolutionOracleFactory.deploy(await conditionalTokens.getAddress());

    // Add additional resolvers
    await resolutionOracle.addResolver(resolver1.address);
    await resolutionOracle.addResolver(resolver2.address);
  });

  describe("Deployment", function () {
    it("Should set the correct initial values", async function () {
      expect(await resolutionOracle.ctf()).to.equal(await conditionalTokens.getAddress());
      expect(await resolutionOracle.owner()).to.equal(owner.address);
      expect(await resolutionOracle.resolvers(owner.address)).to.be.true;
    });
  });

  describe("Resolver Management", function () {
    it("Should add resolver", async function () {
      const newResolver = ethers.Wallet.createRandom().address;
      await resolutionOracle.addResolver(newResolver);
      expect(await resolutionOracle.resolvers(newResolver)).to.be.true;
    });

    it("Should remove resolver", async function () {
      await resolutionOracle.removeResolver(resolver1.address);
      expect(await resolutionOracle.resolvers(resolver1.address)).to.be.false;
    });

    it("Should revert when non-owner tries to add resolver", async function () {
      const newResolver = ethers.Wallet.createRandom().address;
      await expect(
        resolutionOracle.connect(user1).addResolver(newResolver)
      ).to.be.revertedWithCustomError(resolutionOracle, "OwnableUnauthorizedAccount");
    });
  });

  describe("Resolution Process", function () {
    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Test question"));
    const outcomeSlotCount = 2;
    const payouts = [100, 0]; // YES wins

    it("Should propose resolution", async function () {
      const tx = await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === resolutionOracle.interface.getEvent("ResolutionProposed").topicHash
      );

      expect(event).to.not.be.undefined;

      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      const resolution = await resolutionOracle.getResolution(conditionId);
      expect(resolution.status).to.equal(1); // ResolutionStatus.Proposed
      expect(resolution.payouts[0]).to.equal(100);
      expect(resolution.payouts[1]).to.equal(0);
    });

    it("Should finalize resolution after dispute period", async function () {
      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Prepare condition first
      await conditionalTokens.prepareCondition(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Propose resolution
      await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      // Fast forward time past dispute period
      await ethers.provider.send("evm_increaseTime", [86400 + 1]); // 1 day + 1 second
      await ethers.provider.send("evm_mine", []);

      // Finalize resolution
      const tx = await resolutionOracle.connect(resolver1).finalizeResolution(
        questionId,
        outcomeSlotCount
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === resolutionOracle.interface.getEvent("ResolutionFinalized").topicHash
      );

      expect(event).to.not.be.undefined;

      const resolution = await resolutionOracle.getResolution(conditionId);
      expect(resolution.status).to.equal(3); // ResolutionStatus.Finalized
      expect(await resolutionOracle.isResolved(conditionId)).to.be.true;
    });

    it("Should allow admin to immediately finalize", async function () {
      // Prepare condition first
      await conditionalTokens.prepareCondition(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      const tx = await resolutionOracle.adminFinalizeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === resolutionOracle.interface.getEvent("ResolutionFinalized").topicHash
      );

      expect(event).to.not.be.undefined;

      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      const resolution = await resolutionOracle.getResolution(conditionId);
      expect(resolution.status).to.equal(3); // ResolutionStatus.Finalized
    });

    it("Should allow dispute during dispute period", async function () {
      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Propose resolution
      await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      // Dispute resolution
      const tx = await resolutionOracle.connect(user1).disputeResolution(
        questionId,
        outcomeSlotCount
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log =>
        log.topics[0] === resolutionOracle.interface.getEvent("ResolutionDisputed").topicHash
      );

      expect(event).to.not.be.undefined;

      const resolution = await resolutionOracle.getResolution(conditionId);
      expect(resolution.status).to.equal(2); // ResolutionStatus.Disputed
    });

    it("Should revert when trying to finalize before dispute period ends", async function () {
      // Propose resolution
      await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      // Try to finalize immediately
      await expect(
        resolutionOracle.connect(resolver1).finalizeResolution(
          questionId,
          outcomeSlotCount
        )
      ).to.be.revertedWithCustomError(resolutionOracle, "DisputePeriodActive");
    });

    it("Should revert when non-resolver tries to propose", async function () {
      await expect(
        resolutionOracle.connect(user1).proposeResolution(
          questionId,
          outcomeSlotCount,
          payouts
        )
      ).to.be.revertedWithCustomError(resolutionOracle, "NotResolver");
    });

    it("Should revert with invalid payouts length", async function () {
      await expect(
        resolutionOracle.connect(resolver1).proposeResolution(
          questionId,
          outcomeSlotCount,
          [100] // Wrong length
        )
      ).to.be.revertedWithCustomError(resolutionOracle, "InvalidPayoutsLength");
    });

    it("Should revert when trying to propose duplicate resolution", async function () {
      // Propose first resolution
      await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      // Try to propose again
      await expect(
        resolutionOracle.connect(resolver2).proposeResolution(
          questionId,
          outcomeSlotCount,
          payouts
        )
      ).to.be.revertedWithCustomError(resolutionOracle, "AlreadyResolved");
    });
  });

  describe("Utility Functions", function () {
    const questionId = ethers.keccak256(ethers.toUtf8Bytes("Test question"));
    const outcomeSlotCount = 2;
    const payouts = [100, 0];

    it("Should check if resolution can be disputed", async function () {
      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Before proposal
      expect(await resolutionOracle.canDispute(conditionId)).to.be.false;

      // After proposal
      await resolutionOracle.connect(resolver1).proposeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      expect(await resolutionOracle.canDispute(conditionId)).to.be.true;

      // After dispute period
      await ethers.provider.send("evm_increaseTime", [86400 + 1]);
      await ethers.provider.send("evm_mine", []);

      expect(await resolutionOracle.canDispute(conditionId)).to.be.false;
    });

    it("Should check if condition is resolved", async function () {
      const conditionId = await conditionalTokens.getConditionId(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Prepare condition first
      await conditionalTokens.prepareCondition(
        await resolutionOracle.getAddress(),
        questionId,
        outcomeSlotCount
      );

      // Before resolution
      expect(await resolutionOracle.isResolved(conditionId)).to.be.false;

      // After admin finalization
      await resolutionOracle.adminFinalizeResolution(
        questionId,
        outcomeSlotCount,
        payouts
      );

      expect(await resolutionOracle.isResolved(conditionId)).to.be.true;
    });
  });
});
```
