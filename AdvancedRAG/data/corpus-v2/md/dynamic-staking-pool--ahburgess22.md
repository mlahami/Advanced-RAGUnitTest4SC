# dynamic-staking-pool--ahburgess22

- domain: staking-yield (nft-staking)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ahburgess22/ERC721-Dynamic-Staking-Pool @ 647119f057c442aea38cb5531854113a687c2e92
- license: MIT
- targets: DynamicStakingPool.sol, MasterRegistry.sol, NFTCreator.sol, RewardToken.sol
- validation: 6 passing tests, 0 failing; statement coverage DynamicStakingPool.sol 97.14 %, MasterRegistry.sol 46.67 %, NFTCreator.sol 80.0 %, RewardToken.sol 80.0 %

## Contract: CompDefinitions.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

/**
 * @dev A library for defining key data structures used in the staking and NFT ecosystem.
 */
library StakeDefinitions {
    /**
     * @dev Structure representing a staked token.
     * @param tokenId The unique identifier of the staked token.
     * @param stakingTime The timestamp when the token was staked.
     * @param rarity The rarity of the token (e.g., "Common", "Rare", "Legendary").
     * @param level The level of the token, represented as an unsigned 8-bit integer.
     */
    struct Stake {
        uint256 tokenId;
        uint256 stakingTime;
        string rarity;
        uint8 level;
    }
}

library TokenDefinitions {
    /**
     * @dev Structure representing an NFT's attributes.
     * @param rarity The rarity of the NFT (e.g., "Common", "Rare", "Legendary").
     * @param level The level of the NFT, represented as an unsigned 8-bit integer.
     */
    struct NFT {
        string rarity;
        uint8 level;
    }
}
```

## Contract: DynamicStakingPool.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Import external libraries and contracts
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./NFTCreator.sol";
import "./RewardToken.sol";
import "./MasterRegistry.sol";
import "./StakingHelpers.sol";
import "./CompDefinitions.sol";

/**
 * @title Dynamic Staking Pool
 * @dev Manages NFT staking, rewards distribution, and integration with MasterRegistry.
 */
contract DynamicStakingPool is ERC721 {
    using StakeDefinitions for StakeDefinitions.Stake;
    using TokenDefinitions for TokenDefinitions.NFT;
    using TokenSupplyTracker for TokenSupplyTracker.SupplyTracker;

    // Events
    event Staked(address indexed owner, uint256 indexed tokenId, string rarity, uint8 level);
    event Unstaked(address indexed owner, uint256 indexed tokenId, uint256 reward);
    event UserStakesUpdated(address indexed owner, StakeDefinitions.Stake[] stakes);

    // Account structure to track user reward balances
    struct Account {
        uint256[] stakedNFTs;
        uint256 rewardBalance;
    }

    // Contract references
    NFT private nftContract;
    RewardToken private rewardToken;
    MasterRegistry private registry;

    // Staking data
    uint256 public totalStakes;
    mapping(address => Account) private accounts; // Tracks user reward balances
    mapping(address => StakeDefinitions.Stake[]) private stakes; // Tracks staked NFTs by user

    TokenSupplyTracker.SupplyTracker private _supplyTracker; // Supply tracking for stats

    /*
     * @dev Constructor to initialize staking pool.
     * @param nftContractAddress Address of the NFT contract.
     * @param rewardTokenAddress Address of the RewardToken contract.
     * @param registryAddress Address of the MasterRegistry contract.
     * @param poolName Name of the staking pool.
     */
    // Constructor
    constructor(address _nftCreatorAddress, address _rewardTokenAddress, address _registryAddress, string memory poolName) ERC721("Dynamic Stake Token", "DST") {
        nftContract = NFT(_nftCreatorAddress); // Set NFTCreator contract address during deployment
        rewardToken = RewardToken(_rewardTokenAddress);
        registry = MasterRegistry(_registryAddress);

        registry.registerPool(address(this), poolName); // Register pool in MasterRegistry
    }

    function createToken() external {

        // Generate a unique tokenId
        uint256 tokenId = uint256(keccak256(abi.encodePacked(
            msg.sender,
            block.timestamp,
            block.prevrandao,
            _supplyTracker.get()
        )));

        nftContract.createNFT(tokenId); // Create the NFT and store metadata
        _mint(msg.sender, tokenId); // Mint the token
        _supplyTracker.increment(); // Tracking total tokens in system
    }

    // ===========================
    // Core Functions
    // ===========================

    /**
     * @dev Stakes an NFT.
     * @param tokenId The ID of the NFT to stake.
     */
    function stake(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "DST: You must own the token to stake it.");

        // Transfer NFT to pool and retrieve metadata
        _transfer(msg.sender, address(registry), tokenId);
        TokenDefinitions.NFT memory metadata = nftContract.getToken(tokenId);

        // Record stake details
        stakes[msg.sender].push(
            StakeDefinitions.Stake(tokenId, block.timestamp, metadata.rarity, metadata.level)
        );
        totalStakes++;

        bool isRare = keccak256(abi.encodePacked(metadata.rarity)) == keccak256(abi.encodePacked("Rare"));
        bool isLegendary = keccak256(abi.encodePacked(metadata.rarity)) == keccak256(abi.encodePacked("Legendary"));

        // Update MasterRegistry based on rarity
        registry.updateStakes(address(this), 1, true, isRare, isLegendary);

        // Emit stake event
        emit Staked(msg.sender, tokenId, metadata.rarity, metadata.level);
        emit UserStakesUpdated(msg.sender, stakes[msg.sender]);
    }
    
    /**
    * @dev Unstakes an NFT.
    * @param tokenId The ID of the NFT to unstake.
    */
    function unstake(uint256 tokenId) external {
        require(StakeUtils.isStakedByUser(stakes[msg.sender], tokenId), "DST: Token not staked by user.");

        // Calculate rewards based on staked duration
        uint256 tokenStakedTime = stakes[msg.sender][StakeUtils.findStakedIndex(stakes[msg.sender], tokenId)].stakingTime;
        uint256 stakedDuration = block.timestamp - tokenStakedTime;
        uint256 reward = _calculateReward(tokenId, stakedDuration);

        // Transfer the NFT back to the user
        _transfer(address(registry), msg.sender, tokenId);

        // Update user's reward balance and mint reward tokens
        accounts[msg.sender].rewardBalance += reward;
        rewardToken.mint(msg.sender, reward);

        // Remove the staked NFT and decrease the total stakes
        removeStakedToken(msg.sender, tokenId);
        totalStakes -= 1;

        // Update MasterRegistry based on rarity
        TokenDefinitions.NFT memory metadata = nftContract.getToken(tokenId);
        bool isRare = keccak256(abi.encodePacked(metadata.rarity)) == keccak256(abi.encodePacked("Rare"));
        bool isLegendary = keccak256(abi.encodePacked(metadata.rarity)) == keccak256(abi.encodePacked("Legendary"));
        registry.updateStakes(address(this), 1, false, isRare, isLegendary);

        // Emit the unstake event
        emit Unstaked(msg.sender, tokenId, reward);
    }

    /**
    * @dev Calculates reward for a staked NFT based on its duration and metadata.
    * @param tokenId The ID of the staked NFT.
    * @param duration The duration for which the NFT was staked.
    * @return reward The calculated reward amount.
    */
    function _calculateReward(uint256 tokenId, uint256 duration) internal view returns (uint256) {
        uint256 reward = Rewards.calculateReward(duration);
        reward *= Rewards.levelCoefficient(nftContract.getToken(tokenId).level);
        reward *= Rewards.rarityCoefficient(nftContract.getToken(tokenId).rarity);
        return reward;
    }

    /**
    * @dev Removes a staked token from the user's stake array.
    * @param owner The address of the user who staked the token.
    * @param tokenId The ID of the staked token to remove.
    */
    function removeStakedToken(address owner, uint256 tokenId) internal {
        uint256 index = StakeUtils.findStakedIndex(stakes[owner], tokenId);
        stakes[owner][index] = stakes[owner][stakes[owner].length-1]; // Moves unstaked token to end of stakes
        stakes[owner].pop(); // Removes unstaked token
    }

    /**
    * @dev Returns the address of the NFT creator contract.
    * @return The NFT creator contract address.
    */
    function getNFTCreatorAddress() external view returns (address) {
        return address(nftContract);
    }

    /**
    * @dev Returns the list of staked token IDs for a user.
    * @return tokenIds An array of token IDs staked by the user.
    */
    function getUserStakes() public view returns (uint256[] memory) {
        uint256[] memory tokenIds = new uint256[](stakes[msg.sender].length);
        for (uint256 i = 0; i < stakes[msg.sender].length; i++) {
            tokenIds[i] = stakes[msg.sender][i].tokenId;
        }
        return tokenIds;
        }

    /**
    * @dev Returns the RTK balance of a user
    * @param user The address of the user.
    * @return The reward balance of the user.
    */
    function getRewardBalance(address user) public view returns (uint256) {
        return accounts[user].rewardBalance;
    }
}
```

## Contract: MasterRegistry.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./RegistryHelpers.sol";

/**
 * @title MasterRegistry
 * @dev Centralized registry to manage staking pools, reward rates, and validation logic.
 */
contract MasterRegistry {
    // Struct to store pool data
    struct PoolData {
        address owner;
        string name;
        uint256 totalStakes;
        uint256 createdAt;
        uint256 rareNFTs;
        uint256 legendaryNFTs;
        uint256 stakingPower;
    }

    // Mappings and state variables
    mapping(address => PoolData) public registeredPools; // Maps pool address to its data
    address[] public poolAddresses; // Array to track pool addresses
    uint256 public globalStakes; // Tracks total stakes across all pools
    uint256 public globalStakingPower; // Aggregated staking power across all pools

    uint public baseReward = BaseReward.calculateBaseReward(); // Initial base reward
    uint public globalPools = 0; // Total number of pools
    address public lastWinnerAddress; // Tracks the last winning pool for validation

    // Events for state updates
    event PoolRegistered(uint256 globalPools, address indexed pool, address indexed owner, string name);
    event PoolStakesUpdated(string poolName, address indexed pool, uint256 totalStakes);
    event GlobalStakesUpdated(uint256 globalStakes, address indexed pool);
    event RewardRateUpdated(uint256 baseReward, uint256 globalPools, uint256 globalStakes);
    event WinnerSelected(string winningPool, uint256 stakingPower, uint256 globalStakingPower);

    /**
     * @dev Registers a new pool.
     * @param poolAddress The address of the staking pool.
     * @param name The name of the pool.
     */
    function registerPool(address poolAddress, string memory name) external {
        require(registeredPools[poolAddress].owner == address(0), "Master Registry: Invalid pool address or already registered.");

        registeredPools[poolAddress] = PoolData(msg.sender, name, 0, block.timestamp, 0, 0, 0);
        poolAddresses.push(poolAddress);
        globalPools++;

        emit PoolRegistered(globalPools, poolAddress, msg.sender, name);
    }

    /**
     * @dev Updates stakes, staking power, and global state for a pool.
     * @param poolAddress The address of the pool.
     * @param stakesDelta The amount of stakes to add or remove.
     * @param isAdding Indicates if stakes are being added (true) or removed (false).
     * @param isRare Whether the staked NFT is rare.
     * @param isLegendary Whether the staked NFT is legendary.
     */
    function updateStakes(address poolAddress, uint256 stakesDelta, bool isAdding, bool isRare, bool isLegendary) external {
        require(registeredPools[poolAddress].owner != address(0), "Master Registry: Pool not registered.");

        if (isAdding) {
            registeredPools[poolAddress].totalStakes += stakesDelta;
            globalStakes += stakesDelta;

            if (isRare) registeredPools[poolAddress].rareNFTs++;
            if (isLegendary) registeredPools[poolAddress].legendaryNFTs++;
        } else {
            require(registeredPools[poolAddress].totalStakes >= stakesDelta, "Master Registry: Insufficient stakes to remove.");
            require(globalStakes >= stakesDelta, "Master Registry: Insufficient global stakes.");

            registeredPools[poolAddress].totalStakes -= stakesDelta;
            globalStakes -= stakesDelta;

            if (isRare) registeredPools[poolAddress].rareNFTs--;
            if (isLegendary) registeredPools[poolAddress].legendaryNFTs--;
        }

        uint256 newStakingPower = PoolWeight.calculatePoolStakingPower(
            registeredPools[poolAddress].rareNFTs,
            registeredPools[poolAddress].legendaryNFTs,
            registeredPools[poolAddress].totalStakes
        );

        globalStakingPower = globalStakingPower - registeredPools[poolAddress].stakingPower + newStakingPower;
        registeredPools[poolAddress].stakingPower = newStakingPower;

        emit PoolStakesUpdated(registeredPools[poolAddress].name, poolAddress, registeredPools[poolAddress].totalStakes);
        emit GlobalStakesUpdated(globalStakes, poolAddress);
    }

    /**
     * @dev Retrieves data for a specific pool.
     * @param poolAddress The address of the pool.
     * @return name The name of the pool.
     * @return totalStakes Total stakes in the pool.
     * @return createdAt Timestamp when the pool was created.
     */
    function getPoolData(address poolAddress) external view returns (string memory name, uint256 totalStakes, uint256 createdAt) {
        require(registeredPools[poolAddress].owner != address(0), "Master Registry: Pool not registered.");
        return (
            registeredPools[poolAddress].name,
            registeredPools[poolAddress].totalStakes,
            registeredPools[poolAddress].createdAt
        );
    }

    /**
     * @dev Updates the global reward rate based on stakes and pools.
     * @param _baseReward The new base reward.
     * @param _globalPools The number of global pools.
     * @param _globalStakes The total global stakes.
     */
    function updateRewardRate(uint256 _baseReward, uint256 _globalPools, uint256 _globalStakes) public {
        baseReward = RewardRate.updateRewardRate(_baseReward, _globalPools, _globalStakes);
        emit RewardRateUpdated(baseReward, globalPools, globalStakes);
    }

    /**
     * @dev Retrieves the current base reward.
     * @return The current base reward.
     */
    function getBaseReward() public view returns (uint256) {
        return baseReward;
    }

    /**
     * @dev Selects a winner for validation based on staking power.
     * @return The name of the winning pool.
     */
    function getWinner() public returns (string memory) {
        require(globalPools > 1 && registeredPools[poolAddresses[0]].stakingPower < globalStakingPower, "Master Registry: No competing pools or stakes.");

        uint attempts = 0; // Safety to prevent infinite loops
        uint winningNum = Validator.getValidationKey(globalStakingPower);

        while (attempts < globalStakes * 2) {
            uint total = 0;
            for (uint i = 0; i < poolAddresses.length; i++) {
                total += registeredPools[poolAddresses[i]].stakingPower;
                if (total > winningNum) {
                    if (poolAddresses[i] == lastWinnerAddress) {
                        attempts++;
                        break; // Retry if the winning pool was also the last winner
                    }

                    emit WinnerSelected(registeredPools[poolAddresses[i]].name, registeredPools[poolAddresses[i]].stakingPower, globalStakingPower);

                    lastWinnerAddress = poolAddresses[i];
                    baseReward = BaseReward.calculateBaseReward();
                    updateRewardRate(baseReward, globalPools, globalStakes);
                    return registeredPools[poolAddresses[i]].name;
                }
            }
        }

        revert("Master Registry: Unable to select a valid winner. Try again.");
    }
}
```

## Contract: NFTCreator.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "./CompDefinitions.sol";

contract NFT {
    using TokenDefinitions for TokenDefinitions.NFT;

    event LegendaryPull(string message);

    mapping(uint256 => TokenDefinitions.NFT) private tokens;

    /**
     * @dev Creates an NFT with a rarity and level based on the provided tokenId.
     * Emits a `LegendaryPull` event if a Legendary NFT is created.
     * @param tokenId The unique identifier for the NFT.
     */
    function createNFT(uint256 tokenId) external {
        string memory rarity = _determineRarity(tokenId);
        uint8 level = _calculateLevel(tokenId);

        tokens[tokenId] = TokenDefinitions.NFT({
            rarity: rarity,
            level: level
        });
    }

    /**
     * @dev Retrieves the NFT details for a given tokenId.
     * @param tokenId The unique identifier for the NFT.
     * @return The NFT details as a `TokenDefinitions.NFT` struct.
     */
    function getToken(uint256 tokenId) external view returns (TokenDefinitions.NFT memory) {
        return tokens[tokenId];
    }

    /**
     * @dev Determines the rarity of an NFT based on its tokenId.
     * Emits a `LegendaryPull` event if the rarity is Legendary.
     * @param tokenId The unique identifier for the NFT.
     * @return The rarity as a string ("Legendary", "Rare", or "Common").
     */
    function _determineRarity(uint256 tokenId) internal returns (string memory) {
        if (tokenId % 100 < 10) {
            emit LegendaryPull("LEGENDARY NFT PULL!");
            return "Legendary";
        } else if (tokenId % 100 < 40) {
            return "Rare";
        } else {
            return "Common";
        }
    }

    /**
     * @dev Calculates the level of an NFT based on its tokenId.
     * @param tokenId The unique identifier for the NFT.
     * @return The level as an unsigned 8-bit integer.
     */
    function _calculateLevel(uint256 tokenId) internal pure returns (uint8) {
        return uint8(tokenId % 100);
    }
}
```

## Contract: RegistryHelpers.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

/// @title Registry Helpers - Utility Libraries for Pool and Reward Calculations

/// @notice Calculates the base reward using a deterministic formula
library BaseReward {
    function calculateBaseReward() internal view returns (uint256) {
        // Base reward calculation modded to 100 for reward scaling
        return uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, address(this)))) % 100;
    }
}

/// @notice Handles dynamic reward rate updates based on pool activity
library RewardRate {
    function updateRewardRate(uint256 baseReward, uint256 pools, uint256 stakes) internal pure returns (uint256) {
        // Reward rate increases if pools and stakes exist, otherwise defaults to 0
        uint256 activityMultiplier = pools > 1 ? (pools * 2) + (stakes / 10) : 1; // Higher pools and takes increase multiplier
        uint256 baseBonus = baseReward / 50; // Reward tied to base randomness (e.g., 2%)
        uint256 calculatedReward = (baseReward / 10) * activityMultiplier + baseBonus;

        return calculatedReward > 10000 ? 10000 : calculatedReward;
    }
}

/// @notice Manages staking power calculations based on token rarity
library PoolWeight {
    function calculatePoolStakingPower(uint256 rares, uint256 legendaries, uint256 tokens) internal pure returns (uint256) {
        // Weighting rarities: rares count double, legendaries quadruple
        return tokens + (rares * 2) + (legendaries * 4);
    }
}

/// @notice Validates operations using the global staking power
library Validator {
    function getValidationKey(uint256 globalStakingPower) internal view returns (uint256) {
        // Deterministic validation key based on global staking power
        return uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, address(this)))) % globalStakingPower;
    }
}
```

## Contract: RewardToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Importing OpenZeppelin contracts for ERC20 functionality, caps, and ownership control
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RewardToken
 * @dev ERC20 token with a capped supply, restricted minting by staking contract, and ownership control.
 */
contract RewardToken is ERC20, ERC20Capped, Ownable {
    // Address of the authorized staking contract
    address private _stakingContract;

    /**
     * @dev Constructor to initialize the RewardToken with name, symbol, and capped supply.
     * @param maxSupply The maximum supply of the token (scaled by 10^18 for decimals).
     */
    constructor(uint256 maxSupply) ERC20("Reward Token", "RTK") ERC20Capped(maxSupply) Ownable(msg.sender) { }

    /**
     * @dev Internal function to handle token updates during transfers.
     * @param from The address transferring tokens.
     * @param to The address receiving tokens.
     * @param amount The amount of tokens being transferred.
     */
    function _update(address from, address to, uint256 amount) internal virtual override(ERC20, ERC20Capped) {
        super._update(from, to, amount); // Calls parent implementation
    }

    /**
     * @dev Public wrapper for testing internal _update functionality.
     * @param from The address transferring tokens.
     * @param to The address receiving tokens.
     * @param amount The amount of tokens being transferred.
     */
    function testUpdate(address from, address to, uint256 amount) public {
        _update(from, to, amount);
    }

    /**
     * @dev Mints new tokens.
     * @param to The address receiving the minted tokens.
     * @param amount The amount of tokens to mint.
     * Requirements:
     * - Only the staking contract can call this function.
     * - Total supply must not exceed the cap.
     */
    function mint(address to, uint256 amount) public onlyAuthorized {
        require(totalSupply() + amount <= cap(), "RTK: ERC20 cap exceeded.");
        _mint(to, amount);
    }

    function setAuthorizedStaker(address stakingContract) public onlyOwner {
        _stakingContract = stakingContract;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == owner() || msg.sender == _stakingContract,
            "RTK: Unauthorized"
        );
        _;
    }

    
}
```

## Contract: StakingHelpers.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "./CompDefinitions.sol";

library Rewards {
    /// @notice Calculates rewards based on staking duration.
    /// @param stakedDuration Time (in seconds) for which the token was staked.
    /// @return reward Calculated reward.
    function calculateReward(uint256 stakedDuration) internal pure returns (uint256) {
        uint256 reward = (stakedDuration / 60) * 10; // Reward: +10 RewardToken per minute
        return reward > 500 ? 500 : reward;       // Cap rewards at 500
    }

    /// @notice Computes level-based reward coefficient.
    /// @param level NFT's level.
    /// @return Coefficient based on level.
    function levelCoefficient(uint256 level) internal pure returns (uint256) {
        return (1 + (100 - level) / 10); // 10% increase per level decrement
    }

    /// @notice Computes rarity-based reward multiplier.
    /// @param rarity Rarity of the NFT ("Legendary", "Rare", or "Common").
    /// @return Multiplier based on rarity.
    function rarityCoefficient(string memory rarity) internal pure returns (uint256) {
        if (compareStrings(rarity, "Legendary")) {
            return 3;
        } else if (compareStrings(rarity, "Rare")) {
            return 2;
        } else {
            return 1; // Default for "Common"
        }
    }

    /// @notice Compares two strings for equality.
    /// @param tokenRarity First string.
    /// @param rarity Second string.
    /// @return True if strings are equal, false otherwise.
    function compareStrings(string memory tokenRarity, string memory rarity) internal pure returns (bool) {
        return keccak256(abi.encodePacked(tokenRarity)) == keccak256(abi.encodePacked(rarity));
    }
}

library StakeUtils {
    /// @notice Checks if a token is staked by the user.
    /// @param userStakes List of staked tokens.
    /// @param tokenId Token ID to check.
    /// @return True if token is staked, false otherwise.
    function isStakedByUser(StakeDefinitions.Stake[] memory userStakes, uint256 tokenId) internal pure returns (bool) {
        for (uint256 i = 0; i < userStakes.length; i++) {
            if (userStakes[i].tokenId == tokenId) {
                return true;
            }
        }
        return false;
    }

    /// @notice Finds the index of a token in the user's stakes.
    /// @param ownerStakes List of staked tokens.
    /// @param tokenId Token ID to find.
    /// @return Index of the token.
    function findStakedIndex(StakeDefinitions.Stake[] memory ownerStakes, uint256 tokenId) internal pure returns (uint256) {
        for (uint256 i = 0; i < ownerStakes.length; i++) {
            if (ownerStakes[i].tokenId == tokenId) {
                return i;
            }
        }
        revert("DST: Token not found.");
    }
}

library TokenSupplyTracker {
    struct SupplyTracker {
        uint256 totalSupply;
    }

    /// @notice Increments the total token supply.
    /// @param tracker Storage reference to the supply tracker.
    function increment(SupplyTracker storage tracker) internal {
        tracker.totalSupply++;
    }

    /// @notice Gets the current total token supply.
    /// @param tracker Storage reference to the supply tracker.
    /// @return Total supply value.
    function get(SupplyTracker storage tracker) internal view returns (uint256) {
        return tracker.totalSupply;
    }
}
```

## Tests: DynamicStakingPool.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DynamicStakingPool", function () {
    let MasterRegistry, DynamicStakingPool;
    let registry, stakingPool, rewardToken, nftContract;
    let owner, user1, user2, snapshotId;
    const poolName = "Test";
    const MAX_SUPPLY = ethers.parseEther("1000000");

    beforeEach(async function () {
        snapshotId = await ethers.provider.send("evm_snapshot", []);

        // Get the contract factories and signers
        [owner, user1, user2] = await ethers.getSigners();
    
        MasterRegistry = await ethers.getContractFactory("MasterRegistry");
        const RewardToken = await ethers.getContractFactory("RewardToken");
        const NFTCreator = await ethers.getContractFactory("NFT");
        DynamicStakingPool = await ethers.getContractFactory("DynamicStakingPool");
    
        // Deploy MasterRegistry
        registry = await MasterRegistry.deploy();
    
        // Deploy RewardToken
        rewardToken = await RewardToken.deploy(MAX_SUPPLY);
    
        // Deploy NFTCreator
        nftContract = await NFTCreator.deploy();

        // Deploy DynamicStakingPool with references to all dependencies
        stakingPool = await DynamicStakingPool.deploy(
            nftContract.target,
            rewardToken.target,
            registry.target,
            poolName
        );
    });
    
    afterEach(async () => {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    it("Should register itself in the MasterRegistry upon deployment", async function () {
        const name = poolName
        await registry.registerPool(stakingPool.runner.address, name);
        const registered = await registry.registeredPools(stakingPool.runner.address);
        expect(registered.owner).to.equal(owner.address);
    });

    it("Should allow a user to stake a token", async function () {
        // Mint a NFT for user1
        const tx = await stakingPool.connect(user1).createToken();
        const receipt = await tx.wait();

        // Parse the logs to find the mintedToken event
        const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
        const transferLog = receipt.logs.find(log => log.topics[0] === transferEventSignature);
        const tokenId = transferLog.args[2];
    
        // Stake the NFT
        await stakingPool.connect(user1).stake(tokenId);
    
        // Validate staking updates
        const stakes = await stakingPool.connect(user1).getUserStakes();
        expect(stakes.length).to.be.greaterThan(0);
        const registered = await registry.registeredPools(stakingPool.target);
        expect(registered.totalStakes).to.equal(1);
    });
     

    it("Should calculate and distribute rewards when a user unstakes", async function () {
        // Mint a NFT for user1
        const tx = await stakingPool.connect(owner).createToken();
        const receipt = await tx.wait();

        // Parse the logs to find the mintedToken event
        const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
        const transferLog = receipt.logs.find(log => log.topics[0] === transferEventSignature);
        const tokenId = transferLog.args[2];
    
        // Stake the NFT
        await stakingPool.connect(owner).stake(tokenId);

        // Unstake the NFT and mint RTKs after establishing stakingContract
        await rewardToken.setAuthorizedStaker(stakingPool);
        await stakingPool.unstake(tokenId);

        // Validate rewards
        const rewardBalance = await stakingPool.getRewardBalance(owner.address);
        expect(rewardBalance).to.be.equal(0); // Rewards don't accumulate until a minute has passed

        const registered = await registry.registeredPools(stakingPool.target);
        expect(registered.totalStakes).to.equal(0);
    });

    it("Should prevent unstaking a token not owned by the caller", async function () {
        // Mint a NFT for user1
        const tx = await stakingPool.connect(user1).createToken();
        const receipt = await tx.wait();

        // Parse the logs to find the mintedToken event
        const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
        const transferLog = receipt.logs.find(log => log.topics[0] === transferEventSignature);
        const tokenId = transferLog.args[2];

        // Stake the NFT with a user
        await stakingPool.connect(user1).stake(tokenId);

        // Try to unstake with a different user
        await expect(stakingPool.connect(user2).unstake(tokenId)).to.be.revertedWith("DST: Token not staked by user.");
    });

    it("Should prevent double-staking the same token", async function () {
        // Mint a NFT for user1
        const tx = await stakingPool.connect(user1).createToken();
        const receipt = await tx.wait();

        // Parse the logs to find the mintedToken event
        const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
        const transferLog = receipt.logs.find(log => log.topics[0] === transferEventSignature);
        const tokenId = transferLog.args[2];

        // Stake the NFT with a user
        await stakingPool.connect(user1).stake(tokenId);

        // Try to stake the same NFT again
        await expect(stakingPool.connect(user1).stake(tokenId)).to.be.revertedWith("DST: You must own the token to stake it.");
    });

    it("Should handle multiple users staking and unstaking", async function () {
        // Mint NFTs for user1 and user2
        const tx = await stakingPool.connect(user1).createToken();
        const receipt1 = await tx.wait();
        const tx2 = await stakingPool.connect(user2).createToken();
        const receipt2 = await tx2.wait();

        // Parse the logs to find the mintedToken event
        const transferEventSignature1 = ethers.id("Transfer(address,address,uint256)");
        const transferLog1 = receipt1.logs.find(log => log.topics[0] === transferEventSignature1);
        const tokenId1 = transferLog1.args[2];
        
        const transferEventSignature2 = ethers.id("Transfer(address,address,uint256)");
        const transferLog2 = receipt2.logs.find(log => log.topics[0] === transferEventSignature2);
        const tokenId2 = transferLog2.args[2];

        // Stake NFTs
        await stakingPool.connect(user1).stake(tokenId1);
        await stakingPool.connect(user2).stake(tokenId2);

        // Validate total stakes
        const registered = await registry.registeredPools(stakingPool.target);
        expect(registered.totalStakes).to.equal(2);

        // Users unstake NFTs and mint RTKs after establishing stakingContract
        await rewardToken.setAuthorizedStaker(stakingPool);
        await stakingPool.connect(user1).unstake(tokenId1);
        await stakingPool.connect(user2).unstake(tokenId2);

        const registeredAfterUnstake = await registry.registeredPools(stakingPool.target);
        expect(registeredAfterUnstake.totalStakes).to.equal(0);
    });
});
```
