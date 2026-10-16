// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ChainFund — minimal, secure on-chain crowdfunding
/// @notice Anyone can launch a campaign with a funding goal and deadline.
///         Backers pledge ETH. If the goal is met by the deadline the creator
///         can withdraw. If it fails, backers pull their own refunds.
/// @dev    Uses the checks-effects-interactions pattern and a non-reentrant
///         guard on every ETH-moving path. No owner, no admin keys, no upgrade
///         proxy — the contract is the only custodian of pledged funds.
contract Crowdfunding {
    // ---------------------------------------------------------------- errors
    error ZeroGoal();
    error BadDuration();
    error CampaignMissing();
    error CampaignEnded();
    error CampaignLive();
    error NothingPledged();
    error NotCreator();
    error GoalNotMet();
    error GoalWasMet();
    error AlreadyClaimed();
    error TransferFailed();
    error ZeroPledge();

    // ----------------------------------------------------------------- types
    struct Campaign {
        address creator;
        uint128 goal;        // wei target
        uint128 pledged;     // wei raised so far
        uint64  deadline;    // unix seconds
        bool    claimed;     // creator withdrew (success path)
        string  title;
        string  description;
    }

    // --------------------------------------------------------------- storage
    uint256 public campaignCount;
    mapping(uint256 => Campaign) public campaigns;
    /// @notice campaignId => backer => amount pledged (wei)
    mapping(uint256 => mapping(address => uint256)) public pledgeOf;

    // reentrancy guard
    uint256 private _lock = 1;
    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    // ---------------------------------------------------------------- events
    event CampaignCreated(
        uint256 indexed id, address indexed creator, uint128 goal, uint64 deadline, string title
    );
    event Pledged(uint256 indexed id, address indexed backer, uint256 amount, uint128 totalPledged);
    event Unpledged(uint256 indexed id, address indexed backer, uint256 amount, uint128 totalPledged);
    event Claimed(uint256 indexed id, address indexed creator, uint256 amount);
    event Refunded(uint256 indexed id, address indexed backer, uint256 amount);

    // ----------------------------------------------------------- create
    /// @param goal       funding target in wei (must be > 0)
    /// @param duration   seconds from now until the deadline (1h..90d)
    function createCampaign(
        uint128 goal,
        uint64 duration,
        string calldata title,
        string calldata description
    ) external returns (uint256 id) {
        if (goal == 0) revert ZeroGoal();
        if (duration < 1 hours || duration > 90 days) revert BadDuration();

        id = ++campaignCount;
        uint64 deadline = uint64(block.timestamp) + duration;
        campaigns[id] = Campaign({
            creator: msg.sender,
            goal: goal,
            pledged: 0,
            deadline: deadline,
            claimed: false,
            title: title,
            description: description
        });
        emit CampaignCreated(id, msg.sender, goal, deadline, title);
    }

    // ----------------------------------------------------------- pledge
    function pledge(uint256 id) external payable nonReentrant {
        Campaign storage c = campaigns[id];
        if (c.creator == address(0)) revert CampaignMissing();
        if (block.timestamp >= c.deadline) revert CampaignEnded();
        if (msg.value == 0) revert ZeroPledge();

        c.pledged += uint128(msg.value);
        pledgeOf[id][msg.sender] += msg.value;
        emit Pledged(id, msg.sender, msg.value, c.pledged);
    }

    /// @notice Withdraw your pledge while the campaign is still live.
    function unpledge(uint256 id, uint256 amount) external nonReentrant {
        Campaign storage c = campaigns[id];
        if (c.creator == address(0)) revert CampaignMissing();
        if (block.timestamp >= c.deadline) revert CampaignEnded();
        uint256 bal = pledgeOf[id][msg.sender];
        if (amount == 0 || amount > bal) revert NothingPledged();

        // effects
        pledgeOf[id][msg.sender] = bal - amount;
        c.pledged -= uint128(amount);
        // interaction
        _send(msg.sender, amount);
        emit Unpledged(id, msg.sender, amount, c.pledged);
    }

    // ----------------------------------------------------------- settle
    /// @notice Creator withdraws funds once the goal is met and time is up.
    function claim(uint256 id) external nonReentrant {
        Campaign storage c = campaigns[id];
        if (c.creator == address(0)) revert CampaignMissing();
        if (msg.sender != c.creator) revert NotCreator();
        if (block.timestamp < c.deadline) revert CampaignLive();
        if (c.pledged < c.goal) revert GoalNotMet();
        if (c.claimed) revert AlreadyClaimed();

        c.claimed = true;
        uint256 amount = c.pledged;
        _send(c.creator, amount);
        emit Claimed(id, c.creator, amount);
    }

    /// @notice Backer pulls their refund after a failed campaign.
    function refund(uint256 id) external nonReentrant {
        Campaign storage c = campaigns[id];
        if (c.creator == address(0)) revert CampaignMissing();
        if (block.timestamp < c.deadline) revert CampaignLive();
        if (c.pledged >= c.goal) revert GoalWasMet();
        uint256 bal = pledgeOf[id][msg.sender];
        if (bal == 0) revert NothingPledged();

        pledgeOf[id][msg.sender] = 0;
        _send(msg.sender, bal);
        emit Refunded(id, msg.sender, bal);
    }

    // ----------------------------------------------------------- views
    function getCampaign(uint256 id) external view returns (Campaign memory) {
        if (campaigns[id].creator == address(0)) revert CampaignMissing();
        return campaigns[id];
    }

    /// @notice Cheap status helper for UIs: 0=live, 1=succeeded, 2=failed.
    function statusOf(uint256 id) external view returns (uint8) {
        Campaign storage c = campaigns[id];
        if (c.creator == address(0)) revert CampaignMissing();
        if (block.timestamp < c.deadline) return 0;
        return c.pledged >= c.goal ? 1 : 2;
    }

    // ----------------------------------------------------------- internal
    function _send(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
