// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract BlockchainLottery is Ownable, ReentrancyGuard {
    error BettingIsClosed();
    error BettingStillOpen();
    error AlreadySettled();
    error InvalidBetAmount();
    error InvalidInput();
    error TransferFailed(address to, uint256 amount);

    event BetPlaced(address indexed user, uint256 amount, uint256 userTotalStake, uint256 poolTotal);
    event BettingClosed(uint256 timestamp);
    event WinnersDrawn(address[] winners, uint256[] weights, uint256 totalPool);
    event PrizePaid(address indexed winner, uint256 amount);
    event DistributionCompleted(uint256 distributedTotal);

    uint256 public immutable minBetAmount;
    bool public bettingOpen = true;
    bool public settled;
    uint256 public totalPool;

    mapping(address => uint256) public stakes;

    constructor(uint256 _minBetAmount, address initialOwner) Ownable(initialOwner) {
        if (_minBetAmount == 0 || initialOwner == address(0)) {
            revert InvalidInput();
        }
        minBetAmount = _minBetAmount;
    }

    function placeBet() external payable nonReentrant {
        if (!bettingOpen) revert BettingIsClosed();
        if (settled) revert AlreadySettled();
        if (msg.value < minBetAmount) revert InvalidBetAmount();

        stakes[msg.sender] += msg.value;
        totalPool += msg.value;

        emit BetPlaced(msg.sender, msg.value, stakes[msg.sender], totalPool);
    }

    function closeBetting() external onlyOwner {
        if (!bettingOpen) revert BettingIsClosed();
        bettingOpen = false;
        emit BettingClosed(block.timestamp);
    }

    function drawAndDistribute(address[] calldata winners, uint256[] calldata weights)
        external
        onlyOwner
        nonReentrant
    {
        if (bettingOpen) revert BettingStillOpen();
        if (settled) revert AlreadySettled();
        if (winners.length == 0 || winners.length != weights.length) {
            revert InvalidInput();
        }

        uint256 totalWeight;
        uint256 winnersLength = winners.length;

        for (uint256 i = 0; i < winnersLength; i++) {
            if (winners[i] == address(0) || weights[i] == 0) revert InvalidInput();

            // O(n^2) duplicate protection for explicit and auditable behavior.
            for (uint256 j = i + 1; j < winnersLength; j++) {
                if (winners[i] == winners[j]) revert InvalidInput();
            }
            totalWeight += weights[i];
        }
        if (totalWeight == 0) revert InvalidInput();

        settled = true;
        uint256 poolSnapshot = totalPool;
        uint256 distributedTotal;

        emit WinnersDrawn(winners, weights, poolSnapshot);

        for (uint256 i = 0; i < winnersLength; i++) {
            uint256 prize;
            if (i == winnersLength - 1) {
                // Assign residual dust to last winner to guarantee full distribution.
                prize = poolSnapshot - distributedTotal;
            } else {
                prize = (poolSnapshot * weights[i]) / totalWeight;
                distributedTotal += prize;
            }

            (bool sent,) = payable(winners[i]).call{value: prize}("");
            if (!sent) revert TransferFailed(winners[i], prize);

            emit PrizePaid(winners[i], prize);
        }

        emit DistributionCompleted(poolSnapshot);
    }
}
