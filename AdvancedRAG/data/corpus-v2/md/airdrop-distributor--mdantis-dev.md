# airdrop-distributor--mdantis-dev

- domain: airdrop-merkle (airdrop)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/mdantis-dev/SOLIDITY-Liminal-Games @ 09a7484ac7f92e054eedc087b2d03431968e435b
- license: MIT
- targets: AirdropDistributor.sol, LiminalToken.sol
- validation: 8 passing tests, 0 failing; statement coverage AirdropDistributor.sol 100.0 %, LiminalToken.sol 33.33 %

## Contract: AirdropDistributor.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract AirdropDistributor is Ownable, ReentrancyGuard {
    using Math for uint256;

    IERC20 public immutable token;

    uint256 public immutable totalReserves;      // Total airdrop tokens reserved
    uint256 public immutable startTime;          // Timestamp when unlocks begin
    uint256 public immutable cliffDuration;      // Time before unlocking starts
    uint256 public immutable unlockDuration;     // Time over which tokens unlock linearly

    uint256 public reservesAllocated;            // How many tokens have been *currently* assigned

    mapping(address => uint256) public claimable;

    event Claimed(address indexed user, uint256 amount);
    event ClaimableSet(address indexed user, uint256 amount);

    constructor(address _token, uint256 _totalReserves, uint256 _cliffDuration, uint256 _unlockDuration) Ownable(msg.sender) {
        require(_token != address(0), "Token address required");
        require(_totalReserves > 0, "Reserves must be > 0");
        require(_unlockDuration > 0, "Unlock duration must be > 0");

        // guard against timestamp overflow in cliff/unlock math
        require(block.timestamp + _cliffDuration >= block.timestamp, "Cliff overflow");
        require(block.timestamp + _cliffDuration + _unlockDuration >= block.timestamp, "Unlock overflow");

        token           = IERC20(_token);
        totalReserves   = _totalReserves;
        cliffDuration   = _cliffDuration;
        unlockDuration  = _unlockDuration;
        startTime       = block.timestamp;
    }

    /// @notice Owner can assign “claimable” balances as tokens unlock
    function setClaimable(address user, uint256 amount) external onlyOwner {
        require(user != address(0), "Invalid address");
        uint256 previous = claimable[user];
        uint256 unlocked  = getUnlockedReserves();

        // compute what the total allocated would become
        uint256 newAllocated = reservesAllocated + amount;
        unchecked { newAllocated -= previous; } // safe because previous ≤ reservesAllocated by invariant

        require(newAllocated <= unlocked, "Exceeds unlocked tokens");

        // update state
        claimable[user]       = amount;
        reservesAllocated     = newAllocated;

        emit ClaimableSet(user, amount);
    }

    /// @notice Users pull their tokens; frees up their allocation afterward
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "Nothing to claim");

        // zero before external call
        claimable[msg.sender] = 0;
        unchecked { reservesAllocated -= amount; }

        require(token.transfer(msg.sender, amount), "Transfer failed");
        emit Claimed(msg.sender, amount);
    }

    /// @notice How many tokens this user may claim right now
    function getClaimableAmount(address user) external view returns (uint256) {
        return claimable[user];
    }

    /// @notice How many unlocked tokens are still unassigned
    function getUnallocatedReserves() external view returns (uint256) {
        uint256 unlocked = getUnlockedReserves();
        return unlocked > reservesAllocated
            ? unlocked - reservesAllocated
            : 0;
    }

    /// @notice Linear‐unlock schedule with cliff, using mulDiv for overflow‐safe math
    function getUnlockedReserves() public view returns (uint256) {
        // still in cliff
        if (block.timestamp <= startTime + cliffDuration) {
            return 0;
        }

        uint256 elapsed = block.timestamp - (startTime + cliffDuration);
        if (elapsed >= unlockDuration) {
            return totalReserves;
        }

        // safe multiply‐then‐divide to avoid 256‐bit overflow
        return Math.mulDiv(totalReserves, elapsed, unlockDuration);
    }
}
```

## Contract: LiminalToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Liminal Token (LIM)
/// @notice ERC20 token with on-chain governance voting, pausing, and burn functionality for the Liminal Games ecosystem.
contract LiminalToken is ERC20Votes, Pausable, Ownable {
    
    /// @notice Deploys the LIM token, mints 400M tokens to the deployer, and enables governance voting support.
    constructor() ERC20("Liminal Token", "LIM") EIP712("Liminal Token", "1") Ownable(msg.sender) {
        _mint(msg.sender, 400_000_000 * 10 ** decimals());
    }

    /// @notice Pauses all token transfers. Only callable by the owner.
    function pause() public onlyOwner {
        _pause();
    }

    /// @notice Unpauses token transfers. Only callable by the owner.
    function unpause() public onlyOwner {
        _unpause();
    }

    /// @notice Transfers tokens to another address when not paused.
    function transfer(address to, uint256 amount) public override whenNotPaused returns (bool) {
        return super.transfer(to, amount);
    }

    /// @notice Transfers tokens from a sender to a recipient when not paused.
    function transferFrom(address from, address to, uint256 amount) public override whenNotPaused returns (bool) {
        return super.transferFrom(from, to, amount);
    }

    /// @notice Burns tokens from the caller's wallet.
    function burn(uint256 amount) public {
        _burn(msg.sender, amount);
    }

    /// @notice Burns tokens from another address using allowance.
    function burnFrom(address from, uint256 amount) public {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }

    /// @notice Internal function to update vote tracking on transfers.
    function _update(address from, address to, uint256 value) internal override(ERC20Votes) {
        super._update(from, to, value);
    }
}
```

## Tests: AirdropDistributor.js

```javascript
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AirdropDistributor", function () {
  async function deployFixture() {
    const [owner, user1, user2] = await ethers.getSigners();

    // Deploy LiminalToken (pre-mints full supply to owner)
    const Token = await ethers.getContractFactory("LiminalToken");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const totalReserves = ethers.parseEther("10000000");
    const cliff = 30 * 24 * 60 * 60; // 30 days
    const duration = 182 * 24 * 60 * 60; // aprox. 6 months

    // Deploy AirdropDistributor
    const Airdrop = await ethers.getContractFactory("AirdropDistributor");
    const airdrop = await Airdrop.deploy(await token.getAddress(), totalReserves, cliff, duration);
    await airdrop.waitForDeployment();

    // Transfer tokens to AirdropDistributor
    await token.transfer(await airdrop.getAddress(), totalReserves);

    return { owner, user1, user2, token, airdrop, totalReserves, cliff, duration };
  }

  it("should not allow claimable assignment before cliff", async () => {
    const { airdrop, user1 } = await loadFixture(deployFixture);
    await expect(airdrop.setClaimable(user1.address, ethers.parseEther("1000"))).to.be.revertedWith("Exceeds unlocked tokens");
  });

  it("should allow claimable assignment after cliff", async () => {
    const { airdrop, user1, cliff } = await loadFixture(deployFixture);
    await time.increase(cliff + 1);

    const unlocked = await airdrop.getUnlockedReserves();
    expect(unlocked).to.be.gt(0);

    const safeAmount = unlocked / 10n; // use a safe fraction of unlocked amount
    await expect(airdrop.setClaimable(user1.address, safeAmount)).to.not.be.reverted;
  });

  it("should allow claim and reset claimable balance", async () => {
    const { airdrop, token, user1, cliff } = await loadFixture(deployFixture);
    await time.increase(cliff + 100);
    const claimAmount = ethers.parseEther("50");

    await airdrop.setClaimable(user1.address, claimAmount);
    await airdrop.connect(user1).claim();

    expect(await token.balanceOf(user1.address)).to.equal(claimAmount);
    expect(await airdrop.getClaimableAmount(user1.address)).to.equal(0n);
  });

  it("should not allow claim more than unlocked", async () => {
    const { airdrop, user1, user2, duration, cliff } = await loadFixture(deployFixture);
    await time.increase(cliff + Math.floor(duration / 2));
  
    const unlocked = await airdrop.getUnlockedReserves();
    console.log(`unlocked: ${unlocked}`);
  
    await airdrop.setClaimable(user2.address, unlocked);
  
    await expect(airdrop.setClaimable(user1.address, ethers.parseEther("200"))).to.be.revertedWith("Exceeds unlocked tokens");

    await airdrop.connect(user2).claim();
  });

  it("should unlock 100% after full duration", async () => {
    const { airdrop, totalReserves, duration, cliff } = await loadFixture(deployFixture);
    await time.increase(cliff + duration);

    const unlocked = await airdrop.getUnlockedReserves();
    expect(unlocked).to.equal(totalReserves);
  });

  it("should revert on claim when nothing is claimable", async () => {
    const { airdrop, user1 } = await loadFixture(deployFixture);
    await expect(airdrop.connect(user1).claim()).to.be.revertedWith("Nothing to claim");
  });

  it("should correctly update allocation without double-counting", async () => {
    const { airdrop, user1, cliff } = await loadFixture(deployFixture);

    const now = await time.latest();
    const fixedTime = now + cliff + 100;
    await time.setNextBlockTimestamp(fixedTime);
    await ethers.provider.send("evm_mine"); // freeze timestamp

    const unlocked = await airdrop.getUnlockedReserves();
    const half = unlocked / 2n;

    await airdrop.setClaimable(user1.address, half);
    await airdrop.setClaimable(user1.address, half);

    const unallocated = await airdrop.getUnallocatedReserves();
    const expected = unlocked - half;

    expect(unallocated).to.be.closeTo(expected, ethers.parseEther("200"));
  });

  it("should accumulate reservesAllocated across multiple users", async () => {
    const { airdrop, user1, user2, cliff } = await loadFixture(deployFixture);
    await time.increase(cliff + 100);
  
    const unlocked = await airdrop.getUnlockedReserves();
    const portion = unlocked / 4n;
  
    await airdrop.setClaimable(user1.address, portion);
    await airdrop.setClaimable(user2.address, portion);
  
    const totalAllocated = await airdrop.reservesAllocated();
    expect(totalAllocated).to.equal(portion * 2n);
  });
});
```
