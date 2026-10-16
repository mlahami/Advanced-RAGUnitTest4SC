# staking--cecile-hirschauer

- domain: staking-yield (staking)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Cecile-Hirschauer/EcoGreenFund @ 8f22299e4a8974810a402192db3de592ee3eb368
- license: MIT
- targets: Staking.sol, Crowdfunding.sol, LeafToken.sol, ICrowdfunding.sol, IStaking.sol, MockDai.sol
- validation: 12 passing tests, 0 failing; statement coverage Staking.sol 100.0 %, Crowdfunding.sol 30.51 %, LeafToken.sol 100.0 %, ICrowdfunding.sol 100.0 %, IStaking.sol 100.0 %, MockDai.sol 9.09 %

## Contract: Crowdfunding.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

error CrowdFunding__WithdrawFailed();


/// @title A crowdfunding platform for environmental projects
/// @notice This contract allows users to create, fund, and manage campaigns for environmental causes
/// @dev Extends OpenZeppelin's ReentrancyGuard for protection against re-entrancy attacks

contract Crowdfunding is ReentrancyGuard {
    IERC20 public leafToken;

    /// @notice Structure to store campaign details
    struct Campaign {
        string name;
        string description;
        string image;
        address payable creator;
        uint256 startAt;
        uint256 endAt;
        uint256 id;
        uint256 targetAmount;
        uint256 amountCollected;
        uint256 amountWithdrawnByOwner;
        bool isActive;
        bool claimedByOwner;
    }


    uint256 private constant THIRTY_DAYS = 2592000; // 30 days in seconds
    uint256 public constant RATE = 100; // Rate of LEAF tokens per ETH

    uint256 public campaignsCount;
    Campaign[] public campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(uint256 => mapping(address => bool)) public rewardsClaimed;

    /// @notice Emitted when a new campaign is created
    event CampaignCreated(uint256 indexed campaignId, address indexed creator, uint256 indexed targetAmount, uint256 startAt, uint256 endAt);
    /// @notice Emitted when a campaign is updated
    event CampaignUpdated(uint256 indexed campaignId, address indexed creator, uint256 indexed targetAmount, uint256 startAt, uint256 endAt);
    /// @notice Emitted when a campaign's active status is changed
    event CampaignActiveStatusChanged(uint256 indexed campaignId, address indexed creator, bool indexed isActive);
    /// @notice Emitted when a campaign is funded
    event CampaignFunded(uint256 indexed campaignId, address indexed funder, uint256 indexed amount);
    /// @notice Emitted when a campaign is funded with tokens
    event CampaignFundedWithToken(uint256 indexed campaignId, address indexed funder, uint256 indexed amount);
    /// @notice Emitted when funds are successfully withdrawn by the campaign creator
    event WithdrawSuccessful(uint256 indexed campaignId, address indexed owner, uint256 indexed amount);
    /// @notice Emitted when a refund is issued to a contributor
    event RefundIssued(uint256 indexed campaignId, address indexed funder, uint256 indexed amount);
    /// @notice Emitted when a reward is claimed by a contributor
    event RewardClaimed(address indexed claimant, uint256 indexed campaignId, uint256 reward);

    /// @dev Sets the LeafToken contract address upon deployment
    /// @param _leafToken Address of the LeafToken contract
    constructor(address _leafToken) {
        leafToken = IERC20(_leafToken);
    }

    /// @dev Modifier to restrict function access to the campaign creator
    modifier onlyCreator(uint256 campaignId) {
        require(campaigns[campaignId].creator == msg.sender, "Only the campaign creator can call this function.");
        _;
    }

    /// @dev Modifier to check if the caller has contributed to the campaign
    modifier onlyContributor(uint256 campaignId) {
        require(contributions[campaignId][msg.sender] > 0, "Not a contributor");
        _;
    }

    /// @notice Allows a user to create a new campaign
    /// @param _name Name of the campaign
    /// @param _description Description of the campaign
    /// @param _targetAmount Target funding amount in wei
    /// @param _startAt Campaign start time in UNIX timestamp
    /// @param _endAt Campaign end time in UNIX timestamp
    /// @param _image URI of the campaign image
    function createCampaign(
        string memory _name,
        string memory _description,
        uint256 _targetAmount,
        uint256 _startAt,
        uint256 _endAt,
        string memory _image
    ) external {
        require(campaigns.length < 10, "Maximum number of campaigns reached");
        require(_startAt < _endAt, "End date should be after start date");
        require(bytes(_name).length != 0, "Name cannot be empty");
        require(bytes(_description).length != 0, "Description cannot be empty");
        require(bytes(_image).length != 0, "Image URL cannot be empty");
        require(_targetAmount > 0, "Target amount should be greater than zero");

        Campaign memory newCampaign = Campaign({
            name: _name,
            description: _description,
            image: _image,
            creator: payable(msg.sender),
            startAt: _startAt,
            endAt: _endAt,
            id: campaignsCount,
            targetAmount: _targetAmount,
            amountCollected: 0,
            amountWithdrawnByOwner: 0,
            isActive: true,
            claimedByOwner: false
        });

        campaigns.push(newCampaign);
        emit CampaignCreated(campaignsCount, msg.sender, _targetAmount, _startAt, _endAt);
        campaignsCount++;
    }

    /// @notice Gets the total number of campaigns
    /// @return The total number of campaigns
    function getCampaignsCount() public view returns (uint256) {
        return campaignsCount;
    }

    /// @notice Checks if a campaign exists
    /// @dev Reverts if the campaign ID is invalid
    /// @param campaignId The ID of the campaign to check
    function checkCampaignExists(uint256 campaignId) public view {
        require(campaignId < campaigns.length, "Invalid campaign id");
    }

    /// @notice Retrieves details of a specific campaign
    /// @param campaignId The ID of the campaign
    /// @return The campaign details
    function getCampaign(uint256 campaignId) public view returns (Campaign memory) {
        checkCampaignExists(campaignId);
        return campaigns[campaignId];
    }

    /// @notice Allows the campaign creator to update the campaign details
    /// @param campaignId The ID of the campaign to update
    /// @param _name New name of the campaign
    /// @param _description New description of the campaign
    /// @param _targetAmount New target funding amount in wei
    /// @param _startAt New campaign start time in UNIX timestamp
    /// @param _endAt New campaign end time in UNIX timestamp
    /// @param _image New URI of the campaign image
    function updateCampaign(
        uint256 campaignId,
        string memory _name,
        string memory _description,
        uint256 _targetAmount,
        uint256 _startAt,
        uint256 _endAt,
        string memory _image
    ) external onlyCreator(campaignId) {
        require(_startAt < _endAt, "End date should be after start date");
        require(bytes(_name).length != 0, "Name cannot be empty");
        require(bytes(_description).length != 0, "Description cannot be empty");
        require(bytes(_image).length != 0, "Image URL cannot be empty");
        require(_targetAmount > 0, "Target amount should be greater than zero");

        Campaign storage campaign = campaigns[campaignId];
        campaign.name = _name;
        campaign.description = _description;
        campaign.image = _image;
        campaign.startAt = _startAt;
        campaign.endAt = _endAt;
        campaign.targetAmount = _targetAmount;

        emit CampaignUpdated(campaignId, msg.sender, _targetAmount, _startAt, _endAt);
    }

    /// @notice Toggles the active status of a campaign
    /// @param campaignId The ID of the campaign to toggle
    function toggleCampaignStatus(uint256 campaignId) external onlyCreator(campaignId) {
        campaigns[campaignId].isActive = !campaigns[campaignId].isActive;

        emit CampaignActiveStatusChanged(campaignId, msg.sender, campaigns[campaignId].isActive);
    }

    /// @notice Allows users to fund an active and not yet fully funded campaign
    /// @param campaignId The ID of the campaign to fund
    function fundCampaign(uint256 campaignId) external payable {
        require(msg.value > 0, "Amount must be greater than zero");
        Campaign storage campaign = campaigns[campaignId];
        require(campaign.amountCollected + msg.value <= campaign.targetAmount, "Campaign already funded");
        require(campaign.isActive, "Campaign is not active");
        require(block.timestamp < campaign.endAt, "Campaign is expired");

        contributions[campaignId][msg.sender] += msg.value;
        campaign.amountCollected += msg.value;

        emit CampaignFunded(campaignId, msg.sender, msg.value);
    }

    /// @notice Allows users to fund an active and not yet fully funded campaign with tokens
    /// @param campaignId The ID of the campaign to fund
    /// @param amount The amount of tokens to fund the campaign with
    function fundCampaignWithToken(uint256 campaignId, uint256 amount) external nonReentrant {
        Campaign storage campaign = campaigns[campaignId];
        require(amount > 0, "Amount must be greater than zero");
        require(campaign.isActive, "Campaign is not active");
        require(block.timestamp < campaign.endAt, "Campaign is expired");
        require(campaign.amountCollected + amount <= campaign.targetAmount, "Campaign already funded");

        contributions[campaignId][msg.sender] += amount;
        campaign.amountCollected += amount;

        emit CampaignFundedWithToken(campaignId, msg.sender, amount);
    }


    /// @notice Allows contributors to request a refund if the campaign has failed or is overfunded
    /// @param campaignId The ID of the campaign from which to refund
    function refund(uint256 campaignId) external nonReentrant onlyContributor(campaignId) {
        Campaign storage campaign = campaigns[campaignId];

        require(block.timestamp > campaign.endAt, "Campaign is not ended");
        uint256 contributedAmount = contributions[campaignId][msg.sender];
        require(contributedAmount > 0, "No contribution found");

        contributions[campaignId][msg.sender] = 0;

        (bool success,) = msg.sender.call{value: contributedAmount}("");
        require(success, "Refund failed");

        campaign.amountCollected -= contributedAmount;

        emit RefundIssued(campaignId, msg.sender, contributedAmount);
    }

    /// @notice Allows the campaign creator to withdraw the funds after the campaign ends
    /// @dev Reverts if the campaign has not ended, if the amount was already withdrawn, or if the balance is zero
    /// @param campaignId The ID of the campaign from which to withdraw funds
    function withdraw(uint256 campaignId) external nonReentrant onlyCreator(campaignId) {
        Campaign storage campaign = campaigns[campaignId];

        require(block.timestamp > campaign.endAt, "Campaign is not ended");
        require(!campaign.claimedByOwner, "Amount already withdrawn");
        require(campaign.amountCollected > 0, "Balance is equal to zero");

        uint256 amountToWithdraw = campaign.amountCollected;
        campaign.amountCollected = 0;
        campaign.claimedByOwner = true;

        (bool sent, ) = campaign.creator.call{value: amountToWithdraw}("");
        require(sent, "Failed to send Ether");

        emit WithdrawSuccessful(campaignId, msg.sender, amountToWithdraw);
    }

    /// @notice Allows contributors to claim their rewards after the campaign ends
    /// @dev Reverts if the campaign has not ended or if the reward was already claimed
    /// @param campaignId The ID of the campaign for which to claim rewards
    function claimReward(uint256 campaignId) public nonReentrant onlyContributor(campaignId) {
        Campaign storage campaign = campaigns[campaignId];
        require(block.timestamp > campaign.endAt, "Campaign is not ended");
        require(!rewardsClaimed[campaignId][msg.sender], "Reward already claimed");

        uint256 rewardAmount = calculateReward(campaignId, msg.sender);

        rewardsClaimed[campaignId][msg.sender] = true;
        require(leafToken.transfer(msg.sender, rewardAmount), "Rewards transfer failed");

        emit RewardClaimed(msg.sender, campaignId, rewardAmount);
    }

    /// @dev Calculates the reward for a contributor based on their contribution and the reward rate
    /// @param campaignId The ID of the campaign
    /// @param contributor The address of the contributor
    /// @return The amount of reward in LEAF tokens
    function calculateReward(uint256 campaignId, address contributor) internal view returns (uint256) {
        uint256 userContribution = contributions[campaignId][contributor];
        uint256 rewardAmount = (userContribution * RATE) / 1 ether;
        return rewardAmount;
    }

    /// @dev Allows the contract to receive ether
    receive() external payable {}
}
```

## Contract: ICrowdfunding.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

interface ICrowdfunding {
    function fundCampaignWithToken(uint256 _campaignId, uint256 _amount) external;
}
```

## Contract: IStaking.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

interface IStaking {
    function stakeTokens(uint256 _amount, uint256 _duration) external;
    function calculateReward(address _staker) external view returns (uint256);
    function reinvestReward(uint256 campaignId, uint256 bonusRate) external;
    function claimReward() external;
}
```

## Contract: LeafToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LeafToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("LeafToken", "LEAF") {
        _mint(msg.sender, initialSupply);
    }
}
```

## Contract: MockDai.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title A mock Dai token for testing and development purposes.
/// @notice This contract is a simplified version of the Dai stablecoin, intended for use in development environments.
/// @dev Inherits from OpenZeppelin's ERC20 and Ownable contracts.
contract MockDai is ERC20, Ownable {
    /// @dev Initializes the contract with an initial supply of tokens and assigns them to the deployer.
    /// @param initialSupply The amount of tokens to mint upon deployment.
    constructor(uint256 initialSupply) ERC20("Mock Dai Stablecoin", "mDAI") Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    /// @notice Allows users to buy mock Dai tokens by sending Ether to the contract.
    /// @dev Mints new mock Dai tokens based on the amount of Ether sent and the predefined conversion rate.
    function buyMockDai() external payable {
        require(msg.value > 0, "You need to send ether to buy MockDai");
        uint256 amountToMint = msg.value * 1000; // Conversion rate: 1 Ether = 1000 mDAI.
        _mint(msg.sender, amountToMint);
    }

    /// @notice Allows users to sell their mock Dai tokens back to the contract in exchange for Ether.
    /// @dev Burns the mock Dai tokens and transfers Ether to the user based on the predefined conversion rate.
    /// @param amount The amount of mock Dai tokens to sell.
    function sellMockDai(uint256 amount) external {
        require(amount > 1, "You must sell at least 1 mDAI");
        require(balanceOf(msg.sender) >= amount, "You don't have enough mDAI to sell");
        uint256 etherAmount = amount / 1000; // Conversion rate: 1000 mDAI = 1 Ether.
        _burn(msg.sender, amount);
        payable(msg.sender).transfer(etherAmount);
    }

    /// @notice Allows the contract owner to mint new mock Dai tokens to a specified address.
    /// @param to The address to receive the newly minted tokens.
    /// @param amount The amount of tokens to mint.
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /// @notice Allows the contract owner to burn mock Dai tokens from a specified address.
    /// @param from The address from which the tokens will be burned.
    /// @param amount The amount of tokens to burn.
    function burn(address from, uint256 amount) public onlyOwner {
        _burn(from, amount);
    }

    /// @dev Allows the contract to receive Ether directly without calling a function.
    receive() external payable {}
}
```

## Contract: Staking.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ICrowdfunding.sol";
import "./IStaking.sol";

/// @title Staking Contract for Token Holders
/// @notice This contract allows users to stake their tokens for a period of time and earn rewards based on the duration of staking.
/// @dev This contract uses ReentrancyGuard from OpenZeppelin to prevent reentrancy attacks.
contract Staking is ReentrancyGuard, IStaking {
    IERC20 public stakingToken;
    ICrowdfunding public crowdfunding;

    /// Staking durations in seconds.
    uint256 public constant ONE_MONTH = 2592000;
    uint256 public constant THREE_MONTHS = ONE_MONTH * 3;
    uint256 public constant SIX_MONTHS = ONE_MONTH * 6;

    /// Rewards rates as a percentage for different staking durations.
    uint256 public constant REWARD_RATE_ONE_MONTH = 10;
    uint256 public constant REWARD_RATE_THREE_MONTHS = 15;
    uint256 public constant REWARD_RATE_SIX_MONTHS = 25;

    /// @notice A struct to store details of each stake.
    struct Stake {
        uint256 amount; // Amount of tokens staked
        uint256 startTime; // When the staking started
        uint256 duration; // Duration for which tokens are staked
    }

    /// Mapping from staker address to their stake details.
    mapping(address => Stake) public stakes;

    /// Events for staking, reinvesting rewards, and claiming rewards.
    event Staked(address indexed staker, uint256 amount, uint256 duration);
    event RewardReinvested(address indexed staker, uint256 campaignId, uint256 amount);
    event RewardClaimed(address indexed staker, uint256 amount);

    /// @notice Creates a new Staking contract instance.
    /// @param _stakingToken The ERC20 token that will be staked.
    /// @param _crowdfundingContract The crowdfunding contract with which the staked funds may interact.
    constructor(address _stakingToken, address _crowdfundingContract) {
        stakingToken = IERC20(_stakingToken);
        crowdfunding = ICrowdfunding(_crowdfundingContract);
    }

    /// @notice Allows a user to stake tokens for a specified duration.
    /// @param _amount The amount of tokens to stake.
    /// @param _duration The duration for which to stake the tokens.
    /// @dev Emits a Staked event on successful staking.
    function stakeTokens(uint256 _amount, uint256 _duration) external nonReentrant {
        require(_amount > 0, "Amount must be more than 0");
        require(_duration == ONE_MONTH || _duration == THREE_MONTHS || _duration == SIX_MONTHS, "Invalid staking duration");

        stakes[msg.sender] = Stake(_amount, block.timestamp, _duration);
        stakingToken.transferFrom(msg.sender, address(this), _amount);

        emit Staked(msg.sender, _amount, _duration);
    }

    /// @notice Calculates the reward for a staker based on their stake details.
    /// @param _staker The address of the staker.
    /// @return reward The calculated reward.
    /// @dev The reward is calculated as a percentage of the staked amount, prorated by the staking duration.
    function calculateReward(address _staker) public view returns (uint256) {
        Stake storage stake = stakes[_staker];
        uint256 rewardRate;

        if (stake.duration == ONE_MONTH) {
            rewardRate = REWARD_RATE_ONE_MONTH;
        } else if (stake.duration == THREE_MONTHS) {
            rewardRate = REWARD_RATE_THREE_MONTHS;
        } else if (stake.duration == SIX_MONTHS) {
            rewardRate = REWARD_RATE_SIX_MONTHS;
        }

        uint256 stakingPeriod = block.timestamp > (stake.startTime + stake.duration) ? stake.duration : block.timestamp - stake.startTime;
        uint256 reward = stake.amount * rewardRate * stakingPeriod / (ONE_MONTH * 12) / 100;

        return reward;
    }

    /// @notice Allows a staker to reinvest their rewards into a crowdfunding campaign.
    /// @param campaignId The ID of the crowdfunding campaign to invest in.
    /// @param bonusRate An additional bonus rate applied to the reinvested amount.
    /// @dev Emits a RewardReinvested event on successful reinvestment.
    function reinvestReward(uint256 campaignId, uint256 bonusRate) external nonReentrant {
        uint256 reward = calculateReward(msg.sender);
        require(reward > 0, "No rewards available");

        uint256 bonus = reward * bonusRate / 100;
        uint256 totalInvestment = reward + bonus;

        stakes[msg.sender].amount = 0;

        stakingToken.approve(address(crowdfunding), totalInvestment);
        crowdfunding.fundCampaignWithToken(campaignId, totalInvestment);

        emit RewardReinvested(msg.sender, campaignId, totalInvestment);
    }

    /// @notice Allows a staker to claim their accumulated rewards.
    /// @dev Emits a RewardClaimed event on successful claim.
    function claimReward() external nonReentrant {
        uint256 reward = calculateReward(msg.sender);
        require(reward > 0, "No rewards available");

        uint256 contractBalance = stakingToken.balanceOf(address(this));
        require(contractBalance >= reward, "Insufficient funds in the contract");

        stakes[msg.sender].amount = 0;
        stakes[msg.sender].startTime = 0;
        stakes[msg.sender].duration = 0;

        stakingToken.transfer(msg.sender, reward);

        emit RewardClaimed(msg.sender, reward);
    }

}
```

## Tests: staking.test.js

```javascript
const {expect} = require('chai');
const {ethers} = require('hardhat');

describe('Staking Contract', function () {
    let leafToken, crowdfunding, staking, stakingToken;
    let owner, addr1, addr2, addr3;
    let rewardRate;
    const ONE_MONTH = 2592000;
    const THREE_MONTHS = ONE_MONTH * 3;
    const SIX_MONTHS = ONE_MONTH * 6;


    beforeEach(async function () {
        [owner, addr1, addr2, addr3] = await ethers.getSigners();
        // Deploy ERC20 contract to simulate the staking token Dai
        const MockDai = await ethers.getContractFactory("MockDai");
        stakingToken = await MockDai.deploy(ethers.parseEther("1000000"));
        const LeafToken = await ethers.getContractFactory("LeafToken");
        leafToken = await LeafToken.deploy(ethers.parseEther("1000000"));
        const Crowdfunding = await ethers.getContractFactory("Crowdfunding");
        crowdfunding = await Crowdfunding.deploy(leafToken.target);
        const Staking = await ethers.getContractFactory("Staking");
        staking = await Staking.deploy(stakingToken.target, crowdfunding.target);
    });

    describe('Deployment', function () {
        it("Should set the right stakingToken", async function () {
            expect(await staking.stakingToken()).to.equal(stakingToken.target);
        });

        it("Should set the right crowdfunding contract", async function () {
            expect(await staking.crowdfunding()).to.equal(crowdfunding.target);
        });
    });

    describe('Staking', function () {
        it("Should not allow users to stake 0 tokens", async function () {
            await expect(staking.connect(addr1).stakeTokens(0, ONE_MONTH)).to.be.revertedWith("Amount must be more than 0");
        });

        it('Should revert if duration is different of one month or three months or six months', async function () {
            await expect(staking.connect(addr1).stakeTokens(ethers.parseEther("100"), 0)).to.be.revertedWith("Invalid staking duration");
        });

        it("Should allow users to stake tokens", async function () {
            const amount = ethers.parseEther("100");

            // Step 1: Transfer tokens to addr1
            await stakingToken.connect(owner).transfer(addr1.address, amount);

            // Verify the transfer
            expect(await stakingToken.balanceOf(addr1.address)).to.equal(amount);

            // Step 2: Approve the staking contract to spend the tokens
            await stakingToken.connect(addr1).approve(staking.target, amount);

            // Step 3: Index the tokens
            await staking.connect(addr1).stakeTokens(amount, ONE_MONTH);

            // Verify the stake
            const stake = await staking.stakes(addr1.address);
            expect(stake.amount).to.equal(amount);
            expect(stake.duration).to.equal(ONE_MONTH);

            expect(await stakingToken.balanceOf(staking.target)).to.equal(amount);
        });

        it('Should emit a Staked event', async function () {
            const amount = ethers.parseEther("100");
            await stakingToken.connect(owner).transfer(addr1.address, amount);
            await stakingToken.connect(addr1).approve(staking.target, amount);
            await expect(staking.connect(addr1).stakeTokens(amount, ONE_MONTH))
                .to.emit(staking, 'Staked')
                .withArgs(addr1.address, amount, ONE_MONTH);
        });
    });

    describe('Calculate Staking Rewards', function () {
        beforeEach(async function () {
            const amount = ethers.parseEther("100");
            await stakingToken.connect(owner).transfer(addr1.address, amount);
            await stakingToken.connect(addr1).approve(staking.target, amount);
            await staking.connect(addr1).stakeTokens(amount, ONE_MONTH);

            await stakingToken.connect(owner).transfer(addr2.address, amount);
            await stakingToken.connect(addr2).approve(staking.target, amount);
            await staking.connect(addr2).stakeTokens(amount, THREE_MONTHS);

            await stakingToken.connect(owner).transfer(addr3.address, amount);
            await stakingToken.connect(addr3).approve(staking.target, amount);
            await staking.connect(addr3).stakeTokens(amount, SIX_MONTHS);
        });

        it('Should calculate the staking reward for one month', async function () {
            const amount = ethers.parseEther("100");
            rewardRate = 10;

            // Simulate the passage of one month
            await ethers.provider.send("evm_increaseTime", [ONE_MONTH]); // Augmente le temps de 2592000 secondes (30 jours)
            await ethers.provider.send("evm_mine"); // Mine un nouveau bloc pour appliquer le changement de temps

            // Calculate the expected rewards
            const expectedRewards = BigInt(amount) * BigInt(rewardRate) / BigInt(100) * BigInt(ONE_MONTH) / BigInt(ONE_MONTH * 12);

            const actualRewards = await staking.calculateReward(addr1.address);

            expect(actualRewards).to.equal(expectedRewards);
        });

        it('Should calculate the staking reward for three month', async function () {
            const amount = ethers.parseEther("100");
            rewardRate = 15;

            // Simulate the passage of three months
            await ethers.provider.send("evm_increaseTime", [THREE_MONTHS]); // Augmente le temps de 2592000 secondes (30 jours)
            await ethers.provider.send("evm_mine"); // Mine un nouveau bloc pour appliquer le changement de temps

            // Calculating the expected rewards
            const expectedRewards = BigInt(amount) * BigInt(rewardRate) / BigInt(100) * BigInt(THREE_MONTHS) / BigInt(ONE_MONTH * 12);

            const actualRewards = await staking.calculateReward(addr2.address);

            expect(actualRewards).to.equal(expectedRewards);
        });

        it('Should calculate the staking reward for six month', async function () {
            const amount = ethers.parseEther("100");
            rewardRate = 25;

            // Simulate the passage of six months
            await ethers.provider.send("evm_increaseTime", [SIX_MONTHS]); // Augmente le temps de 2592000 secondes (30 jours)
            await ethers.provider.send("evm_mine"); // Mine un nouveau bloc pour appliquer le changement de temps

            // Calculating the expected rewards
            const expectedRewards = BigInt(amount) * BigInt(rewardRate) / BigInt(100) * BigInt(SIX_MONTHS) / BigInt(ONE_MONTH * 12);

            const actualRewards = await staking.calculateReward(addr3.address);

            expect(actualRewards).to.equal(expectedRewards);
        });
    });

    describe('Reinvest Reward', function () {
        let campaignId;
        const bonusRate = 10; // Assumes a 10% bonus

        beforeEach(async function () {
            const now = await ethers.provider.getBlock('latest').then(block => block.timestamp);
            const campaignStart = now + 300; // Start in 5 minutes
            const campaignEnd = campaignStart + 2592000; // Duration of 30 days

            await crowdfunding.createCampaign("Environmental Project", "A project to help reforest an area", ethers.parseEther("500"), campaignStart, campaignEnd, "https://example.com/image.png");
            campaignId = 0;

            // Index initiale et accumulation des récompenses
            const stakingAmount = ethers.parseEther("100");
            await stakingToken.transfer(addr1.address, stakingAmount);
            await stakingToken.connect(addr1).approve(staking.target, stakingAmount);
            await staking.connect(addr1).stakeTokens(stakingAmount, ONE_MONTH);

            // Simulate the passage of one month
            await ethers.provider.send("evm_increaseTime", [ONE_MONTH]);
            await ethers.provider.send("evm_mine");
        });

        it('Should reinvest the reward into a crowdfunding campaign', async function () {
            // Calculating the initial rewards
            const initialRewards = await staking.calculateReward(addr1.address);

            // Calculating the total investment expected
            const totalInvestmentExpected = BigInt(initialRewards) + BigInt(initialRewards) * BigInt(bonusRate) / BigInt(100);


            // Reinvest the rewards
            await staking.connect(addr1).reinvestReward(campaignId, bonusRate);

            // Check that the rewards were reinvested
            const campaignDetails = await crowdfunding.getCampaign(campaignId);

            // Ensure that the amount collected in the campaign has increased by the expected amount
            expect(campaignDetails.amountCollected).to.be.closeTo(totalInvestmentExpected, ethers.parseEther("0.01"), "The total investment after reinvestment does not match the expected amount");

            // Ensure that the stake amount was reset to 0
            const stakeDetails = await staking.stakes(addr1.address);
            expect(stakeDetails.amount).to.equal(0, "Index amount was not reset after reinvestment");
        });
    });



    describe('Withdraw Staking Rewards', function () {
        beforeEach(async function () {
            const now = await ethers.provider.getBlock('latest').then(block => block.timestamp);
            const campaignStart = now + 300; // Start in 5 minutes
            const campaignEnd = campaignStart + 2592000; // Duration of 30 days

            await crowdfunding.createCampaign("Environmental Project", "A project to help reforest an area", ethers.parseEther("500"), campaignStart, campaignEnd, "https://example.com/image.png");
            campaignId = 0;

            // Index initiale et accumulation des récompenses
            const stakingAmount = ethers.parseEther("100");
            await stakingToken.transfer(addr1.address, stakingAmount);
            await stakingToken.connect(addr1).approve(staking.target, stakingAmount);
            await staking.connect(addr1).stakeTokens(stakingAmount, ONE_MONTH);

            // Simulate the passage of one month
            await ethers.provider.send("evm_increaseTime", [ONE_MONTH]);
            await ethers.provider.send("evm_mine");
        });

        it('Should revert if reward is 0', async function () {
            await expect(staking.connect(addr2).claimReward()).to.be.revertedWith("No rewards available");
        });


        it('Should allow users to withdraw their staking rewards', async function () {
            // Step 1: Calculate the expected rewards
            const stakingAmount = ethers.parseEther("100");
            await stakingToken.connect(owner).transfer(addr1.address, stakingAmount);
            await stakingToken.connect(addr1).approve(staking.target, stakingAmount);
            await staking.connect(addr1).stakeTokens(stakingAmount, ONE_MONTH);

            // Step 2: Simulate the passage of one month
            await ethers.provider.send("evm_increaseTime", [ONE_MONTH]);
            await ethers.provider.send("evm_mine");

            // Step 3: Calculating the expected rewards
            const expectedRewards = await staking.calculateReward(addr1.address);

            // Step 4: Token balance before rewards withdrawal
            const balanceBefore = await stakingToken.balanceOf(addr1.address);

            // Step 5: Withdraw the rewards
            await staking.connect(addr1).claimReward();

            // Step 6: Token balance after rewards withdrawal
            const balanceAfter = await stakingToken.balanceOf(addr1.address);

            // Step 7: Verify that the rewards were received
            expect(balanceAfter - balanceBefore).to.equal(expectedRewards);

            // Step 8: Verify that the stake amount was reset to 0
            const stakeDetailsAfter = await staking.stakes(addr1.address);
            expect(stakeDetailsAfter.amount).to.equal(0);
        });
    });


});
```
