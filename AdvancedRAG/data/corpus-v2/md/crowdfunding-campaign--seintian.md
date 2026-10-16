# crowdfunding-campaign--seintian

- domain: crowdfunding (crowdfunding)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Seintian/unito-blockchain-25-26-crowdfunding-protocol @ f6c09d330b7a71ce34dc23cb7b85cecf89bc4ec6
- license: MIT
- targets: CrowdfundingCampaign.sol, CrowdfundingFactory.sol, MaliciousReentrantToken.sol, MockERC20.sol, MockFeeToken.sol, ICrowdfundingCampaign.sol, ICrowdfundingFactory.sol
- validation: 52 passing tests, 0 failing; statement coverage CrowdfundingCampaign.sol 100.0 %, CrowdfundingFactory.sol 100.0 %, MaliciousReentrantToken.sol 100.0 %, MockERC20.sol 100.0 %, MockFeeToken.sol 100.0 %, ICrowdfundingCampaign.sol 100.0 %, ICrowdfundingFactory.sol 100.0 %

## Contract: CrowdfundingCampaign.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICrowdfundingCampaign} from "./ICrowdfundingCampaign.sol";

/**
 * @title CrowdfundingCampaign
 * @notice Production-grade, autonomous All-or-Nothing escrow smart contract.
 * @dev Implements strict state machine transitions, CEI, SafeERC20, and ReentrancyGuard.
 */
contract CrowdfundingCampaign is ICrowdfundingCampaign, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Precision scalar for reward rate calculations (1e18)
    uint256 public constant RATE_PRECISION = 1e18;

    /// @notice The ERC-20 token accepted for funding pledges
    IERC20 public immutable override fundingToken;

    /// @notice The ERC-20 token distributed to backers as rewards
    IERC20 public immutable override rewardToken;

    /// @notice Address of the project creator / proposer
    address public immutable override creator;

    /// @notice Funding target in fundingToken base units
    uint256 public immutable override threshold;

    /// @notice Reward exchange rate scaled by RATE_PRECISION
    uint256 public immutable override rewardRate;

    /// @notice Unix timestamp after which pledges close
    uint256 public immutable override deadline;

    /// @notice Required reward collateral deposited by creator at launch
    uint256 public immutable override rewardCollateral;

    /// @notice Aggregate amount of funding tokens currently pledged
    uint256 public override totalRaised;

    /// @notice Aggregate amount of reward tokens claimed by backers
    uint256 public override totalRewardsClaimed;

    /// @notice Whether the creator has withdrawn the raised funds upon success
    bool public override creatorFundsClaimed;

    /// @notice Whether the creator has recovered their reward collateral upon expiration
    bool public override creatorCollateralRecovered;

    /// @notice Ledger tracking individual backer contributions
    mapping(address => uint256) public override contributions;

    /// @notice Tracks whether a backer has claimed their rewards
    mapping(address => bool) public override rewardsClaimed;

    /// @notice Tracks whether a backer has claimed their refund
    mapping(address => bool) public override refundsClaimed;

    /**
     * @notice Deploys an autonomous CrowdfundingCampaign instance.
     * @param _creator Address of the campaign creator
     * @param _fundingToken ERC-20 token address used for funding
     * @param _rewardToken ERC-20 token address used for rewards
     * @param _threshold Target funding amount in fundingToken units
     * @param _rewardRate Reward token multiplier scaled by 1e18
     * @param _deadline Unix timestamp representing the campaign deadline
     */
    constructor(
        address _creator,
        address _fundingToken,
        address _rewardToken,
        uint256 _threshold,
        uint256 _rewardRate,
        uint256 _deadline
    ) {
        if (_creator == address(0) || _fundingToken == address(0) || _rewardToken == address(0)) {
            revert InvalidConfiguration();
        }
        if (_threshold == 0 || _rewardRate == 0) {
            revert InvalidConfiguration();
        }
        if (_deadline <= block.timestamp) {
            revert DeadlinePassed();
        }

        creator = _creator;
        fundingToken = IERC20(_fundingToken);
        rewardToken = IERC20(_rewardToken);
        threshold = _threshold;
        rewardRate = _rewardRate;
        deadline = _deadline;

        // Calculate exact 100% upfront collateral requirement
        rewardCollateral = (_threshold * _rewardRate) / RATE_PRECISION;
        if (rewardCollateral == 0) {
            revert InvalidConfiguration();
        }
    }

    /**
     * @notice Computes the current lifecycle state of the campaign.
     * @return Current State: Active, Successful, or Expired
     */
    function state() public view override returns (State) {
        if (totalRaised >= threshold) {
            return State.Successful;
        }
        if (block.timestamp >= deadline) {
            return State.Expired;
        }
        return State.Active;
    }

    /**
     * @notice Pledges funding tokens to the active campaign.
     * @dev Enforces All-or-Nothing invariants, checks cap, and follows CEI.
     * @param amount The quantity of funding tokens to contribute
     */
    function pledge(uint256 amount) external override nonReentrant {
        if (state() != State.Active) {
            revert CampaignNotActive();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        // Measure actual balance delta received to protect against fee-on-transfer tokens
        uint256 balanceBefore = fundingToken.balanceOf(address(this));
        fundingToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actualReceived = fundingToken.balanceOf(address(this)) - balanceBefore;

        if (actualReceived == 0) {
            revert ZeroAmount();
        }
        if (totalRaised + actualReceived > threshold) {
            revert ThresholdExceeded();
        }

        // Checks & Effects
        contributions[msg.sender] += actualReceived;
        totalRaised += actualReceived;

        emit Pledged(msg.sender, actualReceived, totalRaised);
    }

    /**
     * @notice Allows backers to withdraw their contributed funds before threshold is reached.
     * @dev Flexible withdrawal invariant: active while totalRaised < threshold and before deadline.
     * @param amount The amount of funding tokens to withdraw
     */
    function withdrawBeforeThreshold(uint256 amount) external override nonReentrant {
        if (state() != State.Active) {
            revert CampaignNotActive();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (contributions[msg.sender] < amount) {
            revert InsufficientContribution();
        }

        // Checks & Effects
        contributions[msg.sender] -= amount;
        totalRaised -= amount;

        emit WithdrawnBeforeThreshold(msg.sender, amount, totalRaised);

        // Interaction
        fundingToken.safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Allows a backer to claim reward tokens if the campaign succeeded.
     * @dev Implements Pull-over-Push pattern to prevent gas limit DoS.
     */
    function claimReward() external override nonReentrant {
        if (state() != State.Successful) {
            revert CampaignNotSuccessful();
        }
        if (rewardsClaimed[msg.sender]) {
            revert RewardsAlreadyClaimed();
        }

        uint256 backerContribution = contributions[msg.sender];
        if (backerContribution == 0) {
            revert InsufficientContribution();
        }

        // Effects
        rewardsClaimed[msg.sender] = true;
        uint256 rewardAmount = calculateReward(backerContribution);
        totalRewardsClaimed += rewardAmount;

        emit RewardsClaimed(msg.sender, rewardAmount);

        // Interaction
        rewardToken.safeTransfer(msg.sender, rewardAmount);
    }

    /**
     * @notice Allows a backer to claim a 100% refund if the campaign expired without reaching threshold.
     * @dev Guarantees full principal recovery under All-or-Nothing mechanics.
     */
    function claimRefund() external override nonReentrant {
        if (state() != State.Expired) {
            revert CampaignNotExpired();
        }
        if (refundsClaimed[msg.sender]) {
            revert RefundsAlreadyClaimed();
        }

        uint256 backerContribution = contributions[msg.sender];
        if (backerContribution == 0) {
            revert InsufficientContribution();
        }

        // Effects
        refundsClaimed[msg.sender] = true;

        emit RefundClaimed(msg.sender, backerContribution);

        // Interaction
        fundingToken.safeTransfer(msg.sender, backerContribution);
    }

    /**
     * @notice Allows the creator to withdraw total funding tokens once the campaign succeeds.
     */
    function claimFunds() external override nonReentrant {
        if (msg.sender != creator) {
            revert Unauthorized();
        }
        if (state() != State.Successful) {
            revert CampaignNotSuccessful();
        }
        if (creatorFundsClaimed) {
            revert CreatorFundsAlreadyClaimed();
        }

        // Effects
        creatorFundsClaimed = true;
        uint256 fundsToClaim = totalRaised;

        emit CreatorFundsClaimed(creator, fundsToClaim);

        // Interaction
        fundingToken.safeTransfer(creator, fundsToClaim);
    }

    /**
     * @notice Allows the creator to recover their deposited reward collateral if the campaign expires.
     */
    function recoverCollateral() external override nonReentrant {
        if (msg.sender != creator) {
            revert Unauthorized();
        }
        if (state() != State.Expired) {
            revert CampaignNotExpired();
        }
        if (creatorCollateralRecovered) {
            revert CreatorCollateralAlreadyRefunded();
        }

        // Effects
        creatorCollateralRecovered = true;

        emit CreatorCollateralRecovered(creator, rewardCollateral);

        // Interaction
        rewardToken.safeTransfer(creator, rewardCollateral);
    }

    /**
     * @notice Allows the creator to recover unallocated reward tokens and rounding dust in a successful campaign.
     * @dev Calculates remaining maximum backer liability and sweeps only true surplus.
     */
    function recoverExcessRewards() external override nonReentrant {
        if (msg.sender != creator) {
            revert Unauthorized();
        }
        if (state() != State.Successful) {
            revert CampaignNotSuccessful();
        }

        uint256 remainingLiability = rewardCollateral - totalRewardsClaimed;
        uint256 currentBalance = rewardToken.balanceOf(address(this));

        if (currentBalance <= remainingLiability) {
            revert NoExcessRewards();
        }

        uint256 excessAmount = currentBalance - remainingLiability;

        emit ExcessRewardsRecovered(creator, excessAmount);

        rewardToken.safeTransfer(creator, excessAmount);
    }

    /**
     * @notice Pure mathematical calculation of reward tokens owed for a given contribution.
     * @param contributionAmount The amount of funding tokens contributed
     * @return The amount of reward tokens owed
     */
    function calculateReward(uint256 contributionAmount) public view override returns (uint256) {
        return (contributionAmount * rewardRate) / RATE_PRECISION;
    }

    /**
     * @notice Returns remaining funding tokens needed to meet the threshold.
     * @return 0 if threshold is met or exceeded, otherwise threshold - totalRaised
     */
    function remainingToThreshold() external view override returns (uint256) {
        if (totalRaised >= threshold) {
            return 0;
        }
        return threshold - totalRaised;
    }
}
```

## Contract: CrowdfundingFactory.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICrowdfundingFactory} from "./ICrowdfundingFactory.sol";
import {CrowdfundingCampaign} from "./CrowdfundingCampaign.sol";

/**
 * @title CrowdfundingFactory
 * @notice Factory registry and deployer for CrowdfundingCampaign contracts.
 * @dev Enforces 100% upfront collateralization before instantiating campaign escrows.
 */
contract CrowdfundingFactory is ICrowdfundingFactory {
    using SafeERC20 for IERC20;

    uint256 public constant RATE_PRECISION = 1e18;

    /// @notice Array of all deployed campaign contracts
    address[] public deployedCampaigns;

    /// @notice Mapping from creator address to array of created campaign addresses
    mapping(address => address[]) public creatorCampaigns;

    /**
     * @notice Creates and funds a new CrowdfundingCampaign instance.
     * @dev Transfers 100% of required reward collateral from msg.sender to the new campaign.
     * @param fundingToken The ERC-20 token address accepted for contributions
     * @param rewardToken The ERC-20 token address distributed as rewards
     * @param threshold Funding goal in fundingToken base units
     * @param rewardRate Reward tokens per funding token, scaled by 1e18
     * @param duration Campaign duration in seconds from current block timestamp
     * @return campaignAddress The address of the deployed CrowdfundingCampaign contract
     */
    function createCampaign(
        address fundingToken,
        address rewardToken,
        uint256 threshold,
        uint256 rewardRate,
        uint256 duration
    ) external override returns (address campaignAddress) {
        if (fundingToken == address(0) || rewardToken == address(0)) {
            revert InvalidTokenAddress();
        }
        if (threshold == 0) {
            revert InvalidThreshold();
        }
        if (rewardRate == 0) {
            revert InvalidRewardRate();
        }
        if (duration == 0) {
            revert InvalidDuration();
        }

        uint256 deadline = block.timestamp + duration;
        uint256 rewardCollateral = (threshold * rewardRate) / RATE_PRECISION;
        if (rewardCollateral == 0) {
            revert InvalidRewardRate();
        }

        // Deploy new isolated campaign instance
        CrowdfundingCampaign campaign = new CrowdfundingCampaign(
            msg.sender,
            fundingToken,
            rewardToken,
            threshold,
            rewardRate,
            deadline
        );

        campaignAddress = address(campaign);

        // Registry indexing
        deployedCampaigns.push(campaignAddress);
        creatorCampaigns[msg.sender].push(campaignAddress);

        emit CampaignCreated(
            campaignAddress,
            msg.sender,
            fundingToken,
            rewardToken,
            threshold,
            rewardRate,
            deadline,
            rewardCollateral
        );

        // Secure upfront escrow collateral from creator
        uint256 balanceBefore = IERC20(rewardToken).balanceOf(campaignAddress);
        IERC20(rewardToken).safeTransferFrom(msg.sender, campaignAddress, rewardCollateral);
        uint256 actualCollateral = IERC20(rewardToken).balanceOf(campaignAddress) - balanceBefore;
        if (actualCollateral < rewardCollateral) {
            revert InsufficientCollateral();
        }
    }

    /**
     * @notice Returns all deployed campaign contract addresses.
     */
    function getDeployedCampaigns() external view override returns (address[] memory) {
        return deployedCampaigns;
    }

    /**
     * @notice Returns a paginated slice of deployed campaign contract addresses.
     * @param offset Starting index
     * @param limit Maximum number of elements to return
     * @return campaigns Array of campaign addresses for the page
     * @return total Total number of deployed campaigns
     */
    function getDeployedCampaignsPaginated(uint256 offset, uint256 limit)
        external
        view
        override
        returns (address[] memory campaigns, uint256 total)
    {
        total = deployedCampaigns.length;
        if (offset >= total || limit == 0) {
            return (new address[](0), total);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 resultLength = end - offset;
        campaigns = new address[](resultLength);
        for (uint256 i = 0; i < resultLength; i++) {
            campaigns[i] = deployedCampaigns[offset + i];
        }
    }

    /**
     * @notice Returns total number of deployed campaigns.
     */
    function getDeployedCampaignsCount() external view override returns (uint256) {
        return deployedCampaigns.length;
    }

    /**
     * @notice Returns all campaign addresses created by a specific address.
     */
    function getCreatorCampaigns(address creator) external view override returns (address[] memory) {
        return creatorCampaigns[creator];
    }

    /**
     * @notice Returns a paginated slice of campaigns created by a specific address.
     * @param creator Creator address
     * @param offset Starting index
     * @param limit Maximum number of elements to return
     * @return campaigns Array of campaign addresses for the page
     * @return total Total number of campaigns created by creator
     */
    function getCreatorCampaignsPaginated(address creator, uint256 offset, uint256 limit)
        external
        view
        override
        returns (address[] memory campaigns, uint256 total)
    {
        address[] storage list = creatorCampaigns[creator];
        total = list.length;
        if (offset >= total || limit == 0) {
            return (new address[](0), total);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 resultLength = end - offset;
        campaigns = new address[](resultLength);
        for (uint256 i = 0; i < resultLength; i++) {
            campaigns[i] = list[offset + i];
        }
    }

    /**
     * @notice Returns total number of campaigns created by a specific address.
     */
    function getCreatorCampaignsCount(address creator) external view override returns (uint256) {
        return creatorCampaigns[creator].length;
    }
}
```

## Contract: ICrowdfundingCampaign.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ICrowdfundingCampaign
 * @notice Formal interface for autonomous All-or-Nothing Crowdfunding Campaign instances.
 */
interface ICrowdfundingCampaign {
    /// @notice State machine definitions for the campaign lifecycle
    enum State {
        Active,
        Successful,
        Expired
    }

    // --- Events ---
    event Pledged(address indexed backer, uint256 amount, uint256 newTotalRaised);
    event WithdrawnBeforeThreshold(address indexed backer, uint256 amount, uint256 newTotalRaised);
    event RewardsClaimed(address indexed backer, uint256 rewardAmount);
    event RefundClaimed(address indexed backer, uint256 refundAmount);
    event CreatorFundsClaimed(address indexed creator, uint256 fundsAmount);
    event CreatorCollateralRecovered(address indexed creator, uint256 collateralAmount);
    event ExcessRewardsRecovered(address indexed creator, uint256 amount);

    // --- Custom Errors ---
    error CampaignNotActive();
    error CampaignNotSuccessful();
    error CampaignNotExpired();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error ThresholdAlreadyReached();
    error ThresholdNotReached();
    error ThresholdExceeded();
    error ZeroAmount();
    error InsufficientContribution();
    error RewardsAlreadyClaimed();
    error RefundsAlreadyClaimed();
    error CreatorFundsAlreadyClaimed();
    error CreatorCollateralAlreadyRefunded();
    error NoExcessRewards();
    error Unauthorized();
    error InvalidConfiguration();

    // --- Mutating Functions ---
    function pledge(uint256 amount) external;
    function withdrawBeforeThreshold(uint256 amount) external;
    function claimReward() external;
    function claimRefund() external;
    function claimFunds() external;
    function recoverCollateral() external;
    function recoverExcessRewards() external;

    // --- View Functions ---
    function state() external view returns (State);
    function fundingToken() external view returns (IERC20);
    function rewardToken() external view returns (IERC20);
    function creator() external view returns (address);
    function threshold() external view returns (uint256);
    function rewardRate() external view returns (uint256);
    function deadline() external view returns (uint256);
    function rewardCollateral() external view returns (uint256);
    function totalRaised() external view returns (uint256);
    function totalRewardsClaimed() external view returns (uint256);
    function contributions(address backer) external view returns (uint256);
    function rewardsClaimed(address backer) external view returns (bool);
    function refundsClaimed(address backer) external view returns (bool);
    function creatorFundsClaimed() external view returns (bool);
    function creatorCollateralRecovered() external view returns (bool);
    function calculateReward(uint256 contributionAmount) external view returns (uint256);
    function remainingToThreshold() external view returns (uint256);
}
```

## Contract: ICrowdfundingFactory.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ICrowdfundingFactory
 * @notice Formal interface for the Crowdfunding Factory registry and deployer.
 */
interface ICrowdfundingFactory {
    event CampaignCreated(
        address indexed campaignAddress,
        address indexed creator,
        address indexed fundingToken,
        address rewardToken,
        uint256 threshold,
        uint256 rewardRate,
        uint256 deadline,
        uint256 rewardCollateral
    );

    error InvalidTokenAddress();
    error InvalidThreshold();
    error InvalidRewardRate();
    error InvalidDuration();
    error InsufficientCollateral();

    function createCampaign(
        address fundingToken,
        address rewardToken,
        uint256 threshold,
        uint256 rewardRate,
        uint256 duration
    ) external returns (address campaignAddress);

    function getDeployedCampaigns() external view returns (address[] memory);
    function getDeployedCampaignsPaginated(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory campaigns, uint256 total);
    function getDeployedCampaignsCount() external view returns (uint256);
    function getCreatorCampaigns(address creator) external view returns (address[] memory);
    function getCreatorCampaignsPaginated(address creator, uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory campaigns, uint256 total);
    function getCreatorCampaignsCount(address creator) external view returns (uint256);
}
```

## Contract: MaliciousReentrantToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ICrowdfundingCampaign} from "./ICrowdfundingCampaign.sol";

/**
 * @title MaliciousReentrantToken
 * @notice Attack vector mock simulating a reentrant token (e.g., ERC-777 hook or malicious transfer).
 * @dev INTENTIONAL SECURITY TEST HARNESS:
 * This contract is an intentional exploit simulation used in test suites to verify that
 * CrowdfundingCampaign properly repels reentrancy attacks via ReentrancyGuard and CEI.
 * Static analysis tools (such as Slither) will flag transfer() for reentrancy by design,
 * as it deliberately triggers an external callback to test target contract defenses.
 */
contract MaliciousReentrantToken is ERC20 {
    address public targetCampaign;
    bool public attackActive;
    enum AttackType { Withdraw, Refund }
    AttackType public attackType;

    constructor() ERC20("Malicious Token", "BAD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setAttackConfig(address _campaign, AttackType _type, bool _active) external {
        targetCampaign = _campaign;
        attackType = _type;
        attackActive = _active;
    }

    /**
     * @dev Deliberately attempts reentrancy on targetCampaign when called during campaign transfers.
     */
    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        if (attackActive && msg.sender == targetCampaign) {
            // Attempt to reenter the campaign before the first call finishes
            attackActive = false; // Prevent infinite recursion if guard fails
            if (attackType == AttackType.Withdraw) {
                ICrowdfundingCampaign(targetCampaign).withdrawBeforeThreshold(amount);
            } else if (attackType == AttackType.Refund) {
                ICrowdfundingCampaign(targetCampaign).claimRefund();
            }
        }
        return super.transfer(to, amount);
    }
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Realistic ERC-20 token with configurable decimals and a public test faucet.
 */
contract MockERC20 is ERC20 {
    uint8 private immutable _customDecimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _customDecimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _customDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function faucet(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}
```

## Contract: MockFeeToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockFeeToken
 * @notice ERC-20 token deducting a 5% fee on transfer to test fee-on-transfer protection.
 */
contract MockFeeToken is ERC20 {
    uint256 public feePercent = 5;

    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFeePercent(uint256 _feePercent) external {
        feePercent = _feePercent;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);
        uint256 fee = (amount * feePercent) / 100;
        uint256 netAmount = amount - fee;
        if (fee > 0) {
            _transfer(from, address(this), fee);
        }
        if (netAmount > 0) {
            _transfer(from, to, netAmount);
        }
        return true;
    }
}
```

## Tests: CrowdfundingCampaign.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("CrowdfundingCampaign", function () {
  const ONE_DAY = 24 * 60 * 60;
  const RATE_PRECISION = ethers.parseEther("1"); // 1e18
  const THRESHOLD = ethers.parseEther("1000"); // 1,000 funding tokens
  const REWARD_RATE = ethers.parseEther("2"); // 2 reward tokens per 1 funding token (2:1 ratio)
  const REQUIRED_COLLATERAL = (THRESHOLD * REWARD_RATE) / RATE_PRECISION; // 2,000 reward tokens

  async function deployCampaignFixture() {
    const [deployer, creator, alice, bob, charlie, attacker] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const fundingToken = (await MockERC20Factory.deploy("Funding Token", "FND", 18));
    const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

    const latestTime = await time.latest();
    const deadline = latestTime + ONE_DAY * 7; // 7 days from now

    // Deploy campaign
    const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
    const campaign = (await CampaignFactory.deploy(
      creator.address,
      await fundingToken.getAddress(),
      await rewardToken.getAddress(),
      THRESHOLD,
      REWARD_RATE,
      deadline
    ));

    const campaignAddress = await campaign.getAddress();

    // Mint reward tokens to creator and fund the campaign escrow with 100% collateral
    await rewardToken.mint(creator.address, REQUIRED_COLLATERAL * 2n);
    await rewardToken.connect(creator).transfer(campaignAddress, REQUIRED_COLLATERAL);

    // Mint funding tokens to backers
    await fundingToken.mint(alice.address, ethers.parseEther("5000"));
    await fundingToken.mint(bob.address, ethers.parseEther("5000"));
    await fundingToken.mint(charlie.address, ethers.parseEther("5000"));

    return {
      campaign,
      fundingToken,
      rewardToken,
      deployer,
      creator,
      alice,
      bob,
      charlie,
      attacker,
      deadline,
      campaignAddress,
    };
  }

  describe("Deployment & Configuration", function () {
    it("should initialize parameters correctly", async function () {
      const { campaign, fundingToken, rewardToken, creator, deadline } = await loadFixture(
        deployCampaignFixture
      );

      expect(await campaign.creator()).to.equal(creator.address);
      expect(await campaign.fundingToken()).to.equal(await fundingToken.getAddress());
      expect(await campaign.rewardToken()).to.equal(await rewardToken.getAddress());
      expect(await campaign.threshold()).to.equal(THRESHOLD);
      expect(await campaign.rewardRate()).to.equal(REWARD_RATE);
      expect(await campaign.deadline()).to.equal(deadline);
      expect(await campaign.rewardCollateral()).to.equal(REQUIRED_COLLATERAL);
      expect(await campaign.state()).to.equal(0); // State.Active
      expect(await campaign.totalRaised()).to.equal(0);
    });

    it("should revert if creator address is zero", async function () {
      const { fundingToken, rewardToken } = await loadFixture(deployCampaignFixture);
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const latestTime = await time.latest();

      await expect(
        CampaignFactory.deploy(
          ethers.ZeroAddress,
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");
    });

    it("should revert if funding or reward token address is zero", async function () {
      const { creator, fundingToken, rewardToken } = await loadFixture(deployCampaignFixture);
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const latestTime = await time.latest();

      await expect(
        CampaignFactory.deploy(
          creator.address,
          ethers.ZeroAddress,
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");

      await expect(
        CampaignFactory.deploy(
          creator.address,
          await fundingToken.getAddress(),
          ethers.ZeroAddress,
          THRESHOLD,
          REWARD_RATE,
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");
    });

    it("should revert if threshold or rewardRate is zero", async function () {
      const { creator, fundingToken, rewardToken } = await loadFixture(deployCampaignFixture);
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const latestTime = await time.latest();

      await expect(
        CampaignFactory.deploy(
          creator.address,
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          0,
          REWARD_RATE,
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");

      await expect(
        CampaignFactory.deploy(
          creator.address,
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          0,
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");
    });

    it("should revert if deadline is in the past or present", async function () {
      const { creator, fundingToken, rewardToken } = await loadFixture(deployCampaignFixture);
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const latestTime = await time.latest();

      await expect(
        CampaignFactory.deploy(
          creator.address,
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          latestTime - 10
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "DeadlinePassed");
    });

    it("should revert if rewardCollateral calculates to zero", async function () {
      const { creator, fundingToken, rewardToken } = await loadFixture(deployCampaignFixture);
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const latestTime = await time.latest();

      await expect(
        CampaignFactory.deploy(
          creator.address,
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          1, // extremely small threshold
          1, // extremely small rate
          latestTime + 100
        )
      ).to.be.revertedWithCustomError(CampaignFactory, "InvalidConfiguration");
    });
  });

  describe("Pledging", function () {
    it("should allow a backer to pledge funding tokens", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );
      const pledgeAmount = ethers.parseEther("300");

      await fundingToken.connect(alice).approve(campaignAddress, pledgeAmount);

      await expect(campaign.connect(alice).pledge(pledgeAmount))
        .to.emit(campaign, "Pledged")
        .withArgs(alice.address, pledgeAmount, pledgeAmount);

      expect(await campaign.contributions(alice.address)).to.equal(pledgeAmount);
      expect(await campaign.totalRaised()).to.equal(pledgeAmount);
      expect(await campaign.state()).to.equal(0); // State.Active
      expect(await fundingToken.balanceOf(campaignAddress)).to.equal(pledgeAmount);
    });

    it("should revert if pledging zero amount", async function () {
      const { campaign, alice } = await loadFixture(deployCampaignFixture);

      await expect(campaign.connect(alice).pledge(0)).to.be.revertedWithCustomError(
        campaign,
        "ZeroAmount"
      );
    });

    it("should revert if pledge exceeds threshold", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );
      const excessivePledge = THRESHOLD + 1n;

      await fundingToken.connect(alice).approve(campaignAddress, excessivePledge);

      await expect(campaign.connect(alice).pledge(excessivePledge)).to.be.revertedWithCustomError(
        campaign,
        "ThresholdExceeded"
      );
    });

    it("should transition state to Successful when pledge meets threshold exactly", async function () {
      const { campaign, fundingToken, alice, bob, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );

      const pledgeAlice = ethers.parseEther("600");
      const pledgeBob = ethers.parseEther("400");

      await fundingToken.connect(alice).approve(campaignAddress, pledgeAlice);
      await campaign.connect(alice).pledge(pledgeAlice);

      await fundingToken.connect(bob).approve(campaignAddress, pledgeBob);
      await campaign.connect(bob).pledge(pledgeBob);

      expect(await campaign.totalRaised()).to.equal(THRESHOLD);
      expect(await campaign.state()).to.equal(1); // State.Successful
      expect(await campaign.remainingToThreshold()).to.equal(0);
    });

    it("should accurately return remainingToThreshold while active", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );

      expect(await campaign.remainingToThreshold()).to.equal(THRESHOLD);

      const pledgeAmount = ethers.parseEther("300");
      await fundingToken.connect(alice).approve(campaignAddress, pledgeAmount);
      await campaign.connect(alice).pledge(pledgeAmount);

      expect(await campaign.remainingToThreshold()).to.equal(THRESHOLD - pledgeAmount);
    });
  });

  describe("Flexible Early Withdrawal Before Threshold", function () {
    it("should allow partial and full withdrawals while totalRaised < threshold", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );
      const pledgeAmount = ethers.parseEther("400");
      const partialWithdraw = ethers.parseEther("150");

      await fundingToken.connect(alice).approve(campaignAddress, pledgeAmount);
      await campaign.connect(alice).pledge(pledgeAmount);

      const initialAliceBalance = await fundingToken.balanceOf(alice.address);

      // Partial withdrawal
      await expect(campaign.connect(alice).withdrawBeforeThreshold(partialWithdraw))
        .to.emit(campaign, "WithdrawnBeforeThreshold")
        .withArgs(alice.address, partialWithdraw, pledgeAmount - partialWithdraw);

      expect(await campaign.contributions(alice.address)).to.equal(pledgeAmount - partialWithdraw);
      expect(await campaign.totalRaised()).to.equal(pledgeAmount - partialWithdraw);
      expect(await fundingToken.balanceOf(alice.address)).to.equal(
        initialAliceBalance + partialWithdraw
      );

      // Full remaining withdrawal
      const remaining = pledgeAmount - partialWithdraw;
      await campaign.connect(alice).withdrawBeforeThreshold(remaining);

      expect(await campaign.contributions(alice.address)).to.equal(0);
      expect(await campaign.totalRaised()).to.equal(0);
    });

    it("should revert if withdrawing zero", async function () {
      const { campaign, alice } = await loadFixture(deployCampaignFixture);

      await expect(campaign.connect(alice).withdrawBeforeThreshold(0)).to.be.revertedWithCustomError(
        campaign,
        "ZeroAmount"
      );
    });

    it("should revert if withdrawing more than contributed", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );
      const pledgeAmount = ethers.parseEther("200");

      await fundingToken.connect(alice).approve(campaignAddress, pledgeAmount);
      await campaign.connect(alice).pledge(pledgeAmount);

      await expect(
        campaign.connect(alice).withdrawBeforeThreshold(ethers.parseEther("201"))
      ).to.be.revertedWithCustomError(campaign, "InsufficientContribution");
    });

    it("should disallow early withdrawal once threshold is reached", async function () {
      const { campaign, fundingToken, alice, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );

      await fundingToken.connect(alice).approve(campaignAddress, THRESHOLD);
      await campaign.connect(alice).pledge(THRESHOLD);

      expect(await campaign.state()).to.equal(1); // State.Successful

      await expect(
        campaign.connect(alice).withdrawBeforeThreshold(ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(campaign, "CampaignNotActive");
    });

    it("should disallow early withdrawal once deadline has passed", async function () {
      const { campaign, fundingToken, alice, deadline, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );

      const pledgeAmount = ethers.parseEther("200");
      await fundingToken.connect(alice).approve(campaignAddress, pledgeAmount);
      await campaign.connect(alice).pledge(pledgeAmount);

      // Advance time past deadline
      await time.increaseTo(deadline + 1);

      expect(await campaign.state()).to.equal(2); // State.Expired

      await expect(
        campaign.connect(alice).withdrawBeforeThreshold(pledgeAmount)
      ).to.be.revertedWithCustomError(campaign, "CampaignNotActive");
    });
  });

  describe("Successful Campaign Settlement", function () {
    async function deploySuccessfulCampaignFixture() {
      const base = await deployCampaignFixture();
      const { campaign, fundingToken, alice, bob, campaignAddress } = base;

      const pledgeAlice = ethers.parseEther("700");
      const pledgeBob = ethers.parseEther("300");

      await fundingToken.connect(alice).approve(campaignAddress, pledgeAlice);
      await campaign.connect(alice).pledge(pledgeAlice);

      await fundingToken.connect(bob).approve(campaignAddress, pledgeBob);
      await campaign.connect(bob).pledge(pledgeBob);

      return { ...base, pledgeAlice, pledgeBob };
    }

    it("should allow backers to claim their reward tokens", async function () {
      const { campaign, rewardToken, alice, pledgeAlice } = await loadFixture(
        deploySuccessfulCampaignFixture
      );

      const expectedReward = (pledgeAlice * REWARD_RATE) / RATE_PRECISION; // 700 * 2 = 1400

      await expect(campaign.connect(alice).claimReward())
        .to.emit(campaign, "RewardsClaimed")
        .withArgs(alice.address, expectedReward);

      expect(await rewardToken.balanceOf(alice.address)).to.equal(expectedReward);
      expect(await campaign.rewardsClaimed(alice.address)).to.be.true;
    });

    it("should revert if backer attempts to double-claim rewards", async function () {
      const { campaign, alice } = await loadFixture(deploySuccessfulCampaignFixture);

      await campaign.connect(alice).claimReward();

      await expect(campaign.connect(alice).claimReward()).to.be.revertedWithCustomError(
        campaign,
        "RewardsAlreadyClaimed"
      );
    });

    it("should revert if non-backer calls claimReward", async function () {
      const { campaign, charlie } = await loadFixture(deploySuccessfulCampaignFixture);

      await expect(campaign.connect(charlie).claimReward()).to.be.revertedWithCustomError(
        campaign,
        "InsufficientContribution"
      );
    });

    it("should allow creator to claim total raised funding tokens", async function () {
      const { campaign, fundingToken, creator } = await loadFixture(
        deploySuccessfulCampaignFixture
      );

      const initialCreatorFunding = await fundingToken.balanceOf(creator.address);

      await expect(campaign.connect(creator).claimFunds())
        .to.emit(campaign, "CreatorFundsClaimed")
        .withArgs(creator.address, THRESHOLD);

      expect(await fundingToken.balanceOf(creator.address)).to.equal(
        initialCreatorFunding + THRESHOLD
      );
      expect(await campaign.creatorFundsClaimed()).to.be.true;
    });

    it("should revert if creator attempts to double-claim funds", async function () {
      const { campaign, creator } = await loadFixture(deploySuccessfulCampaignFixture);

      await campaign.connect(creator).claimFunds();

      await expect(campaign.connect(creator).claimFunds()).to.be.revertedWithCustomError(
        campaign,
        "CreatorFundsAlreadyClaimed"
      );
    });

    it("should revert if non-creator calls claimFunds", async function () {
      const { campaign, alice } = await loadFixture(deploySuccessfulCampaignFixture);

      await expect(campaign.connect(alice).claimFunds()).to.be.revertedWithCustomError(
        campaign,
        "Unauthorized"
      );
    });

    it("should prevent refunds or collateral recovery when campaign is successful", async function () {
      const { campaign, alice, creator, deadline } = await loadFixture(
        deploySuccessfulCampaignFixture
      );

      await expect(campaign.connect(alice).claimRefund()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotExpired"
      );

      await expect(campaign.connect(creator).recoverCollateral()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotExpired"
      );

      // Even if time advances far past deadline, state remains Successful!
      await time.increaseTo(deadline + ONE_DAY * 10);
      expect(await campaign.state()).to.equal(1); // State.Successful

      await expect(campaign.connect(alice).claimRefund()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotExpired"
      );

      await expect(campaign.connect(creator).recoverCollateral()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotExpired"
      );
    });
  });

  describe("Expired / Failed Campaign Settlement", function () {
    async function deployExpiredCampaignFixture() {
      const base = await deployCampaignFixture();
      const { campaign, fundingToken, alice, deadline, campaignAddress } = base;

      // Alice pledges only 400 (threshold is 1000)
      const pledgeAlice = ethers.parseEther("400");
      await fundingToken.connect(alice).approve(campaignAddress, pledgeAlice);
      await campaign.connect(alice).pledge(pledgeAlice);

      // Advance time past deadline
      await time.increaseTo(deadline + 10);

      return { ...base, pledgeAlice };
    }

    it("should transition state to Expired", async function () {
      const { campaign } = await loadFixture(deployExpiredCampaignFixture);
      expect(await campaign.state()).to.equal(2); // State.Expired
    });

    it("should revert if attempting to pledge after expiration", async function () {
      const { campaign, fundingToken, bob, campaignAddress } = await loadFixture(
        deployExpiredCampaignFixture
      );

      await fundingToken.connect(bob).approve(campaignAddress, ethers.parseEther("100"));
      await expect(
        campaign.connect(bob).pledge(ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(campaign, "CampaignNotActive");
    });

    it("should allow backers to claim 100% refund of contributed funding tokens", async function () {
      const { campaign, fundingToken, alice, pledgeAlice } = await loadFixture(
        deployExpiredCampaignFixture
      );

      const initialBalance = await fundingToken.balanceOf(alice.address);

      await expect(campaign.connect(alice).claimRefund())
        .to.emit(campaign, "RefundClaimed")
        .withArgs(alice.address, pledgeAlice);

      expect(await fundingToken.balanceOf(alice.address)).to.equal(initialBalance + pledgeAlice);
      expect(await campaign.refundsClaimed(alice.address)).to.be.true;
    });

    it("should revert if backer attempts double-refund", async function () {
      const { campaign, alice } = await loadFixture(deployExpiredCampaignFixture);

      await campaign.connect(alice).claimRefund();

      await expect(campaign.connect(alice).claimRefund()).to.be.revertedWithCustomError(
        campaign,
        "RefundsAlreadyClaimed"
      );
    });

    it("should revert if non-backer calls claimRefund", async function () {
      const { campaign, charlie } = await loadFixture(deployExpiredCampaignFixture);

      await expect(campaign.connect(charlie).claimRefund()).to.be.revertedWithCustomError(
        campaign,
        "InsufficientContribution"
      );
    });

    it("should allow creator to recover 100% of reward collateral", async function () {
      const { campaign, rewardToken, creator } = await loadFixture(deployExpiredCampaignFixture);

      const initialRewardBalance = await rewardToken.balanceOf(creator.address);

      await expect(campaign.connect(creator).recoverCollateral())
        .to.emit(campaign, "CreatorCollateralRecovered")
        .withArgs(creator.address, REQUIRED_COLLATERAL);

      expect(await rewardToken.balanceOf(creator.address)).to.equal(
        initialRewardBalance + REQUIRED_COLLATERAL
      );
      expect(await campaign.creatorCollateralRecovered()).to.be.true;
    });

    it("should revert if creator attempts double-recovery of collateral", async function () {
      const { campaign, creator } = await loadFixture(deployExpiredCampaignFixture);

      await campaign.connect(creator).recoverCollateral();

      await expect(campaign.connect(creator).recoverCollateral()).to.be.revertedWithCustomError(
        campaign,
        "CreatorCollateralAlreadyRefunded"
      );
    });

    it("should revert if non-creator calls recoverCollateral", async function () {
      const { campaign, alice } = await loadFixture(deployExpiredCampaignFixture);

      await expect(campaign.connect(alice).recoverCollateral()).to.be.revertedWithCustomError(
        campaign,
        "Unauthorized"
      );
    });

    it("should prevent claims of rewards or funds when campaign is expired", async function () {
      const { campaign, alice, creator } = await loadFixture(deployExpiredCampaignFixture);

      await expect(campaign.connect(alice).claimReward()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotSuccessful"
      );

      await expect(campaign.connect(creator).claimFunds()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotSuccessful"
      );
    });
  });

  describe("Security: Reentrancy Attack Protection", function () {
    it("should block reentrancy attack on claimRefund via MaliciousReentrantToken", async function () {
      const [, creator, attacker] = await ethers.getSigners();

      // Deploy malicious funding token
      const MaliciousFactory = await ethers.getContractFactory("MaliciousReentrantToken");
      const maliciousFunding = (await MaliciousFactory.deploy());

      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY;

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = (await CampaignFactory.deploy(
        creator.address,
        await maliciousFunding.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        deadline
      ));

      const campaignAddress = await campaign.getAddress();

      // Fund collateral
      await rewardToken.mint(campaignAddress, REQUIRED_COLLATERAL);

      // Attacker pledges
      const pledgeAmount = ethers.parseEther("100");
      await maliciousFunding.mint(attacker.address, pledgeAmount);
      await maliciousFunding.connect(attacker).approve(campaignAddress, pledgeAmount);
      await campaign.connect(attacker).pledge(pledgeAmount);

      // Expire campaign
      await time.increaseTo(deadline + 10);

      // Arm malicious token to attack on refund
      await maliciousFunding.setAttackConfig(campaignAddress, 1 /* Refund */, true);

      // When campaign executes safeTransfer, malicious token reenters claimRefund()
      // OpenZeppelin ReentrancyGuard should revert with ReentrancyGuardReentrantCall()
      await expect(campaign.connect(attacker).claimRefund()).to.be.revertedWithCustomError(
        campaign,
        "ReentrancyGuardReentrantCall"
      );
    });

    it("should block reentrancy attack on withdrawBeforeThreshold via MaliciousReentrantToken", async function () {
      const [, creator, attacker] = await ethers.getSigners();

      const MaliciousFactory = await ethers.getContractFactory("MaliciousReentrantToken");
      const maliciousFunding = (await MaliciousFactory.deploy());

      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY;

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = (await CampaignFactory.deploy(
        creator.address,
        await maliciousFunding.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        deadline
      ));

      const campaignAddress = await campaign.getAddress();
      await rewardToken.mint(campaignAddress, REQUIRED_COLLATERAL);

      const pledgeAmount = ethers.parseEther("100");
      await maliciousFunding.mint(attacker.address, pledgeAmount);
      await maliciousFunding.connect(attacker).approve(campaignAddress, pledgeAmount);
      await campaign.connect(attacker).pledge(pledgeAmount);

      // Arm malicious token to attack on withdraw
      await maliciousFunding.setAttackConfig(campaignAddress, 0 /* Withdraw */, true);

      await expect(
        campaign.connect(attacker).withdrawBeforeThreshold(ethers.parseEther("50"))
      ).to.be.revertedWithCustomError(campaign, "ReentrancyGuardReentrantCall");
    });

    it("should allow regular transfers on MaliciousReentrantToken when attack is inactive", async function () {
      const [deployer, user1, user2] = await ethers.getSigners();
      const MaliciousFactory = await ethers.getContractFactory("MaliciousReentrantToken");
      const token = (await MaliciousFactory.deploy());
      await token.mint(user1.address, 1000n);
      await token.connect(user1).transfer(user2.address, 400n);
      expect(await token.balanceOf(user2.address)).to.equal(400n);
    });
  });

  describe("MockERC20 Faucet & Utility", function () {
    it("should allow users to call faucet and check decimals", async function () {
      const [,, user] = await ethers.getSigners();
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const token = (await MockERC20Factory.deploy("Test Token", "TST", 6));

      expect(await token.decimals()).to.equal(6);
      await token.connect(user).faucet(1000n);
      expect(await token.balanceOf(user.address)).to.equal(1000n);
    });
  });

  describe("Multi-Decimal Precision Handling", function () {
    it("should correctly handle 6-decimal USDC funding token and 18-decimal reward token", async function () {
      const [, creator, backer] = await ethers.getSigners();

      // USDC has 6 decimals
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const usdcFunding = (await MockERC20Factory.deploy("USD Coin", "USDC", 6));
      const projectReward = (await MockERC20Factory.deploy("Project Token", "PRJ", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY * 5;

      // Threshold: 50,000 USDC = 50,000 * 10^6 units
      const usdcThreshold = 50_000n * 10n ** 6n;

      // Rate: 1 whole USDC gives 10 whole PRJ tokens
      // 10^6 raw USDC -> 10 * 10^18 raw PRJ
      // rewardRate = (10 * 10^18 * 10^18) / 10^6 = 10^31
      const normalizedRate = ethers.parseUnits("10", 30); // 10 * 1e30

      const requiredRewardCollateral = (usdcThreshold * normalizedRate) / RATE_PRECISION;
      // 50,000 * 10^6 * 10 * 10^30 / 10^18 = 500,000 * 10^18 (500,000 whole PRJ tokens)
      expect(requiredRewardCollateral).to.equal(ethers.parseEther("500000"));

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const multiDecCampaign = (await CampaignFactory.deploy(
        creator.address,
        await usdcFunding.getAddress(),
        await projectReward.getAddress(),
        usdcThreshold,
        normalizedRate,
        deadline
      ));

      const campaignAddress = await multiDecCampaign.getAddress();

      // Fund collateral
      await projectReward.mint(campaignAddress, requiredRewardCollateral);

      // Backer pledges 5,000 USDC (10% of threshold)
      const pledgeAmount = 5_000n * 10n ** 6n;
      await usdcFunding.mint(backer.address, pledgeAmount);
      await usdcFunding.connect(backer).approve(campaignAddress, pledgeAmount);
      await multiDecCampaign.connect(backer).pledge(pledgeAmount);

      const expectedReward = (pledgeAmount * normalizedRate) / RATE_PRECISION;
      // 5,000 * 10 = 50,000 whole PRJ tokens (50,000 * 10^18)
      expect(expectedReward).to.equal(ethers.parseEther("50000"));
      expect(await multiDecCampaign.calculateReward(pledgeAmount)).to.equal(expectedReward);
    });
  });

  describe("Fee-on-Transfer Funding Token Protection", function () {
    it("should correctly record net received amount and avoid contract insolvency", async function () {
      const [deployer, creator, backer] = await ethers.getSigners();
      const MockFeeTokenFactory = await ethers.getContractFactory("MockFeeToken");
      const feeFundingToken = (await MockFeeTokenFactory.deploy());

      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY * 7;
      const threshold = ethers.parseEther("950"); // Target is exactly 950 net tokens

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = (await CampaignFactory.deploy(
        creator.address,
        await feeFundingToken.getAddress(),
        await rewardToken.getAddress(),
        threshold,
        REWARD_RATE,
        deadline
      ));

      const campaignAddress = await campaign.getAddress();
      const collateral = (threshold * REWARD_RATE) / RATE_PRECISION;
      await rewardToken.mint(campaignAddress, collateral);

      // Backer has 2,000 fee tokens. Backer pledges 1,000 tokens.
      // MockFeeToken deducts 5% fee (50 tokens), so campaign receives exactly 950 tokens!
      await feeFundingToken.mint(backer.address, ethers.parseEther("2000"));
      await feeFundingToken.connect(backer).approve(campaignAddress, ethers.parseEther("1000"));

      await expect(campaign.connect(backer).pledge(ethers.parseEther("1000")))
        .to.emit(campaign, "Pledged")
        .withArgs(backer.address, ethers.parseEther("950"), ethers.parseEther("950"));

      // Invariant checks
      expect(await campaign.contributions(backer.address)).to.equal(ethers.parseEther("950"));
      expect(await campaign.totalRaised()).to.equal(ethers.parseEther("950"));
      expect(await campaign.state()).to.equal(1); // Successful!

      // Verify contract balance of fee token exactly matches totalRaised
      expect(await feeFundingToken.balanceOf(campaignAddress)).to.equal(ethers.parseEther("950"));

      // Creator claims funds: must succeed without reverting because contract holds the full 950 tokens!
      await expect(campaign.connect(creator).claimFunds())
        .to.emit(campaign, "CreatorFundsClaimed")
        .withArgs(creator.address, ethers.parseEther("950"));

      expect(await feeFundingToken.balanceOf(campaignAddress)).to.equal(0);
    });

    it("should revert if fee-on-transfer pledge net amount exceeds threshold", async function () {
      const [deployer, creator, backer] = await ethers.getSigners();
      const MockFeeTokenFactory = await ethers.getContractFactory("MockFeeToken");
      const feeFundingToken = (await MockFeeTokenFactory.deploy());

      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY * 7;
      const threshold = ethers.parseEther("500");

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = (await CampaignFactory.deploy(
        creator.address,
        await feeFundingToken.getAddress(),
        await rewardToken.getAddress(),
        threshold,
        REWARD_RATE,
        deadline
      ));

      const campaignAddress = await campaign.getAddress();
      await rewardToken.mint(campaignAddress, (threshold * REWARD_RATE) / RATE_PRECISION);

      // Pledging 1,000 gives 950 net, which exceeds 500 threshold
      await feeFundingToken.mint(backer.address, ethers.parseEther("1000"));
      await feeFundingToken.connect(backer).approve(campaignAddress, ethers.parseEther("1000"));

      await expect(campaign.connect(backer).pledge(ethers.parseEther("1000"))).to.be.revertedWithCustomError(
        campaign,
        "ThresholdExceeded"
      );
    });

    it("should revert with ZeroAmount if fee-on-transfer token results in 0 net tokens received", async function () {
      const [deployer, creator, backer] = await ethers.getSigners();
      const MockFeeTokenFactory = await ethers.getContractFactory("MockFeeToken");
      const feeFundingToken = (await MockFeeTokenFactory.deploy());

      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

      const latestTime = await time.latest();
      const deadline = latestTime + ONE_DAY * 7;
      const threshold = ethers.parseEther("500");

      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = (await CampaignFactory.deploy(
        creator.address,
        await feeFundingToken.getAddress(),
        await rewardToken.getAddress(),
        threshold,
        REWARD_RATE,
        deadline
      ));

      const campaignAddress = await campaign.getAddress();
      await rewardToken.mint(campaignAddress, (threshold * REWARD_RATE) / RATE_PRECISION);

      // Set fee to 100%, meaning 0 net tokens are received
      await feeFundingToken.setFeePercent(100);
      await feeFundingToken.mint(backer.address, ethers.parseEther("100"));
      await feeFundingToken.connect(backer).approve(campaignAddress, ethers.parseEther("100"));

      await expect(campaign.connect(backer).pledge(ethers.parseEther("100"))).to.be.revertedWithCustomError(
        campaign,
        "ZeroAmount"
      );
    });
  });

  describe("Excess Reward Dust Recovery", function () {
    it("should allow creator to recover excess reward tokens and dust upon success", async function () {
      const { campaign, fundingToken, rewardToken, creator, alice, bob, campaignAddress } = await loadFixture(
        deployCampaignFixture
      );

      // Fund to threshold
      await fundingToken.connect(alice).approve(campaignAddress, ethers.parseEther("600"));
      await campaign.connect(alice).pledge(ethers.parseEther("600"));

      await fundingToken.connect(bob).approve(campaignAddress, ethers.parseEther("400"));
      await campaign.connect(bob).pledge(ethers.parseEther("400"));

      expect(await campaign.state()).to.equal(1); // Successful

      // Alice claims rewards: 600 * 2 = 1200 reward tokens
      await campaign.connect(alice).claimReward();
      expect(await campaign.totalRewardsClaimed()).to.equal(ethers.parseEther("1200"));

      // Currently, contract has 800 remaining reward tokens for Bob (collateral was 2000, 2000 - 1200 = 800)
      // Attempting to recover excess rewards should revert with NoExcessRewards
      await expect(campaign.connect(creator).recoverExcessRewards()).to.be.revertedWithCustomError(
        campaign,
        "NoExcessRewards"
      );

      // Non-creator cannot call recoverExcessRewards
      await expect(campaign.connect(alice).recoverExcessRewards()).to.be.revertedWithCustomError(
        campaign,
        "Unauthorized"
      );

      // Simulate excess reward tokens (e.g., donated tokens or rounding dust surplus)
      const surplus = ethers.parseEther("250");
      await rewardToken.mint(campaignAddress, surplus);

      const creatorRewardBefore = await rewardToken.balanceOf(creator.address);

      // Creator sweeps excess tokens
      await expect(campaign.connect(creator).recoverExcessRewards())
        .to.emit(campaign, "ExcessRewardsRecovered")
        .withArgs(creator.address, surplus);

      const creatorRewardAfter = await rewardToken.balanceOf(creator.address);
      expect(creatorRewardAfter - creatorRewardBefore).to.equal(surplus);

      // Second recovery reverts since excess was already swept
      await expect(campaign.connect(creator).recoverExcessRewards()).to.be.revertedWithCustomError(
        campaign,
        "NoExcessRewards"
      );

      // Bob can still claim his exact 800 reward tokens without failure!
      await expect(campaign.connect(bob).claimReward())
        .to.emit(campaign, "RewardsClaimed")
        .withArgs(bob.address, ethers.parseEther("800"));
      expect(await campaign.totalRewardsClaimed()).to.equal(ethers.parseEther("2000"));
    });

    it("should revert recoverExcessRewards if campaign is not successful", async function () {
      const { campaign, creator } = await loadFixture(deployCampaignFixture);
      // Campaign is still Active
      await expect(campaign.connect(creator).recoverExcessRewards()).to.be.revertedWithCustomError(
        campaign,
        "CampaignNotSuccessful"
      );
    });
  });
});
```

## Tests: CrowdfundingFactory.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("CrowdfundingFactory", function () {
  const ONE_DAY = 24 * 60 * 60;
  const RATE_PRECISION = ethers.parseEther("1");
  const THRESHOLD = ethers.parseEther("1000");
  const REWARD_RATE = ethers.parseEther("2");
  const REQUIRED_COLLATERAL = (THRESHOLD * REWARD_RATE) / RATE_PRECISION; // 2,000 tokens

  async function deployFactoryFixture() {
    const [deployer, creator1, creator2, backer] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const fundingToken = (await MockERC20Factory.deploy("Funding Token", "FND", 18));
    const rewardToken = (await MockERC20Factory.deploy("Reward Token", "RWD", 18));

    const Factory = await ethers.getContractFactory("CrowdfundingFactory");
    const factory = (await Factory.deploy());
    const factoryAddress = await factory.getAddress();

    // Mint reward tokens to creators
    await rewardToken.mint(creator1.address, ethers.parseEther("10000"));
    await rewardToken.mint(creator2.address, ethers.parseEther("10000"));

    return {
      factory,
      fundingToken,
      rewardToken,
      deployer,
      creator1,
      creator2,
      backer,
      factoryAddress,
    };
  }

  describe("Initialization", function () {
    it("should start with 0 deployed campaigns", async function () {
      const { factory } = await loadFixture(deployFactoryFixture);
      expect(await factory.getDeployedCampaignsCount()).to.equal(0);
      expect(await factory.getDeployedCampaigns()).to.deep.equal([]);
    });
  });

  describe("Validation & Errors", function () {
    it("should revert if token address is zero", async function () {
      const { factory, rewardToken } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createCampaign(
          ethers.ZeroAddress,
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InvalidTokenAddress");

      await expect(
        factory.createCampaign(
          await rewardToken.getAddress(),
          ethers.ZeroAddress,
          THRESHOLD,
          REWARD_RATE,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InvalidTokenAddress");
    });

    it("should revert if threshold is zero", async function () {
      const { factory, fundingToken, rewardToken } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          0,
          REWARD_RATE,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InvalidThreshold");
    });

    it("should revert if rewardRate is zero or results in 0 collateral", async function () {
      const { factory, fundingToken, rewardToken } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          0,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InvalidRewardRate");

      await expect(
        factory.createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          1,
          1,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InvalidRewardRate");
    });

    it("should revert if duration is zero", async function () {
      const { factory, fundingToken, rewardToken } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          0
        )
      ).to.be.revertedWithCustomError(factory, "InvalidDuration");
    });

    it("should revert if creator has not approved sufficient reward tokens", async function () {
      const { factory, fundingToken, rewardToken, creator1 } = await loadFixture(
        deployFactoryFixture
      );

      // No approval given
      await expect(
        factory.connect(creator1).createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          ONE_DAY * 7
        )
      ).to.be.reverted;
    });

    it("should revert with InsufficientCollateral if reward token deducts a fee on transfer", async function () {
      const { factory, fundingToken, creator1, factoryAddress } = await loadFixture(
        deployFactoryFixture
      );

      const MockFeeFactory = await ethers.getContractFactory("MockFeeToken");
      const feeToken = await MockFeeFactory.deploy();

      await feeToken.mint(creator1.address, REQUIRED_COLLATERAL * 2n);
      await feeToken.connect(creator1).approve(factoryAddress, REQUIRED_COLLATERAL * 2n);

      await expect(
        factory.connect(creator1).createCampaign(
          await fundingToken.getAddress(),
          await feeToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          ONE_DAY * 7
        )
      ).to.be.revertedWithCustomError(factory, "InsufficientCollateral");
    });
  });

  describe("Successful Campaign Creation", function () {
    it("should create campaign, lock collateral, and register instance", async function () {
      const { factory, fundingToken, rewardToken, creator1, factoryAddress } = await loadFixture(
        deployFactoryFixture
      );

      // Creator approves factory to transfer collateral
      await rewardToken.connect(creator1).approve(factoryAddress, REQUIRED_COLLATERAL);

      const tx = await factory.connect(creator1).createCampaign(
        await fundingToken.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        ONE_DAY * 7
      );

      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;

      // Verify registry updates
      expect(await factory.getDeployedCampaignsCount()).to.equal(1);
      const deployedCampaigns = await factory.getDeployedCampaigns();
      const campaignAddress = deployedCampaigns[0];

      expect(await factory.getCreatorCampaignsCount(creator1.address)).to.equal(1);
      const creatorCampaigns = await factory.getCreatorCampaigns(creator1.address);
      expect(creatorCampaigns[0]).to.equal(campaignAddress);

      // Verify collateral was transferred into the campaign contract
      expect(await rewardToken.balanceOf(campaignAddress)).to.equal(REQUIRED_COLLATERAL);

      // Verify campaign contract state
      const CampaignFactory = await ethers.getContractFactory("CrowdfundingCampaign");
      const campaign = CampaignFactory.attach(campaignAddress);
      expect(await campaign.creator()).to.equal(creator1.address);
      expect(await campaign.threshold()).to.equal(THRESHOLD);
      expect(await campaign.rewardCollateral()).to.equal(REQUIRED_COLLATERAL);
    });

    it("should support multiple creators and indexing", async function () {
      const { factory, fundingToken, rewardToken, creator1, creator2, factoryAddress } =
        await loadFixture(deployFactoryFixture);

      await rewardToken.connect(creator1).approve(factoryAddress, REQUIRED_COLLATERAL * 2n);
      await rewardToken.connect(creator2).approve(factoryAddress, REQUIRED_COLLATERAL);

      // Creator 1 creates 2 campaigns
      await factory.connect(creator1).createCampaign(
        await fundingToken.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        ONE_DAY * 3
      );
      await factory.connect(creator1).createCampaign(
        await fundingToken.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        ONE_DAY * 5
      );

      // Creator 2 creates 1 campaign
      await factory.connect(creator2).createCampaign(
        await fundingToken.getAddress(),
        await rewardToken.getAddress(),
        THRESHOLD,
        REWARD_RATE,
        ONE_DAY * 10
      );

      expect(await factory.getDeployedCampaignsCount()).to.equal(3);
      expect(await factory.getCreatorCampaignsCount(creator1.address)).to.equal(2);
      expect(await factory.getCreatorCampaignsCount(creator2.address)).to.equal(1);
    });

    it("should support paginated retrieval of deployed and creator campaigns", async function () {
      const { factory, fundingToken, rewardToken, creator1, factoryAddress } = await loadFixture(
        deployFactoryFixture
      );

      await rewardToken.connect(creator1).approve(factoryAddress, REQUIRED_COLLATERAL * 5n);

      // Deploy 3 campaigns
      for (let i = 1; i <= 3; i++) {
        await factory.connect(creator1).createCampaign(
          await fundingToken.getAddress(),
          await rewardToken.getAddress(),
          THRESHOLD,
          REWARD_RATE,
          ONE_DAY * i
        );
      }

      const allCampaigns = await factory.getDeployedCampaigns();
      expect(allCampaigns.length).to.equal(3);

      // Page 1: offset 0, limit 2
      const [page1, total1] = await factory.getDeployedCampaignsPaginated(0, 2);
      expect(total1).to.equal(3);
      expect(page1.length).to.equal(2);
      expect(page1[0]).to.equal(allCampaigns[0]);
      expect(page1[1]).to.equal(allCampaigns[1]);

      // Page 2: offset 2, limit 2 (only 1 remaining)
      const [page2, total2] = await factory.getDeployedCampaignsPaginated(2, 2);
      expect(total2).to.equal(3);
      expect(page2.length).to.equal(1);
      expect(page2[0]).to.equal(allCampaigns[2]);

      // Out of bounds offset
      const [pageEmpty, totalEmpty] = await factory.getDeployedCampaignsPaginated(5, 2);
      expect(totalEmpty).to.equal(3);
      expect(pageEmpty.length).to.equal(0);

      // Limit 0 returns empty slice
      const [pageZeroLimit, totalZero] = await factory.getDeployedCampaignsPaginated(0, 0);
      expect(totalZero).to.equal(3);
      expect(pageZeroLimit.length).to.equal(0);

      // Creator paginated queries
      const [creatorPage1, creatorTotal1] = await factory.getCreatorCampaignsPaginated(
        creator1.address,
        0,
        1
      );
      expect(creatorTotal1).to.equal(3);
      expect(creatorPage1.length).to.equal(1);
      expect(creatorPage1[0]).to.equal(allCampaigns[0]);

      // Creator pagination where offset + limit exceeds total
      const [creatorPageExceed, creatorTotalExceed] = await factory.getCreatorCampaignsPaginated(
        creator1.address,
        1,
        10
      );
      expect(creatorTotalExceed).to.equal(3);
      expect(creatorPageExceed.length).to.equal(2);
      expect(creatorPageExceed[0]).to.equal(allCampaigns[1]);
      expect(creatorPageExceed[1]).to.equal(allCampaigns[2]);

      const [creatorPageOOB, creatorTotalOOB] = await factory.getCreatorCampaignsPaginated(
        creator1.address,
        10,
        5
      );
      expect(creatorTotalOOB).to.equal(3);
      expect(creatorPageOOB.length).to.equal(0);

      // Creator pagination where limit is 0
      const [creatorPageZeroLimit, creatorTotalZeroLimit] = await factory.getCreatorCampaignsPaginated(
        creator1.address,
        0,
        0
      );
      expect(creatorTotalZeroLimit).to.equal(3);
      expect(creatorPageZeroLimit.length).to.equal(0);
    });
  });
});
```
