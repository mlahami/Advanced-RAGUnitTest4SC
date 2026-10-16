# ancilla-staking--ancilla-arb

- domain: staking-yield (staking)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ANCILLA-ARB/ancilla @ ae4c4f341939a3f451c27b9271fac7f5f1ae89a9
- license: MIT
- targets: AncillaStaking.sol, AncillaToken.sol
- validation: 12 passing tests, 0 failing; statement coverage AncillaStaking.sol 94.74 %, AncillaToken.sol 60.0 %

## Contract: AncillaStaking.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AncillaStaking
/// @notice Stake ANCILLA, earn a pro-rata share of ETH revenue the
/// protocol sends here. Deliberately does NOT invent a new revenue
/// stream — the intended source is AncillaTreasuryMultisig, which
/// already holds every slashed bond and already has a working, tested,
/// live-proven `proposeWithdrawal` / `executeWithdrawal` flow (2-of-3
/// confirmation). That flow sends plain ETH with no calldata, so this
/// contract's `receive()` — not a separate "notifyRevenue" function
/// owners would have to remember to call — is where a treasury payout
/// lands and gets distributed. Nothing about AncillaTreasuryMultisig.sol
/// needed to change for this to work.
///
/// Distribution math is the standard "scalable reward distribution"
/// accumulator (the same family as Synthetix's StakingRewards, minus a
/// time-based emission rate — funding here arrives in irregular lumps
/// whenever the treasury multisig decides to distribute, not as a
/// continuous stream, so there's no rate to track): every ETH deposit
/// increases a global `rewardPerTokenStored` proportional to
/// `totalStaked` at that moment; each staker's owed amount is the
/// difference between the current accumulator and whatever value it was
/// at when they last staked/withdrew/claimed, times their stake. This is
/// O(1) per stake/withdraw/claim regardless of staker count — no loops
/// over a staker list, which is exactly the kind of unbounded-loop
/// footgun a real payout contract can't afford.
///
/// Reverts (not silently no-ops) if ETH arrives while `totalStaked == 0`
/// — there's no one to distribute to yet, and silently absorbing it
/// would either strand the funds or let the next staker claim ETH they
/// weren't actually owed.
contract AncillaStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error InsufficientStake();
    error NoStakersYet();

    event Staked(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event Claimed(address indexed account, uint256 amount);
    event RevenueDistributed(uint256 amount, uint256 totalStakedAtTime);

    IERC20 public immutable stakingToken;

    uint256 public totalStaked;
    mapping(address => uint256) public staked;

    uint256 private constant PRECISION = 1e18;
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) private userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    constructor(IERC20 _stakingToken) {
        stakingToken = _stakingToken;
    }

    /// @notice Any plain ETH transfer (e.g. AncillaTreasuryMultisig's
    /// executeWithdrawal) is treated as revenue and distributed pro-rata
    /// to whoever is staked at that moment.
    receive() external payable {
        _distribute(msg.value);
    }

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _updateReward(msg.sender);
        totalStaked += amount;
        staked[msg.sender] += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (staked[msg.sender] < amount) revert InsufficientStake();
        _updateReward(msg.sender);
        totalStaked -= amount;
        staked[msg.sender] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Pays out accrued ETH rewards. Callable any time; also run
    /// implicitly by stake()/withdraw() so a staker's owed amount never
    /// goes stale between explicit claims.
    function claim() external nonReentrant {
        _updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        if (reward == 0) return;
        rewards[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: reward}("");
        require(ok, "ETH transfer failed");
        emit Claimed(msg.sender, reward);
    }

    /// @notice What `account` would receive from claim() right now,
    /// without needing to send a transaction first.
    function earned(address account) external view returns (uint256) {
        return rewards[account] + (staked[account] * (rewardPerTokenStored - userRewardPerTokenPaid[account])) / PRECISION;
    }

    function _distribute(uint256 amount) private {
        if (totalStaked == 0) revert NoStakersYet();
        rewardPerTokenStored += (amount * PRECISION) / totalStaked;
        emit RevenueDistributed(amount, totalStaked);
    }

    function _updateReward(address account) private {
        rewards[account] += (staked[account] * (rewardPerTokenStored - userRewardPerTokenPaid[account])) / PRECISION;
        userRewardPerTokenPaid[account] = rewardPerTokenStored;
    }
}
```

## Contract: AncillaToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Time} from "@openzeppelin/contracts/utils/types/Time.sol";

/// @title AncillaToken (ANCILLA)
/// @notice The protocol's governance/utility token. Deliberately minimal on
/// its own terms — supply, allocation, and vesting are NOT this contract's
/// job and are not encoded here; those are tokenomics decisions made once,
/// off-chain and at deploy/distribution time, not something to hardcode
/// into an ERC20 that then has to be redeployed if the numbers change.
/// What this contract DOES commit to on-chain:
///   - A hard, immutable supply cap (`ERC20Capped`) — minting can never
///     exceed it, regardless of who holds the owner role later.
///   - On-chain vote-weight tracking (`ERC20Votes`) via OpenZeppelin's
///     standard checkpoint system, so a token balance IS voting power
///     without a separate wrapper/staking step — required by
///     `AncillaGovernor` (see that contract).
///   - Gasless approvals (`ERC20Permit`) — standard for anything meant to
///     be staked or delegated without a separate approve() transaction.
///
/// `owner` can mint, up to the cap — same "single EOA at first, migrate to
/// real governance later" MVP pattern already used for `treasury` and
/// `guardian` in IntentCommitReveal.sol (see that contract's header
/// comment): the deployer starts as owner, and should transfer ownership
/// to a multisig or to `AncillaTimelock` (once real governance is trusted
/// enough to control emissions) before any real distribution happens.
/// `Ownable.transferOwnership` and `renounceOwnership` are both available
/// for exactly that migration.
contract AncillaToken is ERC20, ERC20Permit, ERC20Votes, ERC20Capped, Ownable {
    constructor(
        uint256 cap,
        address initialOwner
    ) ERC20("Ancilla", "ANCILLA") ERC20Permit("Ancilla") ERC20Capped(cap) Ownable(initialOwner) {}

    /// @notice Mints `amount` to `to`, up to the immutable cap. Reverts via
    /// ERC20Capped's own check if it would exceed the cap — not re-checked
    /// here, no reason to duplicate that logic.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // ---------------------------------------------------------------
    // The functions below are NOT new behavior — they're Solidity's
    // required disambiguation for a token that inherits _update()/nonces()
    // along two different paths (ERC20Votes and ERC20Capped both hook
    // _update(); ERC20Permit and the base Nonces both define nonces()).
    // This is the standard shape for this exact combination, not a
    // custom addition.
    // ---------------------------------------------------------------

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes, ERC20Capped) {
        super._update(from, to, value);
    }

    function nonces(address owner_) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner_);
    }

    /// @notice Voting checkpoints (and AncillaGovernor, which follows this
    /// token's clock — see GovernorVotes.clock()) run on real wall-clock
    /// timestamps, NOT the default block-number mode. On Arbitrum, the
    /// `block.number` opcode a contract sees is the L1 Ethereum block
    /// height, not the L2 block count RPC tooling (ethers'
    /// getBlockNumber(), any explorer) reports — two completely different
    /// counters advancing at different rates. Block-number voting
    /// snapshots would be checked against the wrong scale entirely. Same
    /// reasoning IntentCommitReveal.sol already documents for using
    /// block.timestamp-based epochs instead of block-count ones.
    function clock() public view override returns (uint48) {
        return Time.timestamp();
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }
}
```

## Tests: AncillaStaking.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("AncillaStaking", function () {
  const CAP = ethers.parseEther("1000000");

  async function deploy() {
    const [owner, alice, bob, funder] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("AncillaToken");
    const token = await Token.deploy(CAP, owner.address);
    await token.waitForDeployment();

    const Staking = await ethers.getContractFactory("AncillaStaking");
    const staking = await Staking.deploy(await token.getAddress());
    await staking.waitForDeployment();
    const stakingAddress = await staking.getAddress();

    await token.connect(owner).mint(alice.address, ethers.parseEther("1000"));
    await token.connect(owner).mint(bob.address, ethers.parseEther("1000"));
    await token.connect(alice).approve(stakingAddress, ethers.MaxUint256);
    await token.connect(bob).approve(stakingAddress, ethers.MaxUint256);

    return { token, staking, stakingAddress, owner, alice, bob, funder };
  }

  async function fundWith(funder, stakingAddress, amountEth) {
    return funder.sendTransaction({ to: stakingAddress, value: ethers.parseEther(amountEth) });
  }

  describe("stake / withdraw", function () {
    it("stakes the exact amount, tracked per-account and in totalStaked", async function () {
      const { staking, alice } = await loadFixture(deploy);
      await expect(staking.connect(alice).stake(ethers.parseEther("100")))
        .to.emit(staking, "Staked")
        .withArgs(alice.address, ethers.parseEther("100"));
      expect(await staking.staked(alice.address)).to.equal(ethers.parseEther("100"));
      expect(await staking.totalStaked()).to.equal(ethers.parseEther("100"));
    });

    it("moves the actual ANCILLA tokens into the contract", async function () {
      const { token, staking, stakingAddress, alice } = await loadFixture(deploy);
      await staking.connect(alice).stake(ethers.parseEther("100"));
      expect(await token.balanceOf(stakingAddress)).to.equal(ethers.parseEther("100"));
      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("900"));
    });

    it("rejects staking zero", async function () {
      const { staking, alice } = await loadFixture(deploy);
      await expect(staking.connect(alice).stake(0)).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("rejects withdrawing more than staked", async function () {
      const { staking, alice } = await loadFixture(deploy);
      await staking.connect(alice).stake(ethers.parseEther("10"));
      await expect(staking.connect(alice).withdraw(ethers.parseEther("11"))).to.be.revertedWithCustomError(
        staking,
        "InsufficientStake"
      );
    });

    it("withdraw returns the exact tokens and drops totalStaked", async function () {
      const { token, staking, alice } = await loadFixture(deploy);
      await staking.connect(alice).stake(ethers.parseEther("100"));
      await expect(staking.connect(alice).withdraw(ethers.parseEther("40")))
        .to.emit(staking, "Withdrawn")
        .withArgs(alice.address, ethers.parseEther("40"));
      expect(await staking.staked(alice.address)).to.equal(ethers.parseEther("60"));
      expect(await staking.totalStaked()).to.equal(ethers.parseEther("60"));
      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("940"));
    });
  });

  describe("revenue distribution — the actual point of this contract", function () {
    it("reverts a plain ETH transfer if nobody is staked yet, instead of stranding it", async function () {
      const { staking, stakingAddress, funder } = await loadFixture(deploy);
      await expect(fundWith(funder, stakingAddress, "1")).to.be.revertedWithCustomError(staking, "NoStakersYet");
    });

    it("a single staker earns 100% of a plain ETH transfer (mirrors AncillaTreasuryMultisig's no-calldata send)", async function () {
      const { staking, stakingAddress, alice, funder } = await loadFixture(deploy);
      await staking.connect(alice).stake(ethers.parseEther("100"));
      await expect(fundWith(funder, stakingAddress, "1"))
        .to.emit(staking, "RevenueDistributed")
        .withArgs(ethers.parseEther("1"), ethers.parseEther("100"));
      expect(await staking.earned(alice.address)).to.equal(ethers.parseEther("1"));
    });

    it("two unequal stakers split revenue exactly pro-rata to their stake at funding time", async function () {
      const { staking, stakingAddress, alice, bob, funder } = await loadFixture(deploy);
      await staking.connect(alice).stake(ethers.parseEther("300")); // 75%
      await staking.connect(bob).stake(ethers.parseEther("100")); // 25%
      await fundWith(funder, stakingAddress, "4");
      expect(await staking.earned(alice.address)).to.equal(ethers.parseEther("3"));
      expect(await staking.earned(bob.address)).to.equal(ethers.parseEther("1"));
    });

    it("a staker who joins AFTER a distribution earns nothing from it — proves this isn't a flat airdrop", async function () {
      const { staking, stakingAddress, alice, bob, funder } = await loadFixture(deploy);
      await staking.connect(alice).stake(ethers.parseEther("100"));
      await fundWith(funder, stakingAddress, "1");
      await staking.connect(bob).stake(ethers.parseEther("100"));
      expect(await staking.earned(alice.address)).to.equal(ethers.parseEther("1"));
      expect(await staking.earned(bob.address)).to.equal(0);
    });

    it("claim() pays the exact accrued ETH and zeroes the balance, verified by real ETH delta not the return value", async function () {
      const { staking, stakingAddress, alice, funder } = await loadFixture(deploy);
      await staking.connect(alice).stake(ethers.parseEther("100"));
      await fundWith(funder, stakingAddress, "2");

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await staking.connect(alice).claim();
      const receipt = await tx.wait();
      const gasCost = receipt .gasUsed * receipt .gasPrice;
      const after = await ethers.provider.getBalance(alice.address);

      expect(after - before + gasCost).to.equal(ethers.parseEther("2"));
      expect(await staking.earned(alice.address)).to.equal(0);
    });

    it("withdrawing partially does not forfeit already-accrued rewards", async function () {
      const { staking, stakingAddress, alice, funder } = await loadFixture(deploy);
      await staking.connect(alice).stake(ethers.parseEther("100"));
      await fundWith(funder, stakingAddress, "1");
      await staking.connect(alice).withdraw(ethers.parseEther("50"));
      expect(await staking.earned(alice.address)).to.equal(ethers.parseEther("1"));
    });

    it("a second, later distribution correctly accounts for a stake change in between", async function () {
      const { staking, stakingAddress, alice, bob, funder } = await loadFixture(deploy);
      await staking.connect(alice).stake(ethers.parseEther("100"));
      await fundWith(funder, stakingAddress, "1"); // alice alone: +1 ETH
      await staking.connect(bob).stake(ethers.parseEther("100")); // now 50/50
      await fundWith(funder, stakingAddress, "2"); // split: +1 each
      expect(await staking.earned(alice.address)).to.equal(ethers.parseEther("2"));
      expect(await staking.earned(bob.address)).to.equal(ethers.parseEther("1"));
    });
  });
});
```
