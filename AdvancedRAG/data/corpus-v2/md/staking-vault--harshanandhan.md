# staking-vault--harshanandhan

- domain: staking-yield (staking)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Harshanandhan/erc20-staking-vault @ 9434d9b22792134e4bafd514f246d5752713b2a8
- license: MIT
- targets: StakingVault.sol, StakeToken.sol
- validation: 6 passing tests, 0 failing; statement coverage StakingVault.sol 95.45 %, StakeToken.sol 100.0 %

## Contract: StakeToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Test/lab ERC-20. Owner can mint. Not a mainnet token.
contract StakeToken is ERC20, Ownable {
    constructor() ERC20("Stake Token", "STK") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
```

## Contract: StakingVault.sol (primary target)

```solidity
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
```

## Tests: StakingVault.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("StakingVault", function () {
  async function deploy() {
    const [owner, alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("StakeToken");
    const token = await Token.deploy();
    const rate = ethers.parseEther("1"); // 1 token / sec across all stake
    const Vault = await ethers.getContractFactory("StakingVault");
    const vault = await Vault.deploy(await token.getAddress(), rate);
    await token.transfer(alice.address, ethers.parseEther("1000"));
    await token.transfer(bob.address, ethers.parseEther("1000"));
    await token.mint(await vault.getAddress(), ethers.parseEther("100000"));
    return { owner, alice, bob, token, vault, rate };
  }

  it("stakes and records the balance before the transfer returns", async function () {
    const { alice, token, vault } = await deploy();
    await token.connect(alice).approve(await vault.getAddress(), ethers.parseEther("100"));
    await vault.connect(alice).stake(ethers.parseEther("100"));
    expect(await vault.staked(alice.address)).to.equal(ethers.parseEther("100"));
    expect(await vault.totalStaked()).to.equal(ethers.parseEther("100"));
  });

  it("reverts withdraw above the staked amount", async function () {
    const { alice, token, vault } = await deploy();
    await token.connect(alice).approve(await vault.getAddress(), ethers.parseEther("10"));
    await vault.connect(alice).stake(ethers.parseEther("10"));
    await expect(vault.connect(alice).withdraw(ethers.parseEther("11"))).to.be.revertedWith(
      "too much"
    );
  });

  it("returns principal on withdraw", async function () {
    const { alice, token, vault } = await deploy();
    await token.connect(alice).approve(await vault.getAddress(), ethers.parseEther("40"));
    await vault.connect(alice).stake(ethers.parseEther("40"));
    const before = await token.balanceOf(alice.address);
    await vault.connect(alice).withdraw(ethers.parseEther("40"));
    expect(await token.balanceOf(alice.address)).to.equal(before + ethers.parseEther("40"));
    expect(await vault.staked(alice.address)).to.equal(0n);
  });

  it("pays rewards after time passes", async function () {
    const { alice, token, vault } = await deploy();
    await token.connect(alice).approve(await vault.getAddress(), ethers.parseEther("100"));
    await vault.connect(alice).stake(ethers.parseEther("100"));
    await time.increase(100);
    const pending = await vault.earned(alice.address);
    expect(pending).to.be.greaterThan(ethers.parseEther("99"));
    expect(pending).to.be.lessThan(ethers.parseEther("102"));
    const before = await token.balanceOf(alice.address);
    await vault.connect(alice).getReward();
    const paid = (await token.balanceOf(alice.address)) - before;
    expect(paid).to.be.greaterThan(ethers.parseEther("99"));
  });

  it("splits rewards by stake share", async function () {
    const { alice, bob, token, vault } = await deploy();
    await token.connect(alice).approve(await vault.getAddress(), ethers.parseEther("100"));
    await token.connect(bob).approve(await vault.getAddress(), ethers.parseEther("100"));
    await vault.connect(alice).stake(ethers.parseEther("100"));
    await vault.connect(bob).stake(ethers.parseEther("100"));
    await time.increase(100);
    const a = await vault.earned(alice.address);
    const b = await vault.earned(bob.address);
    const diff = a > b ? a - b : b - a;
    expect(diff).to.be.lessThan(ethers.parseEther("2"));
  });

  it("only the owner can change the reward rate", async function () {
    const { alice, vault } = await deploy();
    await expect(vault.connect(alice).setRewardRate(1)).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount"
    );
    await vault.setRewardRate(0);
    expect(await vault.rewardRate()).to.equal(0n);
  });
});
```
