# lottery--colonelcaptain

- domain: games-lotteries (lottery)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ColonelCaptain/Lottery_Dapp @ 61a6b13e647fc1278bd5b51d499923006dbe5755
- license: Apache-2.0
- targets: Lottery.sol
- validation: 6 passing tests, 0 failing; statement coverage Lottery.sol 87.5 %

## Contract: Lottery.sol (primary target)

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract Lottery {
    address public manager;
    address[] public players;
    address public lastWinner; // Variable to store the address of the last winner
    
    constructor() {
        manager = msg.sender;
    }
    
    function enter() public payable {
        require(msg.value >= 0.001 ether, "Minimum ether not met");
        players.push(msg.sender);
    }
    
    function random() private view returns (uint) {
        return uint(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, players)));
    }

     function pickWinner() public restricted {
        uint index = random() % players.length;
        lastWinner = players[index]; // Set the last winner
        payable(players[index]).transfer(address(this).balance);
        players = new address[](0) ;
    }
    
    modifier restricted() {
        require(msg.sender == manager, "Only manager can call this function");
        _;
    }

    function getPlayers() public view returns (address[] memory) {
        return players;
    }

    function getLastWinner() public view returns (address) {
        return lastWinner; // Return the address of the last winner
    }
}
```

## Tests: lottery.js

```javascript
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect, assert } = require("chai");
const hre = require("hardhat");

describe("Lottery", async () => {
  async function deployLotteryFixture() {
    const [owner, account1, account2] = await hre.ethers.getSigners();

    const Lottery = await hre.ethers.getContractFactory("Lottery");
    const lottery = await Lottery.deploy();

    return { lottery, owner, account1, account2 };
  }
  describe("Deployment", async () => {
    it("deploy the contract", async () => {
      const { lottery } = await loadFixture(deployLotteryFixture);
      //print deployed contract address
      assert.isOk(
        lottery.getAddress(),
        "The Contract was successfully deployed"
      );
    });
  });

  describe("Functional Testing", async () => {
    it("Allow one account to enter", async () => {
      const { lottery, owner } = await loadFixture(deployLotteryFixture);
      await lottery.enter({ value: hre.ethers.parseUnits("0.02", "ether") });
      const players = await lottery.getPlayers();
      expect(players[0]).to.equal(owner);
      expect(players.length).to.equal(1);
    });

    it("Allow Multiple accounts to enter", async () => {
      const { lottery, account1, account2 } =
        await loadFixture(deployLotteryFixture);

      await lottery
        .connect(account1)
        .enter({ value: hre.ethers.parseUnits("0.02", "ether") });
      await lottery
        .connect(account2)
        .enter({ value: hre.ethers.parseUnits("0.02", "ether") });
      const players = await lottery.getPlayers();
      expect(players[0]).to.equal(account1);
      expect(players[1]).to.equal(account2);
      expect(players.length).to.equal(2);
    });
    it("Require the minimal amount of ether to enter", async () => {
      const { lottery, account1 } = await loadFixture(deployLotteryFixture);
      try {
        await lottery
          .connect(account1)
          .enter({ value: hre.ethers.parseUnits("0.02", "ether") });
        assert(false);
      } catch (err) {
        assert(err);
      }
    });

    it("Only the manager should pick the winner", async () => {
      const { lottery, account1 } = await loadFixture(deployLotteryFixture);
      try {
        await lottery.connect(account1).pickWinner();
        assert(false);
      } catch (err) {
        assert(err);
      }
    });
  });

  describe("E2E Testing", async () => {
    it("Enter the lottery and pick the winner", async () => {
      const { lottery, account1 } = await loadFixture(deployLotteryFixture);

      await lottery
        .connect(account1)
        .enter({ value: hre.ethers.parseUnits("1", "ether") });

      await lottery.pickWinner();

      const finalBalance = await hre.ethers.provider.getBalance(account1);

      assert(finalBalance > hre.ethers.parseUnits("99.8", "ether"));

      const players = await lottery.getPlayers();

      expect(players.length).to.equal(0);
    });
  });
});
```
