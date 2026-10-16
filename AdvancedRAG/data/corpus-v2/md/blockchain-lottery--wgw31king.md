# blockchain-lottery--wgw31king

- domain: games-lotteries (lottery)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/wgw31king/blockchain-lottery @ 46e0e20e7d6cd34cc6ef5d7dbdbf92adcfab27a0
- license: MIT
- targets: BlockchainLottery.sol, ReentrantDrawAttacker.sol
- validation: 5 passing tests, 0 failing; statement coverage BlockchainLottery.sol 100.0 %, ReentrantDrawAttacker.sol 100.0 %

## Contract: BlockchainLottery.sol (primary target)

```solidity
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
```

## Contract: ReentrantDrawAttacker.sol (dependency)

```solidity
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
```

## Tests: BlockchainLottery.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("BlockchainLottery", function () {
  const MIN_BET = ethers.parseEther("0.1");

  async function deployFixture() {
    const [owner, alice, bob, carol, dave] = await ethers.getSigners();
    const Lottery = await ethers.getContractFactory("BlockchainLottery");
    const lottery = await Lottery.deploy(MIN_BET, owner.address);
    await lottery.waitForDeployment();
    return { lottery, owner, alice, bob, carol, dave };
  }

  it("runs full flow and distributes prize by weights", async function () {
    const { lottery, owner, alice, bob, carol } = await loadFixture(deployFixture);

    await expect(lottery.connect(alice).placeBet({ value: ethers.parseEther("1") }))
      .to.emit(lottery, "BetPlaced");
    await lottery.connect(bob).placeBet({ value: ethers.parseEther("2") });
    await lottery.connect(carol).placeBet({ value: ethers.parseEther("3") });

    expect(await lottery.totalPool()).to.equal(ethers.parseEther("6"));

    await expect(lottery.connect(owner).closeBetting())
      .to.emit(lottery, "BettingClosed");

    const beforeAlice = await ethers.provider.getBalance(alice.address);
    const beforeBob = await ethers.provider.getBalance(bob.address);
    const beforeCarol = await ethers.provider.getBalance(carol.address);

    const tx = await lottery
      .connect(owner)
      .drawAndDistribute([alice.address, bob.address, carol.address], [1, 2, 3]);

    await expect(tx).to.emit(lottery, "WinnersDrawn");
    await expect(tx).to.emit(lottery, "DistributionCompleted")
      .withArgs(ethers.parseEther("6"));

    const afterAlice = await ethers.provider.getBalance(alice.address);
    const afterBob = await ethers.provider.getBalance(bob.address);
    const afterCarol = await ethers.provider.getBalance(carol.address);

    expect(afterAlice - beforeAlice).to.equal(ethers.parseEther("1"));
    expect(afterBob - beforeBob).to.equal(ethers.parseEther("2"));
    expect(afterCarol - beforeCarol).to.equal(ethers.parseEther("3"));

    expect(await lottery.settled()).to.equal(true);
    expect(await ethers.provider.getBalance(await lottery.getAddress())).to.equal(0n);
  });

  it("rejects non-owner admin actions", async function () {
    const { lottery, alice, bob } = await loadFixture(deployFixture);
    await expect(lottery.connect(alice).closeBetting()).to.be.reverted;
    await expect(
      lottery.connect(bob).drawAndDistribute([alice.address], [1])
    ).to.be.reverted;
  });

  it("reverts on invalid bet and invalid draw inputs", async function () {
    const { lottery, owner, alice } = await loadFixture(deployFixture);

    await expect(lottery.connect(alice).placeBet({ value: 0 }))
      .to.be.revertedWithCustomError(lottery, "InvalidBetAmount");

    await lottery.connect(alice).placeBet({ value: MIN_BET });

    await expect(
      lottery.connect(owner).drawAndDistribute([alice.address], [1])
    ).to.be.revertedWithCustomError(lottery, "BettingStillOpen");

    await lottery.connect(owner).closeBetting();

    await expect(
      lottery.connect(owner).drawAndDistribute([], [])
    ).to.be.revertedWithCustomError(lottery, "InvalidInput");

    await expect(
      lottery.connect(owner).drawAndDistribute([alice.address], [])
    ).to.be.revertedWithCustomError(lottery, "InvalidInput");

    await expect(
      lottery.connect(owner).drawAndDistribute([alice.address, alice.address], [1, 1])
    ).to.be.revertedWithCustomError(lottery, "InvalidInput");
  });

  it("cannot draw twice", async function () {
    const { lottery, owner, alice } = await loadFixture(deployFixture);
    await lottery.connect(alice).placeBet({ value: ethers.parseEther("1") });
    await lottery.connect(owner).closeBetting();
    await lottery.connect(owner).drawAndDistribute([alice.address], [1]);

    await expect(
      lottery.connect(owner).drawAndDistribute([alice.address], [1])
    ).to.be.revertedWithCustomError(lottery, "AlreadySettled");
  });

  it("prevents reentrancy during payout", async function () {
    const { lottery, owner, alice, bob } = await loadFixture(deployFixture);
    await lottery.connect(alice).placeBet({ value: ethers.parseEther("1") });
    await lottery.connect(bob).placeBet({ value: ethers.parseEther("1") });
    await lottery.connect(owner).closeBetting();

    const Attacker = await ethers.getContractFactory("ReentrantDrawAttacker");
    const attacker = await Attacker.deploy(await lottery.getAddress());
    await attacker.waitForDeployment();

    await lottery.connect(owner).transferOwnership(await attacker.getAddress());
    await attacker.triggerDraw([await attacker.getAddress()], [1]);

    expect(await attacker.attemptedReentry()).to.equal(true);
    expect(await attacker.reentrySucceeded()).to.equal(false);
    expect(await lottery.settled()).to.equal(true);
  });
});
```
