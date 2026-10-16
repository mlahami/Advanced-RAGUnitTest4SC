# erc20-vesting--dualnova

- domain: vesting-timelock (vesting)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/DualNova/tokenization-templates @ fd6f5a9e0cea42b6a2f709d035cef5cde9328820
- license: MIT
- targets: ERC20Vesting.sol
- validation: 10 passing tests, 0 failing; statement coverage ERC20Vesting.sol 94.44 %

## Contract: ERC20Vesting.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ERC20Vesting
 * @author DualNova LLC (https://dualnova.org)
 * @notice ERC-20 with built-in per-beneficiary linear vesting and cliff.
 *         Used by DualNova for ICO/STO whitelabel platforms where the team,
 *         advisors, and seed investors receive tokens that unlock gradually.
 *
 * Design choices:
 *  - One vesting schedule per beneficiary. New schedules for the same address
 *    revert — use a separate address (multisig per beneficiary, etc.).
 *  - Linear vesting after a cliff. The cliff is a hard wall: nothing claimable
 *    before it elapses, then the full cliff portion becomes claimable atomically,
 *    and the rest unlocks linearly to the end.
 *  - Owner can revoke a schedule (for terminated employees / advisors). The
 *    unvested portion at the moment of revocation returns to the owner.
 *  - Owner cannot modify amount/dates of an existing schedule. To change,
 *    revoke and re-grant.
 *
 * This contract is a template. Audit before mainnet use.
 */
contract ERC20Vesting is ERC20, Ownable {
    /// @notice Per-beneficiary vesting schedule.
    struct Schedule {
        /// @notice Total tokens granted to this beneficiary.
        uint128 total;
        /// @notice Tokens already released to the beneficiary.
        uint128 released;
        /// @notice Unix timestamp when vesting starts.
        uint64 start;
        /// @notice Seconds until the cliff. Nothing vests before start + cliff.
        uint32 cliffSeconds;
        /// @notice Total vesting duration in seconds (measured from start).
        uint32 durationSeconds;
        /// @notice If true, owner has revoked the schedule.
        bool revoked;
    }

    mapping(address beneficiary => Schedule) public schedules;

    event ScheduleCreated(
        address indexed beneficiary,
        uint128 total,
        uint64 start,
        uint32 cliffSeconds,
        uint32 durationSeconds
    );
    event TokensReleased(address indexed beneficiary, uint128 amount);
    event ScheduleRevoked(address indexed beneficiary, uint128 unvestedReturned);

    error ScheduleAlreadyExists(address beneficiary);
    error NoScheduleFound(address beneficiary);
    error NothingToRelease(address beneficiary);
    error AlreadyRevoked(address beneficiary);
    error InvalidSchedule();

    /**
     * @param name_ ERC-20 name (e.g. "Acme Token").
     * @param symbol_ ERC-20 symbol (e.g. "ACME").
     * @param initialSupply_ Tokens minted to the contract owner at deployment.
     * @param owner_ Address that controls grant/revoke. Should be a multisig.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        _mint(owner_, initialSupply_);
    }

    /**
     * @notice Grant a vesting schedule. The caller must already hold `total`
     *         tokens and approves the contract to pull them — they are
     *         transferred to this contract at grant time so the schedule is
     *         fully funded.
     * @param beneficiary Address that will receive tokens as they vest.
     * @param total Total tokens granted over the entire vesting period.
     * @param start Unix timestamp when vesting starts.
     * @param cliffSeconds Seconds from `start` until the cliff.
     * @param durationSeconds Total vesting duration from `start`. Must be
     *        greater than or equal to `cliffSeconds`.
     */
    function grant(
        address beneficiary,
        uint128 total,
        uint64 start,
        uint32 cliffSeconds,
        uint32 durationSeconds
    ) external onlyOwner {
        if (beneficiary == address(0) || total == 0) revert InvalidSchedule();
        if (durationSeconds < cliffSeconds) revert InvalidSchedule();
        if (schedules[beneficiary].total != 0) revert ScheduleAlreadyExists(beneficiary);

        schedules[beneficiary] = Schedule({
            total: total,
            released: 0,
            start: start,
            cliffSeconds: cliffSeconds,
            durationSeconds: durationSeconds,
            revoked: false
        });

        _transfer(_msgSender(), address(this), total);
        emit ScheduleCreated(beneficiary, total, start, cliffSeconds, durationSeconds);
    }

    /**
     * @notice Compute how many tokens are vested (claimable + already
     *         released) at the current block time.
     *         After revoke, `s.total` is frozen at the vested-at-revoke
     *         amount, so we return it directly — the linear formula no longer
     *         applies because the schedule was terminated.
     */
    function vestedAmount(address beneficiary) public view returns (uint128) {
        Schedule memory s = schedules[beneficiary];
        if (s.total == 0) return 0;
        if (s.revoked) return s.total;
        if (block.timestamp < s.start + s.cliffSeconds) return 0;
        if (block.timestamp >= s.start + s.durationSeconds) return s.total;
        uint256 elapsed = block.timestamp - s.start;
        return uint128((uint256(s.total) * elapsed) / s.durationSeconds);
    }

    /**
     * @notice Compute how many tokens can be released to the beneficiary now.
     *         After revoke, `s.total` is capped at the vested-at-revoke amount,
     *         so the beneficiary can still release everything that vested before
     *         revocation — consistent with the contract's revoke semantics.
     */
    function releasable(address beneficiary) public view returns (uint128) {
        Schedule memory s = schedules[beneficiary];
        if (s.total == 0) return 0;
        uint128 vested = vestedAmount(beneficiary);
        return vested > s.released ? vested - s.released : 0;
    }

    /**
     * @notice Release vested tokens to the beneficiary. Anyone can call this
     *         (typically the beneficiary themselves) — the tokens always go
     *         to the beneficiary regardless of the caller.
     */
    function release(address beneficiary) external {
        Schedule storage s = schedules[beneficiary];
        if (s.total == 0) revert NoScheduleFound(beneficiary);
        uint128 amount = releasable(beneficiary);
        if (amount == 0) revert NothingToRelease(beneficiary);
        s.released += amount;
        _transfer(address(this), beneficiary, amount);
        emit TokensReleased(beneficiary, amount);
    }

    /**
     * @notice Revoke a schedule. The unvested portion is transferred back to
     *         the owner. The already-vested portion remains claimable by the
     *         beneficiary even after revocation.
     */
    function revoke(address beneficiary) external onlyOwner {
        Schedule storage s = schedules[beneficiary];
        if (s.total == 0) revert NoScheduleFound(beneficiary);
        if (s.revoked) revert AlreadyRevoked(beneficiary);
        uint128 vested = vestedAmount(beneficiary);
        uint128 unvested = s.total - vested;
        // Cap the schedule total at what's already vested so future calls to
        // vestedAmount() return a stable value.
        s.total = vested;
        s.revoked = true;
        if (unvested > 0) {
            _transfer(address(this), owner(), unvested);
        }
        emit ScheduleRevoked(beneficiary, unvested);
    }
}
```

## Tests: ERC20Vesting.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const TOKEN_NAME = 'Acme Token';
const TOKEN_SYMBOL = 'ACME';
const INITIAL_SUPPLY = ethers.parseUnits('1000000', 18);

describe('ERC20Vesting', () => {
  async function deploy() {
    const [owner, beneficiary, other] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('ERC20Vesting');
    const token = (await factory.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      INITIAL_SUPPLY,
      owner .address,
    ));
    return { token, owner: owner, beneficiary: beneficiary, other: other };
  }

  it('mints the initial supply to the owner', async () => {
    const { token, owner } = await deploy();
    expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
  });

  it('rejects schedules with invalid params', async () => {
    const { token, owner, beneficiary } = await deploy();
    const start = BigInt(await time.latest()) + 100n;
    // duration < cliff
    await expect(
      token.connect(owner).grant(beneficiary.address, ethers.parseUnits('1000', 18), start, 1000, 500),
    ).to.be.revertedWithCustomError(token, 'InvalidSchedule');
    // total = 0
    await expect(
      token.connect(owner).grant(beneficiary.address, 0n, start, 100, 1000),
    ).to.be.revertedWithCustomError(token, 'InvalidSchedule');
  });

  it('grants a schedule and pulls the tokens into the contract', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await expect(token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000))
      .to.emit(token, 'ScheduleCreated')
      .withArgs(beneficiary.address, amount, start, 100, 1000);
    expect(await token.balanceOf(await token.getAddress())).to.equal(amount);
    expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - amount);
  });

  it('rejects a second schedule for the same beneficiary', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);
    await expect(
      token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000),
    ).to.be.revertedWithCustomError(token, 'ScheduleAlreadyExists');
  });

  it('returns 0 vested before cliff and full total after duration', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);

    // Before cliff
    expect(await token.vestedAmount(beneficiary.address)).to.equal(0);

    // After full duration
    await time.increaseTo(start + 1000n + 1n);
    expect(await token.vestedAmount(beneficiary.address)).to.equal(amount);
  });

  it('vests linearly between cliff and end', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);

    // Halfway through
    await time.increaseTo(start + 500n);
    const halfway = await token.vestedAmount(beneficiary.address);
    expect(halfway).to.be.closeTo(amount / 2n, ethers.parseUnits('20', 18));
  });

  it('release transfers vested tokens to the beneficiary', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);
    await time.increaseTo(start + 1000n + 1n);

    await expect(token.connect(beneficiary).release(beneficiary.address))
      .to.emit(token, 'TokensReleased')
      .withArgs(beneficiary.address, amount);
    expect(await token.balanceOf(beneficiary.address)).to.equal(amount);
  });

  it('revoke returns the unvested portion to the owner', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);

    // Halfway through, revoke
    await time.increaseTo(start + 500n);
    const ownerBalanceBefore = await token.balanceOf(owner.address);
    await token.connect(owner).revoke(beneficiary.address);

    const expectedReturned = amount / 2n;
    expect(await token.balanceOf(owner.address)).to.be.closeTo(
      ownerBalanceBefore + expectedReturned,
      ethers.parseUnits('20', 18),
    );

    // Beneficiary can still release the vested portion
    await token.connect(beneficiary).release(beneficiary.address);
    expect(await token.balanceOf(beneficiary.address)).to.be.closeTo(
      expectedReturned,
      ethers.parseUnits('20', 18),
    );
  });

  it('cannot revoke twice', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);
    await time.increaseTo(start + 500n);
    await token.connect(owner).revoke(beneficiary.address);
    await expect(token.connect(owner).revoke(beneficiary.address)).to.be.revertedWithCustomError(
      token,
      'AlreadyRevoked',
    );
  });

  it('non-owner cannot grant or revoke', async () => {
    const { token, beneficiary, other } = await deploy();
    const amount = ethers.parseUnits('1000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await expect(
      token.connect(other).grant(beneficiary.address, amount, start, 100, 1000),
    ).to.be.revertedWithCustomError(token, 'OwnableUnauthorizedAccount');
  });
});
```
