# crowdfunding--vedangdate

- domain: crowdfunding (crowdfunding)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/vedangdate/chainfund @ 44c0599b9a001ad0dfe8010c526b314113650ea1
- license: MIT
- targets: Crowdfunding.sol
- validation: 17 passing tests, 0 failing; statement coverage Crowdfunding.sol 100.0 %

## Contract: Crowdfunding.sol (primary target)

```solidity
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
```

## Tests: Crowdfunding.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const DAY = 24 * 60 * 60;

describe("Crowdfunding", function () {
  let cf, creator, alice, bob;

  beforeEach(async function () {
    [creator, alice, bob] = await ethers.getSigners();
    const F = await ethers.getContractFactory("Crowdfunding");
    cf = await F.connect(creator).deploy();
    await cf.waitForDeployment();
  });

  async function newCampaign(goalEth = "1", durSec = 7 * DAY) {
    const tx = await cf.createCampaign(
      ethers.parseEther(goalEth),
      durSec,
      "Test campaign",
      "A description"
    );
    await tx.wait();
    return await cf.campaignCount();
  }

  describe("createCampaign", function () {
    it("creates a campaign and emits an event", async function () {
      await expect(cf.createCampaign(ethers.parseEther("1"), 7 * DAY, "T", "D"))
        .to.emit(cf, "CampaignCreated")
        .withArgs(1, creator.address, ethers.parseEther("1"), anyValue, "T");
      const c = await cf.getCampaign(1);
      expect(c.creator).to.equal(creator.address);
      expect(c.goal).to.equal(ethers.parseEther("1"));
      expect(c.pledged).to.equal(0);
    });

    it("rejects a zero goal", async function () {
      await expect(
        cf.createCampaign(0, 7 * DAY, "T", "D")
      ).to.be.revertedWithCustomError(cf, "ZeroGoal");
    });

    it("rejects out-of-range durations", async function () {
      await expect(
        cf.createCampaign(ethers.parseEther("1"), 60, "T", "D")
      ).to.be.revertedWithCustomError(cf, "BadDuration");
      await expect(
        cf.createCampaign(ethers.parseEther("1"), 91 * DAY, "T", "D")
      ).to.be.revertedWithCustomError(cf, "BadDuration");
    });
  });

  describe("pledge / unpledge", function () {
    it("accepts pledges and tracks per-backer balances", async function () {
      const id = await newCampaign();
      await expect(cf.connect(alice).pledge(id, { value: ethers.parseEther("0.3") }))
        .to.emit(cf, "Pledged")
        .withArgs(id, alice.address, ethers.parseEther("0.3"), ethers.parseEther("0.3"));
      await cf.connect(bob).pledge(id, { value: ethers.parseEther("0.2") });
      const c = await cf.getCampaign(id);
      expect(c.pledged).to.equal(ethers.parseEther("0.5"));
      expect(await cf.pledgeOf(id, alice.address)).to.equal(ethers.parseEther("0.3"));
    });

    it("rejects a zero-value pledge", async function () {
      const id = await newCampaign();
      await expect(
        cf.connect(alice).pledge(id, { value: 0 })
      ).to.be.revertedWithCustomError(cf, "ZeroPledge");
    });

    it("rejects pledging to a missing campaign", async function () {
      await expect(
        cf.connect(alice).pledge(999, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(cf, "CampaignMissing");
    });

    it("lets a backer withdraw while live, then blocks over-withdraw", async function () {
      const id = await newCampaign();
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("0.5") });
      await expect(
        cf.connect(alice).unpledge(id, ethers.parseEther("0.2"))
      ).to.emit(cf, "Unpledged");
      expect(await cf.pledgeOf(id, alice.address)).to.equal(ethers.parseEther("0.3"));
      await expect(
        cf.connect(alice).unpledge(id, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(cf, "NothingPledged");
    });

    it("blocks pledging after the deadline", async function () {
      const id = await newCampaign("1", 1 * DAY);
      await time.increase(1 * DAY + 1);
      await expect(
        cf.connect(alice).pledge(id, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(cf, "CampaignEnded");
    });
  });

  describe("claim (success path)", function () {
    it("pays the creator when the goal is met and time is up", async function () {
      const id = await newCampaign("1", 2 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("0.6") });
      await cf.connect(bob).pledge(id, { value: ethers.parseEther("0.5") });
      await time.increase(2 * DAY + 1);

      await expect(cf.connect(creator).claim(id)).to.changeEtherBalance(
        creator,
        ethers.parseEther("1.1")
      );
      const c = await cf.getCampaign(id);
      expect(c.claimed).to.equal(true);
    });

    it("blocks claim before the deadline", async function () {
      const id = await newCampaign("1", 2 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1.5") });
      await expect(
        cf.connect(creator).claim(id)
      ).to.be.revertedWithCustomError(cf, "CampaignLive");
    });

    it("blocks claim if the goal was not met", async function () {
      const id = await newCampaign("1", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("0.4") });
      await time.increase(1 * DAY + 1);
      await expect(
        cf.connect(creator).claim(id)
      ).to.be.revertedWithCustomError(cf, "GoalNotMet");
    });

    it("blocks a non-creator from claiming", async function () {
      const id = await newCampaign("1", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("2") });
      await time.increase(1 * DAY + 1);
      await expect(
        cf.connect(alice).claim(id)
      ).to.be.revertedWithCustomError(cf, "NotCreator");
    });

    it("blocks a double claim", async function () {
      const id = await newCampaign("1", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1.2") });
      await time.increase(1 * DAY + 1);
      await cf.connect(creator).claim(id);
      await expect(
        cf.connect(creator).claim(id)
      ).to.be.revertedWithCustomError(cf, "AlreadyClaimed");
    });
  });

  describe("refund (failure path)", function () {
    it("lets backers pull refunds when the goal is missed", async function () {
      const id = await newCampaign("5", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1") });
      await time.increase(1 * DAY + 1);
      await expect(cf.connect(alice).refund(id)).to.changeEtherBalance(
        alice,
        ethers.parseEther("1")
      );
      expect(await cf.pledgeOf(id, alice.address)).to.equal(0);
    });

    it("blocks refund when the goal was met", async function () {
      const id = await newCampaign("1", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1.5") });
      await time.increase(1 * DAY + 1);
      await expect(
        cf.connect(alice).refund(id)
      ).to.be.revertedWithCustomError(cf, "GoalWasMet");
    });

    it("blocks a double refund", async function () {
      const id = await newCampaign("5", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1") });
      await time.increase(1 * DAY + 1);
      await cf.connect(alice).refund(id);
      await expect(
        cf.connect(alice).refund(id)
      ).to.be.revertedWithCustomError(cf, "NothingPledged");
    });
  });

  describe("statusOf", function () {
    it("reports live / succeeded / failed", async function () {
      const id = await newCampaign("1", 1 * DAY);
      expect(await cf.statusOf(id)).to.equal(0); // live
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1") });
      await time.increase(1 * DAY + 1);
      expect(await cf.statusOf(id)).to.equal(1); // succeeded

      const id2 = await newCampaign("5", 1 * DAY);
      await cf.connect(alice).pledge(id2, { value: ethers.parseEther("1") });
      await time.increase(1 * DAY + 1);
      expect(await cf.statusOf(id2)).to.equal(2); // failed
    });
  });
});
```
