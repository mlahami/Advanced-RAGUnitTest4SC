// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Pull {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @title SubscriptionService
 * @notice ERC20-based recurring subscription. Subscribers pre-approve
 *         this contract and anyone can trigger the charge after the
 *         billing interval passes. Ideal for testing keeper patterns.
 * Complexity: Moderate
 */
contract SubscriptionService {
    struct Plan {
        uint256 price;        // tokens per period
        uint256 period;       // seconds between charges
        bool    active;
    }

    struct Subscription {
        uint256 planId;
        uint256 nextDue;      // timestamp of next payment
        bool    active;
    }

    IERC20Pull public immutable token;
    address    public          treasury;
    address    public          owner;

    Plan[]     public plans;
    mapping(address => Subscription) public subscriptions;

    event PlanCreated(uint256 indexed planId, uint256 price, uint256 period);
    event PlanDeactivated(uint256 indexed planId);
    event Subscribed(address indexed subscriber, uint256 indexed planId);
    event Charged(address indexed subscriber, uint256 indexed planId, uint256 amount);
    event Cancelled(address indexed subscriber);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    constructor(address _token, address _treasury) {
        token    = IERC20Pull(_token);
        treasury = _treasury;
        owner    = msg.sender;
    }

    // â”€â”€â”€ Owner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function createPlan(uint256 price, uint256 period) external onlyOwner returns (uint256 planId) {
        require(price > 0 && period > 0, "Invalid plan");
        plans.push(Plan(price, period, true));
        planId = plans.length - 1;
        emit PlanCreated(planId, price, period);
    }

    function deactivatePlan(uint256 planId) external onlyOwner {
        plans[planId].active = false;
        emit PlanDeactivated(planId);
    }

    // â”€â”€â”€ Subscriber â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function subscribe(uint256 planId) external {
        require(planId < plans.length && plans[planId].active, "Invalid plan");
        require(!subscriptions[msg.sender].active, "Already subscribed");

        Plan storage p = plans[planId];
        // Charge immediately on subscribe
        require(token.transferFrom(msg.sender, treasury, p.price), "Payment failed");

        subscriptions[msg.sender] = Subscription({
            planId:  planId,
            nextDue: block.timestamp + p.period,
            active:  true
        });
        emit Subscribed(msg.sender, planId);
        emit Charged(msg.sender, planId, p.price);
    }

    function cancel() external {
        require(subscriptions[msg.sender].active, "Not subscribed");
        subscriptions[msg.sender].active = false;
        emit Cancelled(msg.sender);
    }

    // â”€â”€â”€ Charge (callable by anyone â€” keeper pattern) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function charge(address subscriber) external {
        Subscription storage s = subscriptions[subscriber];
        require(s.active, "Not subscribed");
        require(block.timestamp >= s.nextDue, "Not due yet");

        Plan storage p = plans[s.planId];
        // If transfer fails (insufficient allowance/balance) cancel subscription
        bool success = _tryTransfer(subscriber, p.price);
        if (!success) {
            s.active = false;
            emit Cancelled(subscriber);
            return;
        }
        s.nextDue += p.period;
        emit Charged(subscriber, s.planId, p.price);
    }

    function isActive(address subscriber) external view returns (bool) {
        return subscriptions[subscriber].active;
    }

    function planCount() external view returns (uint256) { return plans.length; }

    // â”€â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function _tryTransfer(address from, uint256 amount) internal returns (bool) {
        if (token.allowance(from, address(this)) < amount) return false;
        try token.transferFrom(from, treasury, amount) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }
}

