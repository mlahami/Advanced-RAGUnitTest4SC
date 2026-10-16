# pledge-vault--winsznx

- domain: staking-yield (yield-vault)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/winsznx/float @ ae8d6dba8b5f2920b787855cba7b5695c0349bf8
- license: MIT
- targets: PledgeVault.sol, TestUSDC.sol
- validation: 24 passing tests, 0 failing; statement coverage PledgeVault.sol 100.0 %, TestUSDC.sol 50.0 %

## Contract: PledgeVault.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PledgeVault
/// @notice Commitment device with real stakes. The pledger locks tokens in
///         this vault against a goal. A witness resolves the pledge: success
///         returns the stake to the pledger, failure fires it to the
///         pre-nominated failure destination. If the witness never acts,
///         anyone may slash after the deadline plus a grace window.
///
///         The witness is notified AT the deadline (product behavior), so
///         resolution stays valid after the deadline; WITNESS_GRACE_PERIOD
///         exists so a griefer cannot front-run the witness with claimExpired
///         one second past the deadline. failureDestination is a per-pledge
///         parameter — any nonzero address — by design; the curated list is
///         a frontend concern.
contract PledgeVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Window after the deadline in which only the witness can act.
    uint64 public constant WITNESS_GRACE_PERIOD = 72 hours;

    struct Pledge {
        address pledger;
        address witness;
        address failureDestination;
        address token;
        uint256 amount;
        uint64 deadline; // unix seconds
        bool resolved;
        bool succeeded;
    }

    mapping(bytes32 => Pledge) private _pledges;
    uint256 private _nonce;

    event PledgeCreated(
        bytes32 indexed pledgeId,
        address indexed pledger,
        address indexed witness,
        address token,
        uint256 amount,
        uint64 deadline,
        address failureDestination
    );

    event PledgeSucceeded(bytes32 indexed pledgeId, address indexed witness, uint256 amountReturned);

    event PledgeFailed(
        bytes32 indexed pledgeId,
        address indexed witness,
        address indexed failureDestination,
        uint256 amountSlashed
    );

    event PledgeExpiredSlashed(
        bytes32 indexed pledgeId,
        address indexed caller,
        address indexed failureDestination,
        uint256 amountSlashed
    );

    error PledgeNotFound();
    error NotWitness();
    error AlreadyResolved();
    error ZeroAddress();
    error ZeroAmount();
    error WitnessIsPledger();
    error DeadlineInPast();
    error GracePeriodActive(uint64 claimableAt);

    /// @notice Lock `amount` of `token` against a goal. Pulls the stake into
    ///         the vault; the pledger must have approved it beforehand.
    function createPledge(
        address witness,
        address failureDestination,
        address token,
        uint256 amount,
        uint64 deadline
    ) external nonReentrant returns (bytes32 pledgeId) {
        if (witness == address(0) || token == address(0)) revert ZeroAddress();
        if (failureDestination == address(0)) revert ZeroAddress();
        if (witness == msg.sender) revert WitnessIsPledger();
        if (amount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert DeadlineInPast();

        pledgeId = keccak256(abi.encode(msg.sender, witness, token, _nonce++));

        _pledges[pledgeId] = Pledge({
            pledger: msg.sender,
            witness: witness,
            failureDestination: failureDestination,
            token: token,
            amount: amount,
            deadline: deadline,
            resolved: false,
            succeeded: false
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit PledgeCreated(pledgeId, msg.sender, witness, token, amount, deadline, failureDestination);
    }

    /// @notice Witness confirms the goal was met: stake returns to the pledger.
    ///         Valid any time before another resolution path lands — early
    ///         completion and post-deadline confirmation both work.
    function confirmSuccess(bytes32 pledgeId) external nonReentrant {
        Pledge storage pledge = _loadForWitness(pledgeId);

        pledge.resolved = true;
        pledge.succeeded = true;

        IERC20(pledge.token).safeTransfer(pledge.pledger, pledge.amount);

        emit PledgeSucceeded(pledgeId, msg.sender, pledge.amount);
    }

    /// @notice Witness confirms failure: the stake fires to the nominated
    ///         failure destination. That was the point.
    function confirmFailure(bytes32 pledgeId) external nonReentrant {
        Pledge storage pledge = _loadForWitness(pledgeId);

        pledge.resolved = true;

        IERC20(pledge.token).safeTransfer(pledge.failureDestination, pledge.amount);

        emit PledgeFailed(pledgeId, msg.sender, pledge.failureDestination, pledge.amount);
    }

    /// @notice Permissionless slash when the witness never acted: callable by
    ///         anyone once the deadline plus grace window has fully passed.
    function claimExpired(bytes32 pledgeId) external nonReentrant {
        Pledge storage pledge = _pledges[pledgeId];

        if (pledge.pledger == address(0)) revert PledgeNotFound();
        if (pledge.resolved) revert AlreadyResolved();

        uint64 claimableAt = pledge.deadline + WITNESS_GRACE_PERIOD;
        if (block.timestamp <= claimableAt) revert GracePeriodActive(claimableAt);

        pledge.resolved = true;

        IERC20(pledge.token).safeTransfer(pledge.failureDestination, pledge.amount);

        emit PledgeExpiredSlashed(pledgeId, msg.sender, pledge.failureDestination, pledge.amount);
    }

    /// @notice Full pledge state, for the indexer and any off-chain reader.
    function getPledge(bytes32 pledgeId) external view returns (Pledge memory) {
        return _pledges[pledgeId];
    }

    function _loadForWitness(bytes32 pledgeId) private view returns (Pledge storage pledge) {
        pledge = _pledges[pledgeId];
        if (pledge.pledger == address(0)) revert PledgeNotFound();
        if (msg.sender != pledge.witness) revert NotWitness();
        if (pledge.resolved) revert AlreadyResolved();
    }
}
```

## Contract: TestUSDC.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Six-decimal mintable ERC20 mirroring USDC's shape. Test suite only —
///         never deployed to a public network (Sepolia uses Circle's USDC).
contract TestUSDC is ERC20 {
    constructor() ERC20("Test USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: PledgeVault.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const USDC = (n) => ethers.parseUnits(String(n), 6);
const GRACE = 72n * 3600n;

describe("PledgeVault", () => {
  async function deployFixture() {
    const [pledger, witness, other, destination] = await ethers.getSigners();

    const usdc = await (await ethers.getContractFactory("TestUSDC")).deploy();
    const vault = await (await ethers.getContractFactory("PledgeVault")).deploy();

    await usdc.mint(pledger.address, USDC(1_000));
    await usdc.connect(pledger).approve(await vault.getAddress(), USDC(1_000));

    return { vault, usdc, pledger, witness, other, destination };
  }

  async function lockedPledgeFixture() {
    const base = await deployFixture();
    const { vault, usdc, pledger, witness, destination } = base;

    const deadline = BigInt(await time.latest()) + 14n * 24n * 3600n;
    const pledgeId = await vault
      .connect(pledger)
      .createPledge.staticCall(witness.address, destination.address, await usdc.getAddress(), USDC(200), deadline);
    await vault
      .connect(pledger)
      .createPledge(witness.address, destination.address, await usdc.getAddress(), USDC(200), deadline);

    return { ...base, pledgeId, deadline };
  }

  describe("createPledge", () => {
    it("locks the stake in the vault and emits the full pledge", async () => {
      const { vault, usdc, pledger, witness, destination } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;

      await expect(
        vault
          .connect(pledger)
          .createPledge(witness.address, destination.address, await usdc.getAddress(), USDC(200), deadline)
      )
        .to.emit(vault, "PledgeCreated")
        .withArgs(
          (id) => ethers.isHexString(id, 32),
          pledger.address,
          witness.address,
          await usdc.getAddress(),
          USDC(200),
          deadline,
          destination.address
        );

      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(USDC(200));
      expect(await usdc.balanceOf(pledger.address)).to.equal(USDC(800));
    });

    it("persists exact state readable via getPledge", async () => {
      const { vault, usdc, pledger, witness, destination, pledgeId, deadline } = await loadFixture(
        lockedPledgeFixture
      );
      const pledge = await vault.getPledge(pledgeId);
      expect(pledge.pledger).to.equal(pledger.address);
      expect(pledge.witness).to.equal(witness.address);
      expect(pledge.failureDestination).to.equal(destination.address);
      expect(pledge.token).to.equal(await usdc.getAddress());
      expect(pledge.amount).to.equal(USDC(200));
      expect(pledge.deadline).to.equal(deadline);
      expect(pledge.resolved).to.equal(false);
      expect(pledge.succeeded).to.equal(false);
    });

    it("reverts on zero failure destination — the locked guard", async () => {
      const { vault, usdc, pledger, witness } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;
      await expect(
        vault
          .connect(pledger)
          .createPledge(witness.address, ethers.ZeroAddress, await usdc.getAddress(), USDC(1), deadline)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("accepts the dEaD burn address as destination (nonzero, passes guard)", async () => {
      const { vault, usdc, pledger, witness } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;
      const dead = "0x000000000000000000000000000000000000dEaD";
      await expect(
        vault.connect(pledger).createPledge(witness.address, dead, await usdc.getAddress(), USDC(1), deadline)
      ).to.not.be.reverted;
    });

    it("reverts on zero witness / zero token / zero amount", async () => {
      const { vault, usdc, pledger, witness, destination } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;
      const token = await usdc.getAddress();

      await expect(
        vault.connect(pledger).createPledge(ethers.ZeroAddress, destination.address, token, USDC(1), deadline)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
      await expect(
        vault.connect(pledger).createPledge(witness.address, destination.address, ethers.ZeroAddress, USDC(1), deadline)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
      await expect(
        vault.connect(pledger).createPledge(witness.address, destination.address, token, 0, deadline)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("reverts when the pledger names themself as witness", async () => {
      const { vault, usdc, pledger, destination } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;
      await expect(
        vault
          .connect(pledger)
          .createPledge(pledger.address, destination.address, await usdc.getAddress(), USDC(1), deadline)
      ).to.be.revertedWithCustomError(vault, "WitnessIsPledger");
    });

    it("reverts on a deadline in the past", async () => {
      const { vault, usdc, pledger, witness, destination } = await loadFixture(deployFixture);
      const past = BigInt(await time.latest()) - 1n;
      await expect(
        vault
          .connect(pledger)
          .createPledge(witness.address, destination.address, await usdc.getAddress(), USDC(1), past)
      ).to.be.revertedWithCustomError(vault, "DeadlineInPast");
    });

    it("reverts without an ERC20 approval (stake must actually lock)", async () => {
      const { vault, usdc, pledger, witness, destination } = await loadFixture(deployFixture);
      await usdc.connect(pledger).approve(await vault.getAddress(), 0);
      const deadline = BigInt(await time.latest()) + 3600n;
      await expect(
        vault
          .connect(pledger)
          .createPledge(witness.address, destination.address, await usdc.getAddress(), USDC(1), deadline)
      ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientAllowance");
    });
  });

  describe("confirmSuccess", () => {
    it("returns the stake to the pledger and emits", async () => {
      const { vault, usdc, pledger, witness, pledgeId } = await loadFixture(lockedPledgeFixture);

      await expect(vault.connect(witness).confirmSuccess(pledgeId))
        .to.emit(vault, "PledgeSucceeded")
        .withArgs(pledgeId, witness.address, USDC(200));

      expect(await usdc.balanceOf(pledger.address)).to.equal(USDC(1_000));
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(0n);
      expect((await vault.getPledge(pledgeId)).succeeded).to.equal(true);
    });

    it("works before the deadline (early completion)", async () => {
      const { vault, witness, pledgeId } = await loadFixture(lockedPledgeFixture);
      await expect(vault.connect(witness).confirmSuccess(pledgeId)).to.not.be.reverted;
    });

    it("works after the deadline — the witness is notified at the deadline", async () => {
      const { vault, witness, pledgeId, deadline } = await loadFixture(lockedPledgeFixture);
      await time.increaseTo(deadline + 3600n);
      await expect(vault.connect(witness).confirmSuccess(pledgeId)).to.not.be.reverted;
    });

    it("non-witness cannot resolve — including the pledger", async () => {
      const { vault, pledger, other, pledgeId } = await loadFixture(lockedPledgeFixture);
      await expect(vault.connect(other).confirmSuccess(pledgeId)).to.be.revertedWithCustomError(
        vault,
        "NotWitness"
      );
      await expect(vault.connect(pledger).confirmSuccess(pledgeId)).to.be.revertedWithCustomError(
        vault,
        "NotWitness"
      );
    });

    it("unknown pledge reverts", async () => {
      const { vault, witness } = await loadFixture(lockedPledgeFixture);
      await expect(
        vault.connect(witness).confirmSuccess(ethers.hexlify(ethers.randomBytes(32)))
      ).to.be.revertedWithCustomError(vault, "PledgeNotFound");
    });
  });

  describe("confirmFailure", () => {
    it("fires the stake to the failure destination and emits", async () => {
      const { vault, usdc, witness, destination, pledgeId } = await loadFixture(lockedPledgeFixture);

      await expect(vault.connect(witness).confirmFailure(pledgeId))
        .to.emit(vault, "PledgeFailed")
        .withArgs(pledgeId, witness.address, destination.address, USDC(200));

      expect(await usdc.balanceOf(destination.address)).to.equal(USDC(200));
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(0n);
      const pledge = await vault.getPledge(pledgeId);
      expect(pledge.resolved).to.equal(true);
      expect(pledge.succeeded).to.equal(false);
    });

    it("non-witness cannot confirm failure", async () => {
      const { vault, pledger, other, pledgeId } = await loadFixture(lockedPledgeFixture);
      await expect(vault.connect(other).confirmFailure(pledgeId)).to.be.revertedWithCustomError(
        vault,
        "NotWitness"
      );
      await expect(vault.connect(pledger).confirmFailure(pledgeId)).to.be.revertedWithCustomError(
        vault,
        "NotWitness"
      );
    });
  });

  describe("resolution is terminal", () => {
    it("any second resolution attempt reverts, in every combination", async () => {
      const { vault, witness, pledgeId, deadline } = await loadFixture(lockedPledgeFixture);
      await vault.connect(witness).confirmSuccess(pledgeId);

      await expect(vault.connect(witness).confirmSuccess(pledgeId)).to.be.revertedWithCustomError(
        vault,
        "AlreadyResolved"
      );
      await expect(vault.connect(witness).confirmFailure(pledgeId)).to.be.revertedWithCustomError(
        vault,
        "AlreadyResolved"
      );
      await time.increaseTo(deadline + GRACE + 1n);
      await expect(vault.claimExpired(pledgeId)).to.be.revertedWithCustomError(vault, "AlreadyResolved");
    });

    it("stake cannot be double-extracted after failure", async () => {
      const { vault, witness, pledgeId } = await loadFixture(lockedPledgeFixture);
      await vault.connect(witness).confirmFailure(pledgeId);
      await expect(vault.connect(witness).confirmFailure(pledgeId)).to.be.revertedWithCustomError(
        vault,
        "AlreadyResolved"
      );
    });
  });

  describe("claimExpired", () => {
    it("reverts before the deadline", async () => {
      const { vault, other, pledgeId, deadline } = await loadFixture(lockedPledgeFixture);
      await expect(vault.connect(other).claimExpired(pledgeId))
        .to.be.revertedWithCustomError(vault, "GracePeriodActive")
        .withArgs(deadline + GRACE);
    });

    it("reverts after the deadline while the witness grace window is open", async () => {
      const { vault, other, pledgeId, deadline } = await loadFixture(lockedPledgeFixture);
      await time.increaseTo(deadline + GRACE - 10n);
      await expect(vault.connect(other).claimExpired(pledgeId)).to.be.revertedWithCustomError(
        vault,
        "GracePeriodActive"
      );
    });

    it("slashes to the destination once deadline + grace has passed — callable by anyone", async () => {
      const { vault, usdc, other, destination, pledgeId, deadline } = await loadFixture(lockedPledgeFixture);
      await time.increaseTo(deadline + GRACE + 1n);

      await expect(vault.connect(other).claimExpired(pledgeId))
        .to.emit(vault, "PledgeExpiredSlashed")
        .withArgs(pledgeId, other.address, destination.address, USDC(200));

      expect(await usdc.balanceOf(destination.address)).to.equal(USDC(200));
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(0n);
    });

    it("witness can still resolve success inside the grace window", async () => {
      const { vault, usdc, pledger, witness, pledgeId, deadline } = await loadFixture(lockedPledgeFixture);
      await time.increaseTo(deadline + GRACE - 100n);
      await vault.connect(witness).confirmSuccess(pledgeId);
      expect(await usdc.balanceOf(pledger.address)).to.equal(USDC(1_000));
    });

    it("witness resolution and claimExpired race: first to land wins", async () => {
      const { vault, witness, other, pledgeId, deadline } = await loadFixture(lockedPledgeFixture);
      await time.increaseTo(deadline + GRACE + 1n);
      await vault.connect(other).claimExpired(pledgeId);
      await expect(vault.connect(witness).confirmSuccess(pledgeId)).to.be.revertedWithCustomError(
        vault,
        "AlreadyResolved"
      );
    });

    it("unknown pledge reverts", async () => {
      const { vault, other } = await loadFixture(lockedPledgeFixture);
      await expect(
        vault.connect(other).claimExpired(ethers.hexlify(ethers.randomBytes(32)))
      ).to.be.revertedWithCustomError(vault, "PledgeNotFound");
    });
  });

  describe("isolation", () => {
    it("resolving one pledge leaves another untouched, including balances", async () => {
      const { vault, usdc, pledger, witness, other, destination } = await loadFixture(deployFixture);
      const token = await usdc.getAddress();
      const deadline = BigInt(await time.latest()) + 3600n;

      const idA = await vault
        .connect(pledger)
        .createPledge.staticCall(witness.address, destination.address, token, USDC(100), deadline);
      await vault.connect(pledger).createPledge(witness.address, destination.address, token, USDC(100), deadline);
      const idB = await vault
        .connect(pledger)
        .createPledge.staticCall(other.address, destination.address, token, USDC(300), deadline);
      await vault.connect(pledger).createPledge(other.address, destination.address, token, USDC(300), deadline);

      await vault.connect(witness).confirmSuccess(idA);

      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(USDC(300));
      expect((await vault.getPledge(idB)).resolved).to.equal(false);
      await vault.connect(other).confirmFailure(idB);
      expect(await usdc.balanceOf(destination.address)).to.equal(USDC(300));
    });
  });
});
```
