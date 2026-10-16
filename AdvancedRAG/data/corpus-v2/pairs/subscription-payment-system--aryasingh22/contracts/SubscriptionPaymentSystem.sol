// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Custom ERC20 interface
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title SubscriptionPaymentSystem
 * @dev Raw On-Chain Subscription Payment System using Pull Model (No External Libraries)
 * @notice Enables recurring payments where service providers pull approved tokens at intervals
 */
contract SubscriptionPaymentSystem {

    // Owner management
    address private _owner;
    
    // Reentrancy protection
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;
    
    // Chainlink Automation interface (optional)
    bool public automationEnabled = false;

    // Subscription status enum
    enum SubscriptionStatus {
        Active,
        Paused,
        Cancelled,
        Expired
    }

    // Subscription structure
    struct Subscription {
        address subscriber;
        address recipient;
        address token;
        uint256 amount;
        uint256 interval;
        uint256 nextPaymentTime;
        SubscriptionStatus status;
        uint256 maxPayments; // 0 means unlimited
        uint256 paymentCount;
        uint256 expirationDate; // 0 means no expiration
        uint256 createdAt;
    }

    // State variables
    mapping(uint256 => Subscription) public subscriptions;
    mapping(address => uint256[]) public userSubscriptions;
    mapping(address => uint256[]) public recipientSubscriptions;
    uint256 public nextSubscriptionId;
    uint256 public maxBatchSize = 50; // Limit for batch operations

    // Events
    event SubscriptionCreated(
        uint256 indexed subscriptionId,
        address indexed subscriber,
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 interval
    );

    event PaymentPulled(
        uint256 indexed subscriptionId,
        address indexed subscriber,
        address indexed recipient,
        uint256 amount,
        uint256 paymentCount
    );

    event SubscriptionPaused(uint256 indexed subscriptionId, address indexed subscriber);
    event SubscriptionResumed(uint256 indexed subscriptionId, address indexed subscriber);
    event SubscriptionCancelled(uint256 indexed subscriptionId, address indexed subscriber);
    event SubscriptionExpired(uint256 indexed subscriptionId, address indexed subscriber);

    // Events for ownership
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    
    // Modifiers
    modifier onlyOwner() {
        require(_owner == msg.sender, "Caller is not the owner");
        _;
    }
    
    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
    
    modifier onlySubscriber(uint256 subscriptionId) {
        require(subscriptions[subscriptionId].subscriber == msg.sender, "Not the subscriber");
        _;
    }

    modifier onlyRecipient(uint256 subscriptionId) {
        require(subscriptions[subscriptionId].recipient == msg.sender, "Not the recipient");
        _;
    }

    modifier validSubscription(uint256 subscriptionId) {
        require(subscriptionId < nextSubscriptionId, "Invalid subscription ID");
        _;
    }

    constructor() {
        _owner = msg.sender;
        _status = _NOT_ENTERED;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /**
     * @dev Create a new subscription
     * @param recipient Address that will receive payments
     * @param token ERC20 token address for payments
     * @param amount Amount to be paid each interval
     * @param interval Payment interval in seconds
     * @param maxPayments Maximum number of payments (0 for unlimited)
     * @param expirationDate Expiration timestamp (0 for no expiration)
     */
    function createSubscription(
        address recipient,
        address token,
        uint256 amount,
        uint256 interval,
        uint256 maxPayments,
        uint256 expirationDate
    ) external returns (uint256 subscriptionId) {
        require(recipient != address(0), "Invalid recipient");
        require(token != address(0), "Invalid token");
        require(amount > 0, "Amount must be greater than 0");
        require(interval > 0, "Interval must be greater than 0");
        
        if (expirationDate > 0) {
            require(expirationDate > block.timestamp, "Expiration date must be in the future");
        }

        subscriptionId = nextSubscriptionId++;
        
        subscriptions[subscriptionId] = Subscription({
            subscriber: msg.sender,
            recipient: recipient,
            token: token,
            amount: amount,
            interval: interval,
            nextPaymentTime: block.timestamp + interval,
            status: SubscriptionStatus.Active,
            maxPayments: maxPayments,
            paymentCount: 0,
            expirationDate: expirationDate,
            createdAt: block.timestamp
        });

        userSubscriptions[msg.sender].push(subscriptionId);
        recipientSubscriptions[recipient].push(subscriptionId);

        emit SubscriptionCreated(subscriptionId, msg.sender, recipient, token, amount, interval);
    }

    /**
     * @dev Pause a subscription (only subscriber can pause)
     */
    function pauseSubscription(uint256 subscriptionId) 
        external 
        onlySubscriber(subscriptionId) 
        validSubscription(subscriptionId) 
    {
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.status == SubscriptionStatus.Active, "Subscription not active");
        
        sub.status = SubscriptionStatus.Paused;
        emit SubscriptionPaused(subscriptionId, msg.sender);
    }

    /**
     * @dev Resume a paused subscription
     */
    function resumeSubscription(uint256 subscriptionId) 
        external 
        onlySubscriber(subscriptionId) 
        validSubscription(subscriptionId) 
    {
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.status == SubscriptionStatus.Paused, "Subscription not paused");
        
        // Reset next payment time
        sub.nextPaymentTime = block.timestamp + sub.interval;
        sub.status = SubscriptionStatus.Active;
        emit SubscriptionResumed(subscriptionId, msg.sender);
    }

    /**
     * @dev Cancel a subscription permanently
     */
    function cancelSubscription(uint256 subscriptionId) 
        external 
        onlySubscriber(subscriptionId) 
        validSubscription(subscriptionId) 
    {
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.status != SubscriptionStatus.Cancelled, "Already cancelled");
        
        sub.status = SubscriptionStatus.Cancelled;
        emit SubscriptionCancelled(subscriptionId, msg.sender);
    }

    /**
     * @dev Pull payment for a specific subscription (can be called by anyone)
     */
    function pullPayment(uint256 subscriptionId) 
        external 
        nonReentrant 
        validSubscription(subscriptionId) 
    {
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.status == SubscriptionStatus.Active, "Subscription not active");
        require(block.timestamp >= sub.nextPaymentTime, "Payment not due yet");
        
        // Check if subscription has expired
        if (_isExpired(sub)) {
            sub.status = SubscriptionStatus.Expired;
            emit SubscriptionExpired(subscriptionId, sub.subscriber);
            return;
        }

        // Transfer tokens from subscriber to recipient using raw ERC20 calls
        require(_safeTransferFrom(sub.token, sub.subscriber, sub.recipient, sub.amount), "Token transfer failed");

        // Update subscription state
        sub.paymentCount++;
        sub.nextPaymentTime = block.timestamp + sub.interval;

        // Check if max payments reached
        if (sub.maxPayments > 0 && sub.paymentCount >= sub.maxPayments) {
            sub.status = SubscriptionStatus.Expired;
            emit SubscriptionExpired(subscriptionId, sub.subscriber);
        }

        emit PaymentPulled(subscriptionId, sub.subscriber, sub.recipient, sub.amount, sub.paymentCount);
    }

    function batchPullPayments(uint256[] calldata subscriptionIds) external nonReentrant {
        require(subscriptionIds.length <= maxBatchSize, "Batch size too large");

        for (uint256 i = 0; i < subscriptionIds.length; i++) {
            uint256 subscriptionId = subscriptionIds[i];
            if (subscriptionId < nextSubscriptionId) {
                Subscription storage sub = subscriptions[subscriptionId];

                if (sub.status == SubscriptionStatus.Active &&
                    block.timestamp >= sub.nextPaymentTime &&
                    !_isExpired(sub)) {

                    if (_safeTransferFrom(sub.token, sub.subscriber, sub.recipient, sub.amount)) {
                        sub.paymentCount++;
                        sub.nextPaymentTime = block.timestamp + sub.interval;

                        if (sub.maxPayments > 0 && sub.paymentCount >= sub.maxPayments) {
                            sub.status = SubscriptionStatus.Expired;
                            emit SubscriptionExpired(subscriptionId, sub.subscriber);
                        }

                        emit PaymentPulled(subscriptionId, sub.subscriber, sub.recipient, sub.amount, sub.paymentCount);
                    }
                    // Continue with next subscription if this one fails
                } else if (_isExpired(sub) && sub.status == SubscriptionStatus.Active) {
                    sub.status = SubscriptionStatus.Expired;
                    emit SubscriptionExpired(subscriptionId, sub.subscriber);
                }
            }
        }
    }

    /**
     * @dev Chainlink Automation checkUpkeep function (optional)
     */
    function checkUpkeep(bytes calldata /* checkData */) 
        external 
        view 
        returns (bool upkeepNeeded, bytes memory performData) 
    {
        if (!automationEnabled) {
            return (false, "");
        }
        
        uint256[] memory dueSubscriptions = new uint256[](maxBatchSize);
        uint256 count = 0;
        
        for (uint256 i = 0; i < nextSubscriptionId && count < maxBatchSize; i++) {
            Subscription storage sub = subscriptions[i];
            if (sub.status == SubscriptionStatus.Active && 
                block.timestamp >= sub.nextPaymentTime && 
                !_isExpired(sub)) {
                dueSubscriptions[count] = i;
                count++;
            }
        }
        
        if (count > 0) {
            // Resize array to actual count
            uint256[] memory result = new uint256[](count);
            for (uint256 i = 0; i < count; i++) {
                result[i] = dueSubscriptions[i];
            }
            upkeepNeeded = true;
            performData = abi.encode(result);
        }
    }

    /**
     * @dev Chainlink Automation performUpkeep function (optional)
     */
    function performUpkeep(bytes calldata performData) external {
        require(automationEnabled, "Automation not enabled");
        uint256[] memory subscriptionIds = abi.decode(performData, (uint256[]));
        this.batchPullPayments(subscriptionIds);
    }

    /**
     * @dev Get subscription details
     */
    function getSubscription(uint256 subscriptionId) 
        external 
        view 
        validSubscription(subscriptionId) 
        returns (Subscription memory) 
    {
        return subscriptions[subscriptionId];
    }

    /**
     * @dev Get user's subscription IDs
     */
    function getUserSubscriptions(address user) external view returns (uint256[] memory) {
        return userSubscriptions[user];
    }

    /**
     * @dev Get recipient's subscription IDs
     */
    function getRecipientSubscriptions(address recipient) external view returns (uint256[] memory) {
        return recipientSubscriptions[recipient];
    }

    /**
     * @dev Check if subscription is expired
     */
    function _isExpired(Subscription storage sub) internal view returns (bool) {
        if (sub.expirationDate > 0 && block.timestamp >= sub.expirationDate) {
            return true;
        }
        if (sub.maxPayments > 0 && sub.paymentCount >= sub.maxPayments) {
            return true;
        }
        return false;
    }

    /**
     * @dev Set maximum batch size (only owner)
     */
    function setMaxBatchSize(uint256 _maxBatchSize) external onlyOwner {
        require(_maxBatchSize > 0, "Batch size must be greater than 0");
        maxBatchSize = _maxBatchSize;
    }

    /**
     * @dev Emergency function to update subscription status (only owner)
     */
    function emergencyUpdateStatus(uint256 subscriptionId, SubscriptionStatus newStatus) 
        external 
        onlyOwner 
        validSubscription(subscriptionId) 
    {
        subscriptions[subscriptionId].status = newStatus;
    }
    
    /**
     * @dev Enable/disable Chainlink Automation (only owner)
     */
    function setAutomationEnabled(bool _enabled) external onlyOwner {
        automationEnabled = _enabled;
    }
    
    /**
     * @dev Transfer ownership (only owner)
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is the zero address");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }
    
    /**
     * @dev Get current owner
     */
    function owner() external view returns (address) {
        return _owner;
    }
    
    /**
     * @dev Renounce ownership (only owner)
     */
    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(_owner, address(0));
        _owner = address(0);
    }
    
    /**
     * @dev Safe ERC20 transfer implementation
     */
    function _safeTransfer(address token, address to, uint256 amount) internal returns (bool) {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        return success && (data.length == 0 || abi.decode(data, (bool)));
    }
    
    /**
     * @dev Safe ERC20 transferFrom implementation
     */
    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal returns (bool) {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        return success && (data.length == 0 || abi.decode(data, (bool)));
    }
    
    /**
     * @dev Get ERC20 token balance
     */
    function getTokenBalance(address token, address account) external view returns (uint256) {
        return IERC20(token).balanceOf(account);
    }
    
    /**
     * @dev Get ERC20 token allowance
     */
    function getTokenAllowance(address token, address tokenOwner, address spender) external view returns (uint256) {
        return IERC20(token).allowance(tokenOwner, spender);
    }
}
