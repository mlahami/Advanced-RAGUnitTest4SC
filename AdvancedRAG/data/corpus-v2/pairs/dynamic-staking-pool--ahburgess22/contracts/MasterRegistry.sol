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