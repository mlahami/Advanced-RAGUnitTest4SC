# subscription-payment-system--aryasingh22

- domain: subscriptions-streaming (subscriptions)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/AryaSingh22/SubZero-Protocol @ 6899b1607574abfb9222837f79a08ea9868851ce
- license: MIT
- targets: SubscriptionPaymentSystem.sol
- validation: 16 passing tests, 0 failing; statement coverage SubscriptionPaymentSystem.sol 80.77 %

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockERC20
 * @dev Raw Mock ERC20 token implementation for testing purposes (No External Libraries)
 */
contract MockERC20 {
    // Token metadata
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    
    // Balances and allowances
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    // Events
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply
    ) {
        name = _name;
        symbol = _symbol;
        decimals = 18;
        totalSupply = _initialSupply * 10**decimals;
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }
    
    /**
     * @dev Transfer tokens to a specified address
     */
    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "Transfer to zero address");
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    /**
     * @dev Approve spender to spend tokens on behalf of owner
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        require(spender != address(0), "Approve to zero address");
        
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    /**
     * @dev Transfer tokens from one address to another using allowance
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(from != address(0), "Transfer from zero address");
        require(to != address(0), "Transfer to zero address");
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        
        emit Transfer(from, to, amount);
        return true;
    }
    
    /**
     * @dev Mint tokens to any address (for testing)
     */
    function mint(address to, uint256 amount) external {
        require(to != address(0), "Mint to zero address");
        
        totalSupply += amount;
        balanceOf[to] += amount;
        
        emit Transfer(address(0), to, amount);
    }
    
    /**
     * @dev Burn tokens from any address (for testing)
     */
    function burn(address from, uint256 amount) external {
        require(from != address(0), "Burn from zero address");
        require(balanceOf[from] >= amount, "Insufficient balance to burn");
        
        balanceOf[from] -= amount;
        totalSupply -= amount;
        
        emit Transfer(from, address(0), amount);
    }
    
    /**
     * @dev Increase allowance for spender
     */
    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        require(spender != address(0), "Approve to zero address");
        
        allowance[msg.sender][spender] += addedValue;
        emit Approval(msg.sender, spender, allowance[msg.sender][spender]);
        return true;
    }
    
    /**
     * @dev Decrease allowance for spender
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        require(spender != address(0), "Approve to zero address");
        require(allowance[msg.sender][spender] >= subtractedValue, "Decreased allowance below zero");
        
        allowance[msg.sender][spender] -= subtractedValue;
        emit Approval(msg.sender, spender, allowance[msg.sender][spender]);
        return true;
    }
}
```

## Contract: SubscriptionPaymentSystem.sol (primary target)

```solidity
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
```

## Tests: SubscriptionPaymentSystem.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SubscriptionPaymentSystem", function () {
    let subscriptionSystem;
    let mockToken;
    let owner, subscriber, recipient, other;
    
    const INITIAL_SUPPLY = ethers.parseEther("1000000");
    const PAYMENT_AMOUNT = ethers.parseEther("100");
    const PAYMENT_INTERVAL = 86400; // 1 day in seconds

    beforeEach(async function () {
        [owner, subscriber, recipient, other] = await ethers.getSigners();

        // Deploy MockERC20
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = await MockERC20.deploy("Test Token", "TEST", 1000000);
        await mockToken.waitForDeployment();

        // Deploy SubscriptionPaymentSystem
        const SubscriptionPaymentSystem = await ethers.getContractFactory("SubscriptionPaymentSystem");
        subscriptionSystem = await SubscriptionPaymentSystem.deploy();
        await subscriptionSystem.waitForDeployment();

        // Mint tokens to subscriber
        await mockToken.mint(subscriber.address, INITIAL_SUPPLY);
    });

    describe("Subscription Creation", function () {
        it("Should create a subscription successfully", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);

            const tx = await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address,
                mockToken.target,
                PAYMENT_AMOUNT,
                PAYMENT_INTERVAL,
                0, // unlimited payments
                0  // no expiration
            );

            await expect(tx)
                .to.emit(subscriptionSystem, "SubscriptionCreated")
                .withArgs(0, subscriber.address, recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL);

            const subscription = await subscriptionSystem.getSubscription(0);
            expect(subscription.subscriber).to.equal(subscriber.address);
            expect(subscription.recipient).to.equal(recipient.address);
            expect(subscription.amount).to.equal(PAYMENT_AMOUNT);
            expect(subscription.status).to.equal(0); // Active
        });

        it("Should revert with invalid parameters", async function () {
            await expect(
                subscriptionSystem.connect(subscriber).createSubscription(
                    ethers.ZeroAddress,
                    mockToken.target,
                    PAYMENT_AMOUNT,
                    PAYMENT_INTERVAL,
                    0,
                    0
                )
            ).to.be.revertedWith("Invalid recipient");

            await expect(
                subscriptionSystem.connect(subscriber).createSubscription(
                    recipient.address,
                    ethers.ZeroAddress,
                    PAYMENT_AMOUNT,
                    PAYMENT_INTERVAL,
                    0,
                    0
                )
            ).to.be.revertedWith("Invalid token");

            await expect(
                subscriptionSystem.connect(subscriber).createSubscription(
                    recipient.address,
                    mockToken.target,
                    0,
                    PAYMENT_INTERVAL,
                    0,
                    0
                )
            ).to.be.revertedWith("Amount must be greater than 0");
        });
    });

    describe("Payment Pulling", function () {
        let subscriptionId;

        beforeEach(async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            const tx = await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address,
                mockToken.target,
                PAYMENT_AMOUNT,
                PAYMENT_INTERVAL,
                0,
                0
            );
            
            const receipt = await tx.wait();
            subscriptionId = 0; // First subscription
        });

        it("Should pull payment when due", async function () {
            // Fast forward time to make payment due
            await time.increase(PAYMENT_INTERVAL);

            const recipientBalanceBefore = await mockToken.balanceOf(recipient.address);
            const subscriberBalanceBefore = await mockToken.balanceOf(subscriber.address);

            await expect(subscriptionSystem.pullPayment(subscriptionId))
                .to.emit(subscriptionSystem, "PaymentPulled")
                .withArgs(subscriptionId, subscriber.address, recipient.address, PAYMENT_AMOUNT, 1);

            const recipientBalanceAfter = await mockToken.balanceOf(recipient.address);
            const subscriberBalanceAfter = await mockToken.balanceOf(subscriber.address);

            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(PAYMENT_AMOUNT);
            expect(subscriberBalanceBefore - subscriberBalanceAfter).to.equal(PAYMENT_AMOUNT);
        });

        it("Should revert if payment not due yet", async function () {
            await expect(subscriptionSystem.pullPayment(subscriptionId))
                .to.be.revertedWith("Payment not due yet");
        });

        it("Should handle insufficient allowance gracefully", async function () {
            // Reset allowance to 0
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, 0);
            
            // Fast forward time
            await time.increase(PAYMENT_INTERVAL);

            await expect(subscriptionSystem.pullPayment(subscriptionId))
                .to.be.revertedWith("Token transfer failed");
        });
    });

    describe("Subscription Management", function () {
        let subscriptionId;

        beforeEach(async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address,
                mockToken.target,
                PAYMENT_AMOUNT,
                PAYMENT_INTERVAL,
                0,
                0
            );
            
            subscriptionId = 0;
        });

        it("Should pause subscription", async function () {
            await expect(subscriptionSystem.connect(subscriber).pauseSubscription(subscriptionId))
                .to.emit(subscriptionSystem, "SubscriptionPaused")
                .withArgs(subscriptionId, subscriber.address);

            const subscription = await subscriptionSystem.getSubscription(subscriptionId);
            expect(subscription.status).to.equal(1); // Paused
        });

        it("Should resume subscription", async function () {
            await subscriptionSystem.connect(subscriber).pauseSubscription(subscriptionId);
            
            await expect(subscriptionSystem.connect(subscriber).resumeSubscription(subscriptionId))
                .to.emit(subscriptionSystem, "SubscriptionResumed")
                .withArgs(subscriptionId, subscriber.address);

            const subscription = await subscriptionSystem.getSubscription(subscriptionId);
            expect(subscription.status).to.equal(0); // Active
        });

        it("Should cancel subscription", async function () {
            await expect(subscriptionSystem.connect(subscriber).cancelSubscription(subscriptionId))
                .to.emit(subscriptionSystem, "SubscriptionCancelled")
                .withArgs(subscriptionId, subscriber.address);

            const subscription = await subscriptionSystem.getSubscription(subscriptionId);
            expect(subscription.status).to.equal(2); // Cancelled
        });

        it("Should only allow subscriber to manage subscription", async function () {
            await expect(
                subscriptionSystem.connect(other).pauseSubscription(subscriptionId)
            ).to.be.revertedWith("Not the subscriber");

            await expect(
                subscriptionSystem.connect(recipient).cancelSubscription(subscriptionId)
            ).to.be.revertedWith("Not the subscriber");
        });
    });

    describe("Subscription Expiration", function () {
        it("Should expire subscription after max payments", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            // Create subscription with max 2 payments
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address,
                mockToken.target,
                PAYMENT_AMOUNT,
                PAYMENT_INTERVAL,
                2, // max payments
                0  // no time expiration
            );

            const subscriptionId = 0;

            // First payment
            await time.increase(PAYMENT_INTERVAL);
            await subscriptionSystem.pullPayment(subscriptionId);

            // Second payment - should expire after this
            await time.increase(PAYMENT_INTERVAL);
            await expect(subscriptionSystem.pullPayment(subscriptionId))
                .to.emit(subscriptionSystem, "SubscriptionExpired")
                .withArgs(subscriptionId, subscriber.address);

            const subscription = await subscriptionSystem.getSubscription(subscriptionId);
            expect(subscription.status).to.equal(3); // Expired
        });

        it("Should expire subscription after expiration date", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            // Get current blockchain time and add future offset
            const currentTime = await time.latest();
            const expirationDate = currentTime + PAYMENT_INTERVAL * 2;
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address,
                mockToken.target,
                PAYMENT_AMOUNT,
                PAYMENT_INTERVAL,
                0, // unlimited payments
                expirationDate
            );

            const subscriptionId = 0;

            // Fast forward past expiration
            await time.increaseTo(expirationDate + 1);
            
            await expect(subscriptionSystem.pullPayment(subscriptionId))
                .to.emit(subscriptionSystem, "SubscriptionExpired")
                .withArgs(subscriptionId, subscriber.address);
        });
    });

    describe("Batch Operations", function () {
        it("Should batch pull multiple payments", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            // Create multiple subscriptions
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );

            // Fast forward time
            await time.increase(PAYMENT_INTERVAL);

            const recipientBalanceBefore = await mockToken.balanceOf(recipient.address);
            
            await subscriptionSystem.batchPullPayments([0, 1]);
            
            const recipientBalanceAfter = await mockToken.balanceOf(recipient.address);
            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(PAYMENT_AMOUNT * 2n);
        });
    });

    describe("Chainlink Keeper Integration", function () {
        beforeEach(async function () {
            // Enable automation for Chainlink Keeper tests
            await subscriptionSystem.setAutomationEnabled(true);
        });

        it("Should return correct upkeep data", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );

            // Before payment is due
            let [upkeepNeeded] = await subscriptionSystem.checkUpkeep("0x");
            expect(upkeepNeeded).to.be.false;

            // After payment is due
            await time.increase(PAYMENT_INTERVAL);
            [upkeepNeeded] = await subscriptionSystem.checkUpkeep("0x");
            expect(upkeepNeeded).to.be.true;
        });

        it("Should perform upkeep correctly", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );

            await time.increase(PAYMENT_INTERVAL);
            
            const [, performData] = await subscriptionSystem.checkUpkeep("0x");
            
            const recipientBalanceBefore = await mockToken.balanceOf(recipient.address);
            await subscriptionSystem.performUpkeep(performData);
            const recipientBalanceAfter = await mockToken.balanceOf(recipient.address);
            
            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(PAYMENT_AMOUNT);
        });
    });

    describe("View Functions", function () {
        it("Should return user subscriptions", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );

            const userSubs = await subscriptionSystem.getUserSubscriptions(subscriber.address);
            expect(userSubs.length).to.equal(2);
            expect(userSubs[0]).to.equal(0);
            expect(userSubs[1]).to.equal(1);
        });

        it("Should return recipient subscriptions", async function () {
            await mockToken.connect(subscriber).approve(subscriptionSystem.target, PAYMENT_AMOUNT * 10n);
            
            await subscriptionSystem.connect(subscriber).createSubscription(
                recipient.address, mockToken.target, PAYMENT_AMOUNT, PAYMENT_INTERVAL, 0, 0
            );

            const recipientSubs = await subscriptionSystem.getRecipientSubscriptions(recipient.address);
            expect(recipientSubs.length).to.equal(1);
            expect(recipientSubs[0]).to.equal(0);
        });
    });
});
```
