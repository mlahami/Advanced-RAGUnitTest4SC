// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Stake an ERC-20, earn more of the same token at a rate the owner sets.
/// Checks-effects-interactions + ReentrancyGuard. Lab contract, not audited for mainnet.
contract StakingVault is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint256 public rewardRate; // tokens per second, distributed across totalStaked
    uint256 public lastUpdate;
    uint256 public rewardPerTokenStored;
    uint256 public totalStaked;

    mapping(address => uint256) public staked;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 amount);
    event RewardRateSet(uint256 rate);

    constructor(IERC20 token_, uint256 rewardRate_) Ownable(msg.sender) {
        token = token_;
        rewardRate = rewardRate_;
        lastUpdate = block.timestamp;
    }

    function setRewardRate(uint256 rate) external onlyOwner {
        _update(address(0));
        rewardRate = rate;
        emit RewardRateSet(rate);
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored +
            ((block.timestamp - lastUpdate) * rewardRate * 1e18) /
            totalStaked;
    }

    function earned(address account) public view returns (uint256) {
        return
            (staked[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) /
            1e18 +
            rewards[account];
    }

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "amount=0");
        _update(msg.sender);
        totalStaked += amount;
        staked[msg.sender] += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "amount=0");
        require(staked[msg.sender] >= amount, "too much");
        _update(msg.sender);
        totalStaked -= amount;
        staked[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function getReward() external nonReentrant {
        _update(msg.sender);
        uint256 payout = rewards[msg.sender];
        if (payout == 0) {
            return;
        }
        rewards[msg.sender] = 0;
        token.safeTransfer(msg.sender, payout);
        emit RewardPaid(msg.sender, payout);
    }

    function _update(address account) internal {
        rewardPerTokenStored = rewardPerToken();
        lastUpdate = block.timestamp;
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
    }
}
