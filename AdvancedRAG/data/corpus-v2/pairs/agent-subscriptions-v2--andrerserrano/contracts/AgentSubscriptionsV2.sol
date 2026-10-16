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
