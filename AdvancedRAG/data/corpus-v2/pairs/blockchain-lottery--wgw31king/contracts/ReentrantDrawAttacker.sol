// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./BlockchainLottery.sol";

contract ReentrantDrawAttacker {
    BlockchainLottery public immutable lottery;
    bool public attemptedReentry;
    bool public reentrySucceeded;

    constructor(address lotteryAddress) {
        lottery = BlockchainLottery(lotteryAddress);
    }

    function triggerDraw(address[] calldata winners, uint256[] calldata weights) external {
        lottery.drawAndDistribute(winners, weights);
    }

    receive() external payable {
        if (attemptedReentry) return;
        attemptedReentry = true;

        address[] memory winners = new address[](1);
        uint256[] memory weights = new uint256[](1);
        winners[0] = address(this);
        weights[0] = 1;

        (bool ok,) = address(lottery).call(
            abi.encodeWithSelector(lottery.drawAndDistribute.selector, winners, weights)
        );
        if (ok) {
            reentrySucceeded = true;
        }
    }
}
