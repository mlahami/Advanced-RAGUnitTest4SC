# oracle--darli-protocol

- domain: price-oracles (price-oracle)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/darli-protocol/oracle-v1 @ a735b16c040561e94d8b56db905b51427fdf88ac
- license: MIT
- targets: Oracle.sol
- validation: 14 passing tests, 0 failing; statement coverage Oracle.sol 100.0 %

## Contract: MockToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("MockToken", "MKT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Contract: Oracle.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Oracle is Ownable {
    IERC20 public immutable governanceToken;

    mapping(address => uint256) public stakes; // User stakes
    mapping(address => uint256) public votes; // User votes
    uint256 public totalStaked; // Total staked tokens
    uint256 public totalPrice; // Sum of price * stake
    uint256 public voteCount; // Number of active voters
    uint256 public averagePrice; // Current average price

    // TWAP variables
    uint256 public cumulativePriceTime; // Accumulated price * time
    uint256 public lastUpdatedTimestamp; // Last TWAP update time
    uint256 public cumulativeTime; // Total elapsed time

    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event PriceVoted(address indexed user, uint256 price);
    event TWAPReset(uint256 timestamp);

    constructor(
        address _governanceToken,
        address initialOwner
    ) Ownable(initialOwner) {
        require(
            _governanceToken != address(0),
            "Invalid governance token address"
        );
        governanceToken = IERC20(_governanceToken);
    }

    /**
     * @dev Stake governance tokens to participate in voting.
     * @param amount The amount of tokens to stake.
     */
    function stake(uint256 amount) external {
        require(amount > 0, "Stake amount must be greater than zero");

        governanceToken.transferFrom(msg.sender, address(this), amount);

        if (stakes[msg.sender] == 0) {
            voteCount++;
        }

        stakes[msg.sender] += amount;
        totalStaked += amount;

        emit Staked(msg.sender, amount);
    }

    /**
     * @dev Unstake governance tokens. Reduces voting weight and updates state.
     * @param amount The amount of tokens to unstake.
     */
    function unstake(uint256 amount) external {
        require(amount > 0, "Unstake amount must be greater than zero");
        require(stakes[msg.sender] >= amount, "Insufficient stake to unstake");

        uint256 userStake = stakes[msg.sender];
        uint256 userVote = votes[msg.sender];

        totalStaked -= amount;
        stakes[msg.sender] -= amount;

        if (stakes[msg.sender] == 0) {
            voteCount--;
            totalPrice -= userVote * userStake;
        } else {
            totalPrice -= userVote * amount;
        }

        governanceToken.transfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount);
    }

    /**
     * @dev Submit a price vote, updating the TWAP calculations.
     * @param price The price to vote for.
     */
    function vote(uint256 price) external {
        require(stakes[msg.sender] > 0, "Must stake tokens to vote");

        uint256 userStake = stakes[msg.sender];
        uint256 currentTimestamp = block.timestamp;

        // Calculate time since last update
        if (lastUpdatedTimestamp > 0) {
            uint256 timeElapsed = currentTimestamp - lastUpdatedTimestamp;
            cumulativePriceTime += averagePrice * timeElapsed;
            cumulativeTime += timeElapsed;
        }

        // Update average price and user vote
        totalPrice =
            totalPrice +
            (price * userStake) -
            (votes[msg.sender] * userStake);
        averagePrice = totalStaked > 0 ? totalPrice / totalStaked : 0;
        votes[msg.sender] = price;

        lastUpdatedTimestamp = currentTimestamp;

        emit PriceVoted(msg.sender, price);
    }

    /**
     * @dev Retrieve the current Time-Weighted Average Price (TWAP).
     * @return The TWAP value.
     */
    function getTWAP() external view returns (uint256) {
        require(cumulativeTime > 0, "TWAP not available yet");
        return cumulativePriceTime / cumulativeTime;
    }

    /**
     * @dev Reset TWAP data. Only callable by the contract owner.
     */
    function resetTWAP() external onlyOwner {
        cumulativePriceTime = 0;
        cumulativeTime = 0;
        lastUpdatedTimestamp = block.timestamp;

        emit TWAPReset(block.timestamp);
    }

    // Read-only functions
    function getAveragePrice() external view returns (uint256) {
        return averagePrice;
    }

    function getVoteCount() external view returns (uint256) {
        return voteCount;
    }

    function getTotalStaked() external view returns (uint256) {
        return totalStaked;
    }

    function getStakedVoter(address voter) external view returns (uint256) {
        return stakes[voter];
    }

    function getPriceVoter(address voter) external view returns (uint256) {
        return votes[voter];
    }

    function getLastUpdateTime() public view returns (uint256) {
        return lastUpdatedTimestamp;
    }
}
```

## Tests: Oracle.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Oracle Contract", function () {
  let governanceToken, oracle, owner, addr1, addr2;
  let ownerAddress, addr1Address, addr2Address;

  before(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    ownerAddress = owner.getAddress();
    addr1Address = addr1.getAddress();
    addr2Address = addr2.getAddress();
  });

  beforeEach(async function () {
    // Deploy Mock Governance Token
    const MockToken = await ethers.getContractFactory("MockToken");
    governanceToken = await MockToken.deploy();
    await governanceToken.waitForDeployment();

    // Mint tokens for test accounts
    await governanceToken.mint(ownerAddress, ethers.parseEther("1000"));
    await governanceToken.mint(addr1Address, ethers.parseEther("1000"));
    await governanceToken.mint(addr2Address, ethers.parseEther("1000"));

    // Deploy Oracle contract
    const Oracle = await ethers.getContractFactory("Oracle");
    oracle = await Oracle.deploy(governanceToken.getAddress(), ownerAddress);
    await oracle.waitForDeployment();

    // Approve staking for test accounts
    await governanceToken.connect(addr1).approve(oracle.getAddress(), ethers.parseEther("500"));
    await governanceToken.connect(addr2).approve(oracle.getAddress(), ethers.parseEther("500"));
  });

  // Helper Functions
  const stakeTokens = async (signer, amount) => {
    await oracle.connect(signer).stake(ethers.parseEther(amount.toString()));
  };

  const votePrice = async (signer, price) => {
    await oracle.connect(signer).vote(ethers.parseEther(price.toString()));
  };

  const increaseTime = async (seconds) => {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
  };

  it("Should allow users to stake tokens", async function () {
    await stakeTokens(addr1, 100);
    expect(await oracle.stakes(addr1Address)).to.equal(ethers.parseEther("100"));
    expect(await oracle.totalStaked()).to.equal(ethers.parseEther("100"));
  });

  it("Should allow users to vote and calculate the average price", async function () {
    await stakeTokens(addr1, 100);
    await votePrice(addr1, 200);

    await stakeTokens(addr2, 200);
    await votePrice(addr2, 300);

    const averagePrice = await oracle.getAveragePrice();
    expect(averagePrice).to.equal(ethers.parseEther("266.666666666666666666"));
  });

  it("Should handle unstaking and update voting weight correctly", async function () {
    await stakeTokens(addr1, 100);
    await votePrice(addr1, 200);

    await oracle.connect(addr1).unstake(ethers.parseEther("50"));

    expect(await oracle.stakes(addr1Address)).to.equal(ethers.parseEther("50"));
    expect(await oracle.totalStaked()).to.equal(ethers.parseEther("50"));
  });

  it("Should revert if unstaking more than staked amount", async function () {
    await stakeTokens(addr1, 100);
    await expect(oracle.connect(addr1).unstake(ethers.parseEther("200"))).to.be.revertedWith(
      "Insufficient stake to unstake"
    );
  });

  it("Should prevent voting without staking", async function () {
    await expect(votePrice(addr1, 200)).to.be.revertedWith("Must stake tokens to vote");
  });

  it("Should revert if stake amount is zero", async function () {
    await expect(oracle.connect(addr1).stake(ethers.parseEther("0"))).to.be.revertedWith(
      "Stake amount must be greater than zero"
    );
  });

  it("Should update totalPrice correctly when users vote multiple times", async function () {
    await stakeTokens(addr1, 100);
    await votePrice(addr1, 200);
    await votePrice(addr1, 300);

    expect(await oracle.getAveragePrice()).to.equal(ethers.parseEther("300"));
  });

  it("Should return accurate vote count after staking and unstaking", async function () {
    await stakeTokens(addr1, 100);
    await votePrice(addr1, 200);

    await stakeTokens(addr2, 200);
    await votePrice(addr2, 300);

    expect(await oracle.getVoteCount()).to.equal(2);

    await oracle.connect(addr2).unstake(ethers.parseEther("200"));
    expect(await oracle.getVoteCount()).to.equal(1);
  });

  it("Should allow only the owner to reset TWAP", async function () {
    await expect(oracle.connect(addr1).resetTWAP()).to.be.revertedWithCustomError(
      oracle,
      "OwnableUnauthorizedAccount"
    );
    await expect(oracle.resetTWAP()).to.not.be.reverted;
  });

  it("Should calculate TWAP correctly", async function () {
    await stakeTokens(addr1, 500);
    await votePrice(addr1, 3000);

    await increaseTime(200); // Simulate time passage
    await votePrice(addr1, 3200);

    await increaseTime(50); // More time passage
    await votePrice(addr1, 3150);

    const twap = await oracle.getTWAP();
    expect(twap).to.be.closeTo(ethers.parseEther("3040"), ethers.parseEther("1"));
  });

  it("Should reset TWAP correctly", async function () {
    await stakeTokens(addr1, 500);
    await votePrice(addr1, 3300);

    await increaseTime(200);
    await votePrice(addr1, 3200);

    await oracle.resetTWAP(); // Reset TWAP
    
    await votePrice(addr1, 3000);
    await increaseTime(200);
    await votePrice(addr1, 3200);
    await increaseTime(50);
    await votePrice(addr1, 3150);
    const twap = await oracle.getTWAP();
    expect(twap).to.be.closeTo(ethers.parseEther("3040"), ethers.parseEther("2"));
  });

  it("Should accurately track staked tokens and vote prices by voter", async function () {
    await stakeTokens(addr1, 100);
    await votePrice(addr1, 200);

    await stakeTokens(addr2, 200);
    await votePrice(addr2, 300);

    expect(await oracle.getStakedVoter(addr1.address)).to.equal(ethers.parseEther("100"));
    expect(await oracle.getPriceVoter(addr1.address)).to.equal(ethers.parseEther("200"));
  });

  it("Should return correct total staked tokens", async function () {
    await stakeTokens(addr1, 100);
    await stakeTokens(addr2, 250);

    expect(await oracle.getTotalStaked()).to.equal(ethers.parseEther("350"));
  });

  it("Should return accurate last update timestamp", async function () {
    await stakeTokens(addr1, 100);
    await votePrice(addr1, 200);

    const block = await ethers.provider.getBlock("latest");
    const lastUpdateTime = await oracle.getLastUpdateTime();

    expect(lastUpdateTime).to.equal(block.timestamp);
  });
});
```
