# agent-subscriptions-v2--andrerserrano

- domain: subscriptions-streaming (subscription)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/andrerserrano/USDC-Hackathon @ f2dfddef6ec0a37d092baa5b892f3713468cdf22
- license: MIT
- targets: AgentSubscriptionsV2.sol, MockERC20.sol
- validation: 73 passing tests, 0 failing; statement coverage AgentSubscriptionsV2.sol 81.51 %, MockERC20.sol 50.0 %

## Contract: AgentSubscriptionsV2.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AgentSubscriptions v2.0
 * @author Timmy (AI Agent Entrepreneur)
 * @notice Recurring USDC subscription payments for AI agent services - 1-to-many model
 * @dev Enables agents to create subscription offerings that multiple users can subscribe to
 *      Supports scheduling, access control, metrics tracking, and emergency pause
 */
contract AgentSubscriptionsV2 is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                               CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice The USDC token contract (immutable for security)
    IERC20 public immutable usdc;

    /// @notice Maximum length for service ID strings
    uint256 public constant MAX_SERVICE_ID_LENGTH = 100;

    /// @notice Maximum amount per billing period (1M USDC = 1,000,000 * 10^6)
    uint256 public constant MAX_AMOUNT_PER_PERIOD = 1_000_000 * 1e6;

    /// @notice Minimum billing period (1 minute)
    uint256 public constant MIN_PERIOD_SECONDS = 60;

    /// @notice Maximum billing period (1 year)
    uint256 public constant MAX_PERIOD_SECONDS = 365 days;

    /// @notice USDC decimals (6)
    uint8 public constant USDC_DECIMALS = 6;

    /*//////////////////////////////////////////////////////////////
                            DATA STRUCTURES
    //////////////////////////////////////////////////////////////*/

    /// @notice Subscription offering created by an agent
    struct SubscriptionOffering {
        string serviceId;               // Human-readable service identifier
        address owner;                  // Agent who created the offering
        address recipient;              // Where payments are sent (can differ from owner)
        uint256 amountPerPeriod;        // USDC amount per billing period (6 decimals)
        uint256 periodInSeconds;        // Billing period length (e.g., 604800 = 1 week)
        uint256 createdAt;              // When offering was created
        bool active;                    // Is offering currently active? (owner can pause)
        uint256 totalSubscribers;       // Count of active subscribers
    }

    /// @notice Individual user subscription to an offering
    struct UserSubscription {
        uint256 offeringId;             // Which offering they subscribed to
        address subscriber;             // Who subscribed
        uint256 startTime;              // When they subscribed
        uint256 lastChargeTime;         // Last successful charge timestamp
        bool active;                    // Is this subscription active?
        uint256 totalPaid;              // Lifetime amount paid (USDC, 6 decimals)
        uint256 chargeCount;            // Number of successful charges
        uint256 targetChargeTime;       // Optional: preferred charge time (0 = ASAP)
    }

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Total number of offerings created
    uint256 public offeringCount;

    /// @notice Mapping from offering ID to offering data
    mapping(uint256 => SubscriptionOffering) public offerings;

    /// @notice Nested mapping: offeringId => subscriber => subscription data
    mapping(uint256 => mapping(address => UserSubscription)) public subscriptions;

    /// @notice Track subscriber addresses per offering (for getOfferingSubscribers)
    mapping(uint256 => address[]) private offeringSubscribers;

    /// @notice Track which offerings a user is subscribed to
    mapping(address => uint256[]) private userOfferingIds;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event OfferingCreated(
        uint256 indexed offeringId,
        string serviceId,
        address indexed owner,
        address indexed recipient,
        uint256 amountPerPeriod,
        uint256 periodInSeconds
    );

    event UserSubscribed(
        uint256 indexed offeringId,
        address indexed subscriber,
        uint256 timestamp
    );

    event SubscriptionCharged(
        uint256 indexed offeringId,
        address indexed subscriber,
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );

    event SubscriptionCanceled(
        uint256 indexed offeringId,
        address indexed subscriber,
        uint256 timestamp
    );

    event OfferingPaused(
        uint256 indexed offeringId,
        uint256 timestamp
    );

    event OfferingUnpaused(
        uint256 indexed offeringId,
        uint256 timestamp
    );

    event OfferingCanceled(
        uint256 indexed offeringId,
        address indexed owner,
        uint256 subscriberCount,
        uint256 timestamp
    );

    event BatchChargeCompleted(
        uint256 indexed offeringId,
        uint256 successCount,
        uint256 failCount,
        uint256 timestamp
    );

    event TargetChargeTimeUpdated(
        uint256 indexed offeringId,
        address indexed subscriber,
        uint256 targetTimestamp
    );

    /*//////////////////////////////////////////////////////////////
                              CUSTOM ERRORS
    //////////////////////////////////////////////////////////////*/

    error OfferingNotFound(uint256 offeringId);
    error OfferingNotActive(uint256 offeringId);
    error SubscriptionNotActive(uint256 offeringId, address subscriber);
    error SubscriptionAlreadyActive(uint256 offeringId, address subscriber);
    error InsufficientAllowance(uint256 required, uint256 actual);
    error UnauthorizedCaller(address caller);
    error InvalidAddress(string field);
    error InvalidServiceId(string reason);
    error InvalidAmount(uint256 amount, uint256 min, uint256 max);
    error InvalidPeriod(uint256 period, uint256 min, uint256 max);
    error BillingPeriodNotElapsed(uint256 timeRemaining);
    error OwnerCannotSubscribe(address owner);
    error RecipientCannotSubscribe(address recipient);
    error InvalidTargetTime(uint256 targetTime);

    /*//////////////////////////////////////////////////////////////
                              MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier offeringExists(uint256 offeringId) {
        if (offerings[offeringId].createdAt == 0) {
            revert OfferingNotFound(offeringId);
        }
        _;
    }

    modifier offeringActive(uint256 offeringId) {
        if (!offerings[offeringId].active) {
            revert OfferingNotActive(offeringId);
        }
        _;
    }

    modifier subscriptionActive(uint256 offeringId, address subscriber) {
        if (!subscriptions[offeringId][subscriber].active) {
            revert SubscriptionNotActive(offeringId, subscriber);
        }
        _;
    }

    /*//////////////////////////////////////////////////////////////
                             CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Contract constructor
     * @param _usdc Address of the USDC token contract
     */
    constructor(address _usdc) Ownable(msg.sender) {
        if (_usdc == address(0)) revert InvalidAddress("usdc");
        usdc = IERC20(_usdc);
    }

    /*//////////////////////////////////////////////////////////////
                         OFFERING MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Create a new subscription offering
     * @param serviceId Human-readable service identifier (e.g., "MoltDigest Weekly")
     * @param recipient Address to receive payments (can be different from msg.sender)
     * @param amountPerPeriod USDC amount to charge per period (6 decimals)
     * @param periodInSeconds Length of billing period in seconds
     * @return offeringId The created offering ID
     */
    function createOffering(
        string calldata serviceId,
        address recipient,
        uint256 amountPerPeriod,
        uint256 periodInSeconds
    ) external whenNotPaused returns (uint256 offeringId) {
        // Validate inputs
        if (bytes(serviceId).length == 0) {
            revert InvalidServiceId("Service ID cannot be empty");
        }
        if (bytes(serviceId).length > MAX_SERVICE_ID_LENGTH) {
            revert InvalidServiceId("Service ID too long");
        }
        if (msg.sender == address(0)) revert InvalidAddress("owner");
        if (recipient == address(0)) revert InvalidAddress("recipient");
        if (amountPerPeriod == 0 || amountPerPeriod > MAX_AMOUNT_PER_PERIOD) {
            revert InvalidAmount(amountPerPeriod, 1, MAX_AMOUNT_PER_PERIOD);
        }
        if (periodInSeconds < MIN_PERIOD_SECONDS || periodInSeconds > MAX_PERIOD_SECONDS) {
            revert InvalidPeriod(periodInSeconds, MIN_PERIOD_SECONDS, MAX_PERIOD_SECONDS);
        }

        offeringId = offeringCount++;

        offerings[offeringId] = SubscriptionOffering({
            serviceId: serviceId,
            owner: msg.sender,
            recipient: recipient,
            amountPerPeriod: amountPerPeriod,
            periodInSeconds: periodInSeconds,
            createdAt: block.timestamp,
            active: true,
            totalSubscribers: 0
        });

        emit OfferingCreated(
            offeringId,
            serviceId,
            msg.sender,
            recipient,
            amountPerPeriod,
            periodInSeconds
        );
    }

    /**
     * @notice Pause an offering (stops new subscriptions and charges)
     * @param offeringId The offering to pause
     */
    function pauseOffering(uint256 offeringId) 
        external 
        offeringExists(offeringId) 
    {
        SubscriptionOffering storage offering = offerings[offeringId];
        if (msg.sender != offering.owner) revert UnauthorizedCaller(msg.sender);
        if (!offering.active) revert OfferingNotActive(offeringId);

        offering.active = false;
        emit OfferingPaused(offeringId, block.timestamp);
    }

    /**
     * @notice Unpause an offering
     * @param offeringId The offering to unpause
     */
    function unpauseOffering(uint256 offeringId) 
        external 
        offeringExists(offeringId) 
    {
        SubscriptionOffering storage offering = offerings[offeringId];
        if (msg.sender != offering.owner) revert UnauthorizedCaller(msg.sender);
        if (offering.active) return; // Already active

        offering.active = true;
        emit OfferingUnpaused(offeringId, block.timestamp);
    }

    /**
     * @notice Cancel an offering and all active subscriptions
     * @dev Gas-intensive for offerings with many subscribers
     * @param offeringId The offering to cancel
     */
    function cancelOffering(uint256 offeringId) 
        external 
        offeringExists(offeringId) 
    {
        SubscriptionOffering storage offering = offerings[offeringId];
        if (msg.sender != offering.owner) revert UnauthorizedCaller(msg.sender);

        offering.active = false;

        // Cancel all active subscriptions
        address[] storage subscribers = offeringSubscribers[offeringId];
        uint256 canceledCount = 0;

        for (uint256 i = 0; i < subscribers.length; i++) {
            address subscriber = subscribers[i];
            UserSubscription storage sub = subscriptions[offeringId][subscriber];
            
            if (sub.active) {
                sub.active = false;
                canceledCount++;
                emit SubscriptionCanceled(offeringId, subscriber, block.timestamp);
            }
        }

        offering.totalSubscribers = 0;

        emit OfferingCanceled(offeringId, msg.sender, canceledCount, block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                        SUBSCRIPTION MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Subscribe to an offering
     * @dev Requires user to have approved sufficient USDC allowance first
     * @param offeringId The offering to subscribe to
     */
    function subscribe(uint256 offeringId) 
        external 
        nonReentrant 
        whenNotPaused
        offeringExists(offeringId)
        offeringActive(offeringId)
    {
        SubscriptionOffering storage offering = offerings[offeringId];
        UserSubscription storage sub = subscriptions[offeringId][msg.sender];

        // Validation
        if (sub.active) revert SubscriptionAlreadyActive(offeringId, msg.sender);
        if (msg.sender == offering.owner) revert OwnerCannotSubscribe(offering.owner);
        if (msg.sender == offering.recipient) revert RecipientCannotSubscribe(offering.recipient);

        // Check USDC allowance
        uint256 allowance = usdc.allowance(msg.sender, address(this));
        if (allowance < offering.amountPerPeriod) {
            revert InsufficientAllowance(offering.amountPerPeriod, allowance);
        }

        // Check if this is a re-subscription or first subscription
        if (sub.subscriber == address(0)) {
            // First-time subscription
            sub.subscriber = msg.sender;
            sub.offeringId = offeringId;
            userOfferingIds[msg.sender].push(offeringId);
            offeringSubscribers[offeringId].push(msg.sender);
        }
        // else: Re-subscription - preserve totalPaid and chargeCount history

        // Activate subscription
        sub.active = true;
        sub.startTime = block.timestamp;
        sub.lastChargeTime = block.timestamp;

        offering.totalSubscribers++;

        emit UserSubscribed(offeringId, msg.sender, block.timestamp);
    }

    /**
     * @notice Cancel an active subscription
     * @dev Only the subscriber can cancel their own subscription
     * @param offeringId The offering to cancel subscription for
     */
    function cancelSubscription(uint256 offeringId) 
        external 
        subscriptionActive(offeringId, msg.sender)
    {
        UserSubscription storage sub = subscriptions[offeringId][msg.sender];
        sub.active = false;

        SubscriptionOffering storage offering = offerings[offeringId];
        offering.totalSubscribers--;

        emit SubscriptionCanceled(offeringId, msg.sender, block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                              CHARGING
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Charge a subscription
     * @dev Only owner, recipient, or subscriber can charge (access control)
     * @param offeringId The offering
     * @param subscriber The subscriber to charge
     */
    function charge(uint256 offeringId, address subscriber) 
        external 
        nonReentrant 
        whenNotPaused
        offeringExists(offeringId)
        offeringActive(offeringId)
        subscriptionActive(offeringId, subscriber)
    {
        SubscriptionOffering storage offering = offerings[offeringId];
        UserSubscription storage sub = subscriptions[offeringId][subscriber];

        // Access control
        if (
            msg.sender != offering.owner &&
            msg.sender != subscriber &&
            msg.sender != offering.recipient
        ) {
            revert UnauthorizedCaller(msg.sender);
        }

        // Check billing period
        uint256 nextChargeTime = sub.lastChargeTime + offering.periodInSeconds;

        // Use target charge time if set
        if (sub.targetChargeTime > 0) {
            nextChargeTime = sub.targetChargeTime;
        }

        if (block.timestamp < nextChargeTime) {
            revert BillingPeriodNotElapsed(nextChargeTime - block.timestamp);
        }

        // Transfer USDC
        usdc.safeTransferFrom(subscriber, offering.recipient, offering.amountPerPeriod);

        // Update state
        sub.lastChargeTime = block.timestamp;
        sub.totalPaid += offering.amountPerPeriod;
        sub.chargeCount++;

        // Update target charge time for next period if scheduling is active
        if (sub.targetChargeTime > 0) {
            sub.targetChargeTime += offering.periodInSeconds;
        }

        emit SubscriptionCharged(
            offeringId,
            subscriber,
            offering.recipient,
            offering.amountPerPeriod,
            block.timestamp
        );
    }

    /**
     * @notice Batch charge all ready subscribers for an offering
     * @dev Gas-intensive, use carefully for offerings with many subscribers
     * @param offeringId The offering
     * @return successCount Number of successful charges
     * @return failCount Number of failed charges
     */
    function chargeAll(uint256 offeringId) 
        external 
        whenNotPaused
        offeringExists(offeringId)
        offeringActive(offeringId)
        returns (uint256 successCount, uint256 failCount)
    {
        SubscriptionOffering storage offering = offerings[offeringId];
        address[] storage subscribers = offeringSubscribers[offeringId];
        
        for (uint256 i = 0; i < subscribers.length; i++) {
            address subscriber = subscribers[i];
            UserSubscription storage sub = subscriptions[offeringId][subscriber];
            
            if (!sub.active) {
                continue;
            }

            // Check if ready to charge
            uint256 nextChargeTime = sub.lastChargeTime + offering.periodInSeconds;
            if (sub.targetChargeTime > 0) {
                nextChargeTime = sub.targetChargeTime;
            }
            
            if (block.timestamp < nextChargeTime) {
                continue;
            }

            // Check allowance and balance before attempting transfer
            uint256 allowance = usdc.allowance(subscriber, address(this));
            uint256 balance = usdc.balanceOf(subscriber);
            
            if (allowance < offering.amountPerPeriod || balance < offering.amountPerPeriod) {
                failCount++;
                continue;
            }

            // Charge subscriber
            usdc.safeTransferFrom(subscriber, offering.recipient, offering.amountPerPeriod);
            
            // Update state
            sub.lastChargeTime = block.timestamp;
            sub.totalPaid += offering.amountPerPeriod;
            sub.chargeCount++;

            // Update target charge time if scheduling is active
            if (sub.targetChargeTime > 0) {
                sub.targetChargeTime += offering.periodInSeconds;
            }

            emit SubscriptionCharged(
                offeringId,
                subscriber,
                offering.recipient,
                offering.amountPerPeriod,
                block.timestamp
            );
            
            successCount++;
        }

        emit BatchChargeCompleted(offeringId, successCount, failCount, block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                            SCHEDULING
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Set target charge time for recurring billing
     * @param offeringId The offering
     * @param targetTimestamp Unix timestamp for preferred charge time (0 to disable)
     */
    function setTargetChargeTime(uint256 offeringId, uint256 targetTimestamp) 
        external 
        subscriptionActive(offeringId, msg.sender)
    {
        if (targetTimestamp != 0 && targetTimestamp <= block.timestamp) {
            revert InvalidTargetTime(targetTimestamp);
        }

        UserSubscription storage sub = subscriptions[offeringId][msg.sender];
        sub.targetChargeTime = targetTimestamp;

        emit TargetChargeTimeUpdated(offeringId, msg.sender, targetTimestamp);
    }

    /**
     * @notice Set recurring monthly charge on specific day/hour
     * @param offeringId The offering
     * @param dayOfMonth 1-31
     * @param hourUTC 0-23
     */
    function setMonthlySchedule(
        uint256 offeringId,
        uint8 dayOfMonth,
        uint8 hourUTC
    ) external subscriptionActive(offeringId, msg.sender) {
        require(dayOfMonth >= 1 && dayOfMonth <= 31, "Invalid day");
        require(hourUTC <= 23, "Invalid hour");

        // Calculate next occurrence
        // This is simplified - production would need proper date math library
        uint256 nextCharge = _calculateNextMonthlyCharge(dayOfMonth, hourUTC);
        
        UserSubscription storage sub = subscriptions[offeringId][msg.sender];
        sub.targetChargeTime = nextCharge;

        emit TargetChargeTimeUpdated(offeringId, msg.sender, nextCharge);
    }

    /**
     * @dev Calculate next monthly charge timestamp (simplified)
     * @param hourUTC Target hour (0-23)
     * @return Next charge timestamp
     * @notice This is a simplified implementation. dayOfMonth is accepted for interface compatibility 
     *         but not used. Production needs proper date library for accurate monthly scheduling.
     */
    function _calculateNextMonthlyCharge(
        uint8 /* dayOfMonth */,
        uint8 hourUTC
    ) internal view returns (uint256) {
        // Simplified implementation - production needs proper date library
        // For now, just schedule 30 days from now at the target hour
        // dayOfMonth is not currently used in this simplified version
        return block.timestamp + 30 days + (hourUTC * 1 hours);
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get offering details
     * @param offeringId The offering ID
     * @return Offering data
     */
    function getOffering(uint256 offeringId) 
        external 
        view 
        offeringExists(offeringId)
        returns (SubscriptionOffering memory) 
    {
        return offerings[offeringId];
    }

    /**
     * @notice Get user's subscription to an offering
     * @param offeringId The offering ID
     * @param user The user address
     * @return Subscription data
     */
    function getUserSubscription(uint256 offeringId, address user) 
        external 
        view 
        returns (UserSubscription memory) 
    {
        return subscriptions[offeringId][user];
    }

    /**
     * @notice Get all offerings a user is subscribed to
     * @param user The user address
     * @return Array of offering IDs
     */
    function getUserOfferingIds(address user) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return userOfferingIds[user];
    }

    /**
     * @notice Get all subscribers for an offering
     * @dev Gas-intensive for offerings with many subscribers
     * @param offeringId The offering ID
     * @return Array of subscriber addresses
     */
    function getOfferingSubscribers(uint256 offeringId) 
        external 
        view 
        offeringExists(offeringId)
        returns (address[] memory) 
    {
        return offeringSubscribers[offeringId];
    }

    /**
     * @notice Get count of subscribers for an offering
     * @param offeringId The offering ID
     * @return Number of active subscribers
     */
    function getOfferingSubscriberCount(uint256 offeringId) 
        external 
        view 
        offeringExists(offeringId)
        returns (uint256) 
    {
        return offerings[offeringId].totalSubscribers;
    }

    /**
     * @notice Check if a subscriber can be charged
     * @param offeringId The offering ID
     * @param subscriber The subscriber address
     * @return ready True if charge() can be called successfully
     */
    function canCharge(uint256 offeringId, address subscriber) 
        external 
        view 
        returns (bool ready) 
    {
        SubscriptionOffering storage offering = offerings[offeringId];
        UserSubscription storage sub = subscriptions[offeringId][subscriber];
        
        if (!offering.active || !sub.active) {
            return false;
        }

        uint256 nextChargeTime = sub.lastChargeTime + offering.periodInSeconds;
        if (sub.targetChargeTime > 0) {
            nextChargeTime = sub.targetChargeTime;
        }
        
        return block.timestamp >= nextChargeTime;
    }

    /**
     * @notice Get time remaining until next charge
     * @param offeringId The offering ID
     * @param subscriber The subscriber address
     * @return secondsRemaining Seconds until next charge (0 if ready now)
     */
    function timeUntilNextCharge(uint256 offeringId, address subscriber) 
        external 
        view 
        subscriptionActive(offeringId, subscriber)
        returns (uint256 secondsRemaining) 
    {
        SubscriptionOffering storage offering = offerings[offeringId];
        UserSubscription storage sub = subscriptions[offeringId][subscriber];

        uint256 nextChargeTime = sub.lastChargeTime + offering.periodInSeconds;
        if (sub.targetChargeTime > 0) {
            nextChargeTime = sub.targetChargeTime;
        }
        
        if (block.timestamp >= nextChargeTime) {
            return 0;
        }
        
        return nextChargeTime - block.timestamp;
    }

    /**
     * @notice Get all subscribers ready to charge (helper for batch operations)
     * @param offeringId The offering ID
     * @return Array of subscriber addresses ready to charge
     */
    function getChargableSubscribers(uint256 offeringId) 
        external 
        view 
        offeringExists(offeringId)
        returns (address[] memory) 
    {
        address[] storage allSubscribers = offeringSubscribers[offeringId];
        SubscriptionOffering storage offering = offerings[offeringId];
        
        // Count ready subscribers first
        uint256 readyCount = 0;
        for (uint256 i = 0; i < allSubscribers.length; i++) {
            address subscriber = allSubscribers[i];
            UserSubscription storage sub = subscriptions[offeringId][subscriber];
            
            if (!sub.active || !offering.active) continue;
            
            uint256 nextChargeTime = sub.lastChargeTime + offering.periodInSeconds;
            if (sub.targetChargeTime > 0) {
                nextChargeTime = sub.targetChargeTime;
            }
            
            if (block.timestamp >= nextChargeTime) {
                readyCount++;
            }
        }
        
        // Build result array
        address[] memory ready = new address[](readyCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allSubscribers.length; i++) {
            address subscriber = allSubscribers[i];
            UserSubscription storage sub = subscriptions[offeringId][subscriber];
            
            if (!sub.active || !offering.active) continue;
            
            uint256 nextChargeTime = sub.lastChargeTime + offering.periodInSeconds;
            if (sub.targetChargeTime > 0) {
                nextChargeTime = sub.targetChargeTime;
            }
            
            if (block.timestamp >= nextChargeTime) {
                ready[index++] = subscriber;
            }
        }
        
        return ready;
    }

    /*//////////////////////////////////////////////////////////////
                          EMERGENCY CONTROLS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Pause all contract operations (emergency only)
     * @dev Only owner can call
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract operations
     * @dev Only owner can call
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Mock ERC20 token for testing purposes only
 */
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: AgentSubscriptionsV2.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

// Helper functions for time manipulation
async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}

async function getLatestTimestamp() {
  const block = await ethers.provider.getBlock('latest');
  return block.timestamp;
}

async function setNextBlockTimestamp(timestamp) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await ethers.provider.send("evm_mine");
}

describe("AgentSubscriptionsV2", function () {
  let agentSubscriptions;
  let mockUSDC;
  let owner, agent, subscriber, subscriber2, recipient, other;
  let ONE_USDC, TEN_USDC;
  
  const ONE_WEEK = 7 * 24 * 60 * 60;
  const ONE_MINUTE = 60;

  beforeEach(async function () {
    [owner, agent, subscriber, subscriber2, recipient, other] = await ethers.getSigners();

    // Initialize constants
    ONE_USDC = ethers.parseUnits("1", 6);
    TEN_USDC = ethers.parseUnits("10", 6);

    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);
    await mockUSDC.waitForDeployment();

    // Deploy AgentSubscriptions v2
    const AgentSubscriptionsV2 = await ethers.getContractFactory("AgentSubscriptionsV2");
    agentSubscriptions = await AgentSubscriptionsV2.deploy(await mockUSDC.getAddress());
    await agentSubscriptions.waitForDeployment();

    // Mint USDC to test accounts
    await mockUSDC.mint(subscriber.address, ethers.parseUnits("1000", 6));
    await mockUSDC.mint(subscriber2.address, ethers.parseUnits("1000", 6));
  });

  describe("Deployment", function () {
    it("Should set the correct USDC address", async function () {
      expect(await agentSubscriptions.usdc()).to.equal(await mockUSDC.getAddress());
    });

    it("Should start with zero offerings", async function () {
      expect(await agentSubscriptions.offeringCount()).to.equal(0);
    });

    it("Should set owner correctly", async function () {
      expect(await agentSubscriptions.owner()).to.equal(owner.address);
    });

    it("Should reject zero USDC address", async function () {
      const AgentSubscriptionsV2 = await ethers.getContractFactory("AgentSubscriptionsV2");
      await expect(
        AgentSubscriptionsV2.deploy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidAddress");
    });
  });

  describe("Create Offering - Validation", function () {
    it("Should create offering successfully", async function () {
      const tx = await agentSubscriptions.connect(agent).createOffering(
        "MoltDigest Weekly",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );

      await expect(tx).to.emit(agentSubscriptions, "OfferingCreated");
      expect(await agentSubscriptions.offeringCount()).to.equal(1);
    });

    it("Should reject empty service ID", async function () {
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "",
          recipient.address,
          ONE_USDC,
          ONE_WEEK
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidServiceId");
    });

    it("Should reject service ID too long", async function () {
      const longId = "a".repeat(101);
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          longId,
          recipient.address,
          ONE_USDC,
          ONE_WEEK
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidServiceId");
    });

    it("Should accept service ID at max length", async function () {
      const maxId = "a".repeat(100);
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          maxId,
          recipient.address,
          ONE_USDC,
          ONE_WEEK
        )
      ).to.not.be.reverted;
    });

    it("Should reject zero recipient address", async function () {
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          ethers.ZeroAddress,
          ONE_USDC,
          ONE_WEEK
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidAddress");
    });

    it("Should reject zero amount", async function () {
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          recipient.address,
          0,
          ONE_WEEK
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidAmount");
    });

    it("Should reject amount too large", async function () {
      const tooLarge = ethers.parseUnits("1000001", 6); // >1M USDC
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          recipient.address,
          tooLarge,
          ONE_WEEK
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidAmount");
    });

    it("Should accept amount at max limit", async function () {
      const maxAmount = ethers.parseUnits("1000000", 6); // Exactly 1M USDC
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          recipient.address,
          maxAmount,
          ONE_WEEK
        )
      ).to.not.be.reverted;
    });

    it("Should reject period too short", async function () {
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          recipient.address,
          ONE_USDC,
          59 // <60 seconds
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidPeriod");
    });

    it("Should reject period too long", async function () {
      const oneYearPlus = (365 * 24 * 60 * 60) + 1;
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test",
          recipient.address,
          ONE_USDC,
          oneYearPlus
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidPeriod");
    });

    it("Should accept period at boundaries", async function () {
      // Min boundary
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test Min",
          recipient.address,
          ONE_USDC,
          60
        )
      ).to.not.be.reverted;

      // Max boundary
      const oneYear = 365 * 24 * 60 * 60;
      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Test Max",
          recipient.address,
          ONE_USDC,
          oneYear
        )
      ).to.not.be.reverted;
    });
  });

  describe("Subscribe - Multi-Subscriber Support", function () {
    beforeEach(async function () {
      // Create offering
      await agentSubscriptions.connect(agent).createOffering(
        "MoltDigest Weekly",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );
    });

    it("Should allow multiple users to subscribe to same offering", async function () {
      // Subscriber 1
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );
      await agentSubscriptions.connect(subscriber).subscribe(0);

      // Subscriber 2
      await mockUSDC.connect(subscriber2).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );
      await agentSubscriptions.connect(subscriber2).subscribe(0);

      // Verify both subscriptions
      const sub1 = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      const sub2 = await agentSubscriptions.getUserSubscription(0, subscriber2.address);

      expect(sub1.active).to.be.true;
      expect(sub2.active).to.be.true;
      expect(sub1.subscriber).to.equal(subscriber.address);
      expect(sub2.subscriber).to.equal(subscriber2.address);

      // Check subscriber count
      const offering = await agentSubscriptions.getOffering(0);
      expect(offering.totalSubscribers).to.equal(2);
    });

    it("Should allow user to subscribe to multiple offerings", async function () {
      // Create second offering
      await agentSubscriptions.connect(agent).createOffering(
        "Premium Service",
        recipient.address,
        ONE_USDC * 2n,
        ONE_WEEK
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      // Subscribe to both
      await agentSubscriptions.connect(subscriber).subscribe(0);
      await agentSubscriptions.connect(subscriber).subscribe(1);

      const userOfferings = await agentSubscriptions.getUserOfferingIds(subscriber.address);
      expect(userOfferings.length).to.equal(2);
      expect(userOfferings[0]).to.equal(0);
      expect(userOfferings[1]).to.equal(1);
    });

    it("Should reject double subscription", async function () {
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);

      await expect(
        agentSubscriptions.connect(subscriber).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "SubscriptionAlreadyActive");
    });

    it("Should reject owner subscribing to own offering", async function () {
      await mockUSDC.mint(agent.address, ethers.parseUnits("100", 6));
      await mockUSDC.connect(agent).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );

      await expect(
        agentSubscriptions.connect(agent).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "OwnerCannotSubscribe");
    });

    it("Should reject recipient subscribing", async function () {
      await mockUSDC.mint(recipient.address, ethers.parseUnits("100", 6));
      await mockUSDC.connect(recipient).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );

      await expect(
        agentSubscriptions.connect(recipient).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "RecipientCannotSubscribe");
    });

    it("Should reject subscription to non-existent offering", async function () {
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );

      await expect(
        agentSubscriptions.connect(subscriber).subscribe(999)
      ).to.be.revertedWithCustomError(agentSubscriptions, "OfferingNotFound");
    });

    it("Should reject subscribe without allowance", async function () {
      await expect(
        agentSubscriptions.connect(subscriber).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "InsufficientAllowance");
    });

    it("Should reject subscribe with insufficient allowance", async function () {
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ONE_USDC / 2n // Less than required
      );

      await expect(
        agentSubscriptions.connect(subscriber).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "InsufficientAllowance");
    });
  });

  describe("Re-subscription", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );
    });

    it("Should allow re-subscription after cancel", async function () {
      // Initial subscription
      await agentSubscriptions.connect(subscriber).subscribe(0);
      
      // Cancel
      await agentSubscriptions.connect(subscriber).cancelSubscription(0);
      
      // Re-subscribe
      await expect(
        agentSubscriptions.connect(subscriber).subscribe(0)
      ).to.not.be.reverted;

      const sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.active).to.be.true;
    });

    it("Should preserve totalPaid and chargeCount on re-subscription", async function () {
      // Subscribe
      await agentSubscriptions.connect(subscriber).subscribe(0);
      
      // Charge once
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);
      
      let sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.totalPaid).to.equal(ONE_USDC);
      expect(sub.chargeCount).to.equal(1);
      
      // Cancel and re-subscribe
      await agentSubscriptions.connect(subscriber).cancelSubscription(0);
      await agentSubscriptions.connect(subscriber).subscribe(0);
      
      // Metrics should be preserved
      sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.totalPaid).to.equal(ONE_USDC); // Preserved from before
      expect(sub.chargeCount).to.equal(1); // Preserved from before
      expect(sub.active).to.be.true;
    });

    it("Should reset billing period on re-subscription", async function () {
      // Subscribe and wait
      await agentSubscriptions.connect(subscriber).subscribe(0);
      await increaseTime(30);
      
      // Cancel and immediately re-subscribe
      await agentSubscriptions.connect(subscriber).cancelSubscription(0);
      await agentSubscriptions.connect(subscriber).subscribe(0);
      
      // Should not be chargeable immediately (billing period reset)
      expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.false;
    });
  });

  describe("Charge - Access Control", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);
      await increaseTime(61);
    });

    it("Should allow owner to charge", async function () {
      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.not.be.reverted;
    });

    it("Should allow recipient to charge", async function () {
      await expect(
        agentSubscriptions.connect(recipient).charge(0, subscriber.address)
      ).to.not.be.reverted;
    });

    it("Should allow subscriber to charge themselves", async function () {
      await expect(
        agentSubscriptions.connect(subscriber).charge(0, subscriber.address)
      ).to.not.be.reverted;
    });

    it("Should reject charge from unauthorized caller", async function () {
      await expect(
        agentSubscriptions.connect(other).charge(0, subscriber.address)
      ).to.be.revertedWithCustomError(agentSubscriptions, "UnauthorizedCaller");
    });
  });

  describe("Charge - Failure Scenarios", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);
    });

    it("Should reject charge before period elapsed", async function () {
      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.revertedWithCustomError(agentSubscriptions, "BillingPeriodNotElapsed");
    });

    it("Should allow charge after period elapsed", async function () {
      await increaseTime(61);

      const recipientBalanceBefore = await mockUSDC.balanceOf(recipient.address);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);
      const recipientBalanceAfter = await mockUSDC.balanceOf(recipient.address);

      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(ONE_USDC);
    });

    it("Should reject charge on canceled subscription", async function () {
      await agentSubscriptions.connect(subscriber).cancelSubscription(0);

      await increaseTime(61);

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.revertedWithCustomError(agentSubscriptions, "SubscriptionNotActive");
    });

    it("Should reject charge when subscriber has insufficient balance", async function () {
      // Transfer away all USDC
      const balance = await mockUSDC.balanceOf(subscriber.address);
      await mockUSDC.connect(subscriber).transfer(owner.address, balance);

      await increaseTime(61);

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.reverted; // SafeERC20 transfer fails
    });

    it("Should reject charge when subscriber revoked allowance", async function () {
      // Revoke allowance
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        0
      );

      await increaseTime(61);

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.reverted; // SafeERC20 insufficient allowance
    });

    it("Should allow multiple sequential charges", async function () {
      const recipientBalanceBefore = await mockUSDC.balanceOf(recipient.address);

      // First charge
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);

      // Second charge
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);

      // Third charge
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);

      const recipientBalanceAfter = await mockUSDC.balanceOf(recipient.address);

      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(ONE_USDC * 3n);
    });

    it("Should update metrics correctly on charge", async function () {
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);

      const sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.totalPaid).to.equal(ONE_USDC);
      expect(sub.chargeCount).to.equal(1);

      // Second charge
      await increaseTime(61);
      await agentSubscriptions.connect(agent).charge(0, subscriber.address);

      const sub2 = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub2.totalPaid).to.equal(ONE_USDC * 2n);
      expect(sub2.chargeCount).to.equal(2);
    });

    it("Should reject charge on paused offering", async function () {
      await agentSubscriptions.connect(agent).pauseOffering(0);
      
      await increaseTime(61);

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.revertedWithCustomError(agentSubscriptions, "OfferingNotActive");
    });
  });

  describe("Scheduling", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);
    });

    it("Should allow setting target charge time", async function () {
      const futureTime = (await getLatestTimestamp()) + 86400; // 1 day from now
      
      await expect(
        agentSubscriptions.connect(subscriber).setTargetChargeTime(0, futureTime)
      ).to.emit(agentSubscriptions, "TargetChargeTimeUpdated")
        .withArgs(0, subscriber.address, futureTime);

      const sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.targetChargeTime).to.equal(futureTime);
    });

    it("Should reject past target time", async function () {
      const pastTime = (await getLatestTimestamp()) - 100;

      await expect(
        agentSubscriptions.connect(subscriber).setTargetChargeTime(0, pastTime)
      ).to.be.revertedWithCustomError(agentSubscriptions, "InvalidTargetTime");
    });

    it("Should allow disabling schedule with zero", async function () {
      // Set schedule first
      const futureTime = (await getLatestTimestamp()) + 86400;
      await agentSubscriptions.connect(subscriber).setTargetChargeTime(0, futureTime);

      // Disable
      await agentSubscriptions.connect(subscriber).setTargetChargeTime(0, 0);

      const sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.targetChargeTime).to.equal(0);
    });

    it("Should respect target charge time when charging", async function () {
      const futureTime = (await getLatestTimestamp()) + 86400; // 1 day from now
      await agentSubscriptions.connect(subscriber).setTargetChargeTime(0, futureTime);

      // Try to charge before target time (but after normal period would allow)
      // Only advance half a day - still before the 1 day target
      await increaseTime(43200); // 12 hours

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.be.revertedWithCustomError(agentSubscriptions, "BillingPeriodNotElapsed");

      // Charge at target time
      await setNextBlockTimestamp(futureTime);

      await expect(
        agentSubscriptions.connect(agent).charge(0, subscriber.address)
      ).to.not.be.reverted;
    });

    it("Should allow setting monthly schedule", async function () {
      await expect(
        agentSubscriptions.connect(subscriber).setMonthlySchedule(0, 1, 8) // 1st of month, 8am
      ).to.not.be.reverted;

      const sub = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      expect(sub.targetChargeTime).to.be.gt(0);
    });
  });

  describe("Batch Charging", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      // Subscribe multiple users
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );
      await agentSubscriptions.connect(subscriber).subscribe(0);

      await mockUSDC.connect(subscriber2).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );
      await agentSubscriptions.connect(subscriber2).subscribe(0);
    });

    it("Should charge all ready subscribers", async function () {
      await increaseTime(61);

      const tx = await agentSubscriptions.connect(agent).chargeAll(0);
      const receipt = await tx.wait();

      // Should have charged both subscribers
      const event = receipt.logs.find(log => {
        try {
          const parsed = agentSubscriptions.interface.parseLog(log);
          return parsed.name === 'BatchChargeCompleted';
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsed = agentSubscriptions.interface.parseLog(event);
      expect(parsed.args.successCount).to.equal(2);
      expect(parsed.args.failCount).to.equal(0);
    });

    it("Should handle partial failures gracefully", async function () {
      // Revoke one subscriber's allowance
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        0
      );

      await increaseTime(61);

      const tx = await agentSubscriptions.connect(agent).chargeAll(0);
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => {
        try {
          const parsed = agentSubscriptions.interface.parseLog(log);
          return parsed.name === 'BatchChargeCompleted';
        } catch {
          return false;
        }
      });

      const parsed = agentSubscriptions.interface.parseLog(event);
      expect(parsed.args.successCount).to.equal(1);
      expect(parsed.args.failCount).to.equal(1);
    });

    it("Should skip subscribers not ready to charge", async function () {
      // Don't advance time - no one ready
      const tx = await agentSubscriptions.connect(agent).chargeAll(0);
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => {
        try {
          const parsed = agentSubscriptions.interface.parseLog(log);
          return parsed.name === 'BatchChargeCompleted';
        } catch {
          return false;
        }
      });

      const parsed = agentSubscriptions.interface.parseLog(event);
      expect(parsed.args.successCount).to.equal(0);
      expect(parsed.args.failCount).to.equal(0);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        100 // 100 seconds
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);
    });

    describe("canCharge", function () {
      it("Should return false immediately after subscribe", async function () {
        expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.false;
      });

      it("Should return false before period elapsed", async function () {
        await increaseTime(50);
        expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.false;
      });

      it("Should return true after period elapsed", async function () {
        await increaseTime(101);
        expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.true;
      });

      it("Should return false for inactive subscription", async function () {
        await agentSubscriptions.connect(subscriber).cancelSubscription(0);
        await increaseTime(101);
        expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.false;
      });

      it("Should return false for paused offering", async function () {
        await agentSubscriptions.connect(agent).pauseOffering(0);
        await increaseTime(101);
        expect(await agentSubscriptions.canCharge(0, subscriber.address)).to.be.false;
      });
    });

    describe("timeUntilNextCharge", function () {
      it("Should return approximately full period immediately after subscribe", async function () {
        const timeRemaining = await agentSubscriptions.timeUntilNextCharge(0, subscriber.address);
        expect(timeRemaining).to.be.closeTo(100, 5);
      });

      it("Should return 0 when ready to charge", async function () {
        await increaseTime(101);
        expect(await agentSubscriptions.timeUntilNextCharge(0, subscriber.address)).to.equal(0);
      });

      it("Should return correct time remaining midway", async function () {
        await increaseTime(50);
        const timeRemaining = await agentSubscriptions.timeUntilNextCharge(0, subscriber.address);
        expect(timeRemaining).to.be.closeTo(50, 5);
      });

      it("Should revert for inactive subscription", async function () {
        await agentSubscriptions.connect(subscriber).cancelSubscription(0);
        await expect(
          agentSubscriptions.timeUntilNextCharge(0, subscriber.address)
        ).to.be.revertedWithCustomError(agentSubscriptions, "SubscriptionNotActive");
      });
    });

    describe("getOfferingSubscribers", function () {
      it("Should return all subscribers", async function () {
        // Add second subscriber
        await mockUSDC.connect(subscriber2).approve(
          await agentSubscriptions.getAddress(),
          ethers.parseUnits("100", 6)
        );
        await agentSubscriptions.connect(subscriber2).subscribe(0);

        const subscribers = await agentSubscriptions.getOfferingSubscribers(0);
        expect(subscribers.length).to.equal(2);
        expect(subscribers).to.include(subscriber.address);
        expect(subscribers).to.include(subscriber2.address);
      });

      it("Should return empty array for new offering", async function () {
        await agentSubscriptions.connect(agent).createOffering(
          "New Service",
          recipient.address,
          ONE_USDC,
          100
        );

        const subscribers = await agentSubscriptions.getOfferingSubscribers(1);
        expect(subscribers.length).to.equal(0);
      });
    });

    describe("getUserOfferingIds", function () {
      it("Should return empty array for user with no subscriptions", async function () {
        const offerings = await agentSubscriptions.getUserOfferingIds(other.address);
        expect(offerings.length).to.equal(0);
      });

      it("Should return correct offering IDs", async function () {
        // Create and subscribe to another offering
        await agentSubscriptions.connect(agent).createOffering(
          "Second Service",
          recipient.address,
          ONE_USDC,
          100
        );
        await agentSubscriptions.connect(subscriber).subscribe(1);

        const offerings = await agentSubscriptions.getUserOfferingIds(subscriber.address);
        expect(offerings.length).to.equal(2);
        expect(offerings[0]).to.equal(0);
        expect(offerings[1]).to.equal(1);
      });
    });
  });

  describe("Pause/Unpause Offering", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );
    });

    it("Should allow owner to pause offering", async function () {
      await expect(
        agentSubscriptions.connect(agent).pauseOffering(0)
      ).to.emit(agentSubscriptions, "OfferingPaused");

      const offering = await agentSubscriptions.getOffering(0);
      expect(offering.active).to.be.false;
    });

    it("Should reject pause from non-owner", async function () {
      await expect(
        agentSubscriptions.connect(other).pauseOffering(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "UnauthorizedCaller");
    });

    it("Should block new subscriptions when paused", async function () {
      await agentSubscriptions.connect(agent).pauseOffering(0);

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );

      await expect(
        agentSubscriptions.connect(subscriber).subscribe(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "OfferingNotActive");
    });

    it("Should allow owner to unpause offering", async function () {
      await agentSubscriptions.connect(agent).pauseOffering(0);
      
      await expect(
        agentSubscriptions.connect(agent).unpauseOffering(0)
      ).to.emit(agentSubscriptions, "OfferingUnpaused");

      const offering = await agentSubscriptions.getOffering(0);
      expect(offering.active).to.be.true;
    });
  });

  describe("Cancel Offering", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      // Add subscribers
      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );
      await agentSubscriptions.connect(subscriber).subscribe(0);

      await mockUSDC.connect(subscriber2).approve(
        await agentSubscriptions.getAddress(),
        TEN_USDC
      );
      await agentSubscriptions.connect(subscriber2).subscribe(0);
    });

    it("Should cancel offering and all subscriptions", async function () {
      await expect(
        agentSubscriptions.connect(agent).cancelOffering(0)
      ).to.emit(agentSubscriptions, "OfferingCanceled");

      const offering = await agentSubscriptions.getOffering(0);
      expect(offering.active).to.be.false;
      expect(offering.totalSubscribers).to.equal(0);

      // Check subscriptions are canceled
      const sub1 = await agentSubscriptions.getUserSubscription(0, subscriber.address);
      const sub2 = await agentSubscriptions.getUserSubscription(0, subscriber2.address);
      expect(sub1.active).to.be.false;
      expect(sub2.active).to.be.false;
    });

    it("Should reject cancel from non-owner", async function () {
      await expect(
        agentSubscriptions.connect(other).cancelOffering(0)
      ).to.be.revertedWithCustomError(agentSubscriptions, "UnauthorizedCaller");
    });
  });

  describe("Emergency Pause", function () {
    beforeEach(async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );
    });

    it("Should allow owner to pause contract", async function () {
      await agentSubscriptions.connect(owner).pause();
      expect(await agentSubscriptions.paused()).to.be.true;
    });

    it("Should reject pause from non-owner", async function () {
      await expect(
        agentSubscriptions.connect(other).pause()
      ).to.be.revertedWithCustomError(agentSubscriptions, "OwnableUnauthorizedAccount");
    });

    it("Should block operations when paused", async function () {
      await agentSubscriptions.connect(owner).pause();

      await expect(
        agentSubscriptions.connect(agent).createOffering(
          "Another Service",
          recipient.address,
          ONE_USDC,
          ONE_MINUTE
        )
      ).to.be.revertedWithCustomError(agentSubscriptions, "EnforcedPause");
    });

    it("Should allow owner to unpause", async function () {
      await agentSubscriptions.connect(owner).pause();
      await agentSubscriptions.connect(owner).unpause();
      expect(await agentSubscriptions.paused()).to.be.false;
    });
  });

  describe("Gas Usage", function () {
    beforeEach(async function () {
      await mockUSDC.mint(subscriber.address, ethers.parseUnits("1000", 6));
    });

    it("Should measure createOffering gas", async function () {
      const tx = await agentSubscriptions.connect(agent).createOffering(
        "MoltDigest Weekly",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );
      const receipt = await tx.wait();

      console.log("      createOffering gas:", receipt.gasUsed.toString());
      expect(receipt.gasUsed).to.be.lessThan(220000); // Adjusted for v2 features
    });

    it("Should measure subscribe gas", async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      const tx = await agentSubscriptions.connect(subscriber).subscribe(0);
      const receipt = await tx.wait();

      console.log("      subscribe gas:", receipt.gasUsed.toString());
      expect(receipt.gasUsed).to.be.lessThan(230000); // Adjusted for subscriber array tracking
    });

    it("Should measure charge gas", async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_MINUTE
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);
      await increaseTime(61);

      const tx = await agentSubscriptions.connect(agent).charge(0, subscriber.address);
      const receipt = await tx.wait();

      console.log("      charge gas:", receipt.gasUsed.toString());
      expect(receipt.gasUsed).to.be.lessThan(140000); // Adjusted for metrics tracking
    });

    it("Should measure cancelSubscription gas", async function () {
      await agentSubscriptions.connect(agent).createOffering(
        "Test Service",
        recipient.address,
        ONE_USDC,
        ONE_WEEK
      );

      await mockUSDC.connect(subscriber).approve(
        await agentSubscriptions.getAddress(),
        ethers.parseUnits("100", 6)
      );

      await agentSubscriptions.connect(subscriber).subscribe(0);

      const tx = await agentSubscriptions.connect(subscriber).cancelSubscription(0);
      const receipt = await tx.wait();

      console.log("      cancelSubscription gas:", receipt.gasUsed.toString());
      expect(receipt.gasUsed).to.be.lessThan(80000);
    });
  });
});
```
