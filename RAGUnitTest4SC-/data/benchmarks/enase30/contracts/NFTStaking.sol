// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title NFTStaking
 * @notice Stake ERC721 NFTs to earn ERC20 reward tokens per second.
 *         Rewards are proportional to the number of NFTs staked.
 * Complexity: Complex
 */
interface IERC721Min {
    function transferFrom(address from, address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IRewardToken {
    function mint(address to, uint256 amount) external;
}

contract NFTStaking {
    IERC721Min  public immutable nftContract;
    IRewardToken public immutable rewardToken;

    uint256 public rewardRate;    // reward tokens per second per NFT (scaled Ã—1e18)
    address public owner;

    struct StakeInfo {
        uint256[] tokenIds;
        uint256   lastUpdateTime;
        uint256   accruedRewards;
    }

    mapping(address => StakeInfo)   public stakes;
    mapping(uint256 => address)     public stakedBy;   // tokenId â†’ staker

    event Staked(address indexed staker, uint256[] tokenIds);
    event Unstaked(address indexed staker, uint256[] tokenIds);
    event RewardClaimed(address indexed staker, uint256 amount);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    constructor(address _nft, address _rewardToken, uint256 _rewardRate) {
        nftContract  = IERC721Min(_nft);
        rewardToken  = IRewardToken(_rewardToken);
        rewardRate   = _rewardRate;
        owner        = msg.sender;
    }

    // â”€â”€â”€ Stake â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function stake(uint256[] calldata tokenIds) external {
        _updateRewards(msg.sender);
        StakeInfo storage s = stakes[msg.sender];

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 id = tokenIds[i];
            require(nftContract.ownerOf(id) == msg.sender, "Not owner");
            require(stakedBy[id] == address(0), "Already staked");
            nftContract.transferFrom(msg.sender, address(this), id);
            stakedBy[id] = msg.sender;
            s.tokenIds.push(id);
        }

        emit Staked(msg.sender, tokenIds);
    }

    // â”€â”€â”€ Unstake â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function unstake(uint256[] calldata tokenIds) external {
        _updateRewards(msg.sender);
        StakeInfo storage s = stakes[msg.sender];

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 id = tokenIds[i];
            require(stakedBy[id] == msg.sender, "Not your token");
            stakedBy[id] = address(0);
            _removeTokenId(s.tokenIds, id);
            nftContract.transferFrom(address(this), msg.sender, id);
        }

        emit Unstaked(msg.sender, tokenIds);
    }

    // â”€â”€â”€ Claim rewards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function claimRewards() external {
        _updateRewards(msg.sender);
        uint256 reward = stakes[msg.sender].accruedRewards;
        require(reward > 0, "No rewards");
        stakes[msg.sender].accruedRewards = 0;
        rewardToken.mint(msg.sender, reward);
        emit RewardClaimed(msg.sender, reward);
    }

    // â”€â”€â”€ Views â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function pendingRewards(address staker) external view returns (uint256) {
        StakeInfo storage s = stakes[staker];
        uint256 elapsed = block.timestamp - s.lastUpdateTime;
        uint256 accrued = (s.tokenIds.length * elapsed * rewardRate) / 1e18;
        return s.accruedRewards + accrued;
    }

    function stakedTokens(address staker) external view returns (uint256[] memory) {
        return stakes[staker].tokenIds;
    }

    // â”€â”€â”€ Admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function setRewardRate(uint256 rate) external onlyOwner {
        rewardRate = rate;
    }

    // â”€â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function _updateRewards(address staker) internal {
        StakeInfo storage s = stakes[staker];
        if (s.lastUpdateTime == 0) { s.lastUpdateTime = block.timestamp; return; }
        uint256 elapsed = block.timestamp - s.lastUpdateTime;
        s.accruedRewards   += (s.tokenIds.length * elapsed * rewardRate) / 1e18;
        s.lastUpdateTime    = block.timestamp;
    }

    function _removeTokenId(uint256[] storage arr, uint256 id) internal {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == id) {
                arr[i] = arr[arr.length - 1];
                arr.pop();
                return;
            }
        }
        revert("Token not found");
    }
}

