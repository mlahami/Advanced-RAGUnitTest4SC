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