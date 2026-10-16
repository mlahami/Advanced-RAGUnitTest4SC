// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

interface IStaking {
    function stakeTokens(uint256 _amount, uint256 _duration) external;
    function calculateReward(address _staker) external view returns (uint256);
    function reinvestReward(uint256 campaignId, uint256 bonusRate) external;
    function claimReward() external;
}
