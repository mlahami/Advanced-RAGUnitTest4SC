# tsvguard--themis-labs

- domain: rate-limiting (rate-limiting)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/themis-labs/tsv-aegis @ 8cdf770f9377d41c075dbe834c5f737e543b7f38
- license: MIT
- targets: TSVGuard.sol, IERC8392.sol
- validation: 16 passing tests, 0 failing; statement coverage TSVGuard.sol 95.45 %, IERC8392.sol 100.0 %

## Contract: IERC8392.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Interface definitions adapted from the ERC-8392 draft "Asset Status
///         Interface for Tokenized Assets" (first circulated as ERC-8391).
///         The draft standardizes token-level operational status discovery:
///         every enum reserves UNKNOWN = 0, views never revert, and return
///         values never depend on msg.sender.
///         Ref: https://ethereum-magicians.org/t/erc-8392-asset-status-interface-for-tokenized-assets/29489
interface IAssetStatus {
    /// @dev Lifecycle of the token program itself.
    enum Lifecycle {
        UNKNOWN, // 0 — status unavailable
        PRE_ACTIVE, // program announced/deployed, not yet operational
        ACTIVE, // normal operation
        SETTLEMENT_PENDING, // terminal event in progress (merger cash-out, wind-down)
        TERMINATED // program concluded; token is a claim residue at most
    }

    /// @dev Operational status of the program, orthogonal to lifecycle.
    enum ProgramStatus {
        UNKNOWN, // 0
        NORMAL, // issuer operations functioning as designed
        SUSPENDED // issuer has suspended normal operations (ops/legal/technical)
    }

    /// @notice Current program status. MUST NOT revert; MUST NOT depend on msg.sender.
    /// @return lifecycle       lifecycle state of the token program
    /// @return programStatus   operational status
    /// @return lifecycleAsOf   unix time lifecycle was last affirmed (0 = unknown)
    /// @return programAsOf     unix time programStatus was last affirmed (0 = unknown)
    function assetStatus()
        external
        view
        returns (
            Lifecycle lifecycle,
            ProgramStatus programStatus,
            uint64 lifecycleAsOf,
            uint64 programAsOf
        );
}

interface IReferenceMarketStatus {
    /// @dev Scheduled session state of the reference market.
    enum Session {
        UNKNOWN, // 0
        REGULAR, // continuous trading in the venue's primary session
        EXTENDED, // any scheduled non-primary trading session
        AUCTION, // scheduled or triggered auction/call phase
        CLOSED // any scheduled non-trading period, including intraday breaks
    }

    /// @dev Unscheduled interruption state, orthogonal to Session.
    enum Interruption {
        UNKNOWN, // 0
        NONE, // no known interruption
        PRICE_CONSTRAINED, // trading continues but constrained by a price-limit mechanism
        ASSET_HALTED, // this asset specifically halted by the venue
        VENUE_HALTED // the venue/market as a whole halted
    }

    /// @notice Session and interruption state of the reference market.
    /// @return session                 scheduled session state
    /// @return interruption            unscheduled interruption state
    /// @return sessionAsOf             unix time session state last affirmed
    /// @return interruptionAsOf        unix time interruption state last affirmed
    /// @return nextScheduledTransition unix time of next scheduled session change
    ///                                 (0 = unknown); scheduled transitions only
    /// @return marketId                ISO 10383 MIC as uppercase ASCII,
    ///                                 right-padded with zero bytes
    ///                                 (bytes32(0) = unknown or no listed venue)
    function referenceMarketStatus()
        external
        view
        returns (
            Session session,
            Interruption interruption,
            uint64 sessionAsOf,
            uint64 interruptionAsOf,
            uint64 nextScheduledTransition,
            bytes32 marketId
        );
}
```

## Contract: TSVGuard.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAssetStatus, IReferenceMarketStatus} from "./IERC8392.sol";

/// @title TSVGuard
/// @notice Compliance shield for tokenized NMS stock trading under the SEC
///         Innovation Exemption (order of 2026-09-17, press release 2026-90).
///         Two independent stop conditions:
///         1. a market halt relayed from traditional venues (LULD), matching
///            the order's concurrent-stoppage condition;
///         2. a per-day volume cap (0.25% / 2.5% of prior-month ADV by tier).
///         The two conditions use separate flags on purpose: a daily volume
///         rollover must never clear an active market halt.
/// @dev    Exposes the ERC-8392 (draft) asset status surface so integrators
///         can read halt state through the standard interface instead of
///         bespoke getters. Aegis is a venue-facing guard, not a token, so
///         the surface covers the dimensions it can attest to: program
///         status, reference-market interruption, and reference-market
///         session. Session state is relayed by the oracle's session clock
///         and is informational only — it never gates tradingEnabled().
contract TSVGuard is AccessControl, IAssetStatus, IReferenceMarketStatus {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    bool public marketHalted;
    uint256 public maxDailyCap;
    uint256 public currentDailyVolume;
    uint64 public currentDay; // UTC day index: block.timestamp / 1 days
    /// @notice Last time the oracle pushed a halt/resume signal (0 = never).
    uint64 public haltStatusUpdatedAt;
    /// @notice Reference-market session as last reported by the oracle.
    ///         Informational for ERC-8392 consumers; never gates trading.
    Session public marketSession;
    uint64 public sessionUpdatedAt;
    uint64 public nextSessionTransition;
    /// @notice ISO 10383 MIC of the reference market, uppercase ASCII
    ///         right-padded with zero bytes (bytes32(0) = not configured).
    bytes32 public referenceMarketId;

    uint64 private immutable deployedAt;

    event HaltUpdated(bool halted, string reason);
    event MaxDailyCapUpdated(uint256 oldCap, uint256 newCap);
    event VolumeRecorded(uint64 indexed day, uint256 added, uint256 dailyTotal);
    event CapBreached(uint64 indexed day, uint256 dailyTotal, uint256 maxDailyCap);
    event SessionUpdated(Session session, uint64 nextScheduledTransition);
    event MarketIdUpdated(bytes32 marketId);

    error ZeroAddress();
    error ZeroCap();
    error InvalidSession(uint8 session);

    constructor(address oracle, uint256 _maxDailyCap) {
        if (oracle == address(0)) revert ZeroAddress();
        if (_maxDailyCap == 0) revert ZeroCap();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, oracle);
        maxDailyCap = _maxDailyCap;
        currentDay = uint64(block.timestamp / 1 days);
        deployedAt = uint64(block.timestamp);
    }

    /// @notice Daily total after lazy day rollover (no write required).
    function effectiveDailyVolume() public view returns (uint256) {
        // Strict equality is intended: day indices are discrete UTC-day
        // counters, so "same day" is exactly the condition we want.
        // slither-disable-next-line incorrect-equality
        return uint64(block.timestamp / 1 days) == currentDay ? currentDailyVolume : 0;
    }

    /// @notice Whether trading is currently allowed.
    function tradingEnabled() public view returns (bool) {
        return !marketHalted && effectiveDailyVolume() < maxDailyCap;
    }

    /// @notice Relay a halt/resume signal from the underlying market.
    function setStockHaltStatus(bool isHalted) external onlyRole(ORACLE_ROLE) {
        marketHalted = isHalted;
        haltStatusUpdatedAt = uint64(block.timestamp);
        emit HaltUpdated(
            isHalted,
            isHalted ? "Underlying NMS stock halted (LULD)" : "Underlying NMS stock resumed"
        );
    }

    /// @notice Report the reference market's current session and the next
    ///         scheduled session transition. Informational only: session
    ///         state never gates tradingEnabled() — whether pre/post-market
    ///         trading is allowed is the venue's own policy decision.
    function setMarketSession(uint8 session, uint64 nextTransition) external onlyRole(ORACLE_ROLE) {
        if (session > uint8(Session.CLOSED)) revert InvalidSession(session);
        marketSession = Session(session);
        sessionUpdatedAt = uint64(block.timestamp);
        nextSessionTransition = nextTransition;
        emit SessionUpdated(Session(session), nextTransition);
    }

    /// @notice Set the reference market's MIC (e.g. "XNYS" for NYSE), as
    ///         uppercase ASCII right-padded with zero bytes.
    function setMarketId(bytes32 newMarketId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        referenceMarketId = newMarketId;
        emit MarketIdUpdated(newMarketId);
    }

    /// @notice Update the daily volume cap (e.g. monthly ADV recalibration).
    function setMaxDailyCap(uint256 newCap) external onlyRole(ORACLE_ROLE) {
        if (newCap == 0) revert ZeroCap();
        emit MaxDailyCapUpdated(maxDailyCap, newCap);
        maxDailyCap = newCap;
    }

    /// @notice Record traded volume; emits CapBreached once the cap is hit.
    function recordVolume(uint256 addedVolume) external onlyRole(ORACLE_ROLE) {
        _rollDay();
        currentDailyVolume += addedVolume;
        emit VolumeRecorded(currentDay, addedVolume, currentDailyVolume);
        if (currentDailyVolume >= maxDailyCap) {
            emit CapBreached(currentDay, currentDailyVolume, maxDailyCap);
        }
    }

    /// @notice Permissionless day rollover; also callable by Keepers as a
    ///         scheduled job. Trading state re-derives lazily either way.
    function rollDay() external {
        _rollDay();
    }

    /// @notice ERC-8392 (draft): program lifecycle and operational status.
    ///         The guard program is ACTIVE/NORMAL from deployment; operational
    ///         interventions (halts, caps) are reference-market or venue-level
    ///         conditions, not program suspensions.
    function assetStatus()
        external
        view
        override
        returns (
            Lifecycle lifecycle,
            ProgramStatus programStatus,
            uint64 lifecycleAsOf,
            uint64 programAsOf
        )
    {
        return (Lifecycle.ACTIVE, ProgramStatus.NORMAL, deployedAt, deployedAt);
    }

    /// @notice ERC-8392 (draft): reference-market session and interruption.
    ///         Interruption maps from the halt flag; before the first oracle
    ///         push it reports UNKNOWN so uninitialized state never reads as
    ///         a healthy market. Session comes from the oracle's session
    ///         clock (scripts/session.js) and likewise reports UNKNOWN until
    ///         the first push. Session reporting is informational — it does
    ///         not gate tradingEnabled().
    function referenceMarketStatus()
        external
        view
        override
        returns (
            Session session,
            Interruption interruption,
            uint64 sessionAsOf,
            uint64 interruptionAsOf,
            uint64 nextScheduledTransition,
            bytes32 marketId
        )
    {
        // Zero means the oracle has never pushed a status, so strict
        // equality against 0 is exactly the condition we want.
        // slither-disable-next-line incorrect-equality
        interruption = haltStatusUpdatedAt == 0
            ? Interruption.UNKNOWN
            : (marketHalted ? Interruption.ASSET_HALTED : Interruption.NONE);
        return (
            marketSession,
            interruption,
            sessionUpdatedAt,
            haltStatusUpdatedAt,
            nextSessionTransition,
            referenceMarketId
        );
    }

    /// @notice ERC-165: advertise the ERC-8392 (draft) interfaces.
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return
            interfaceId == type(IAssetStatus).interfaceId ||
            interfaceId == type(IReferenceMarketStatus).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function _rollDay() internal {
        uint64 day = uint64(block.timestamp / 1 days);
        if (day != currentDay) {
            currentDay = day;
            currentDailyVolume = 0;
        }
    }
}
```

## Tests: TSVGuard.test.js

```javascript
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('TSVGuard', function () {
  const CAP = ethers.parseUnits('1000', 18);
  let admin, oracle, stranger, guard;

  beforeEach(async function () {
    [admin, oracle, stranger] = await ethers.getSigners();
    const TSVGuard = await ethers.getContractFactory('TSVGuard');
    guard = await TSVGuard.deploy(oracle.address, CAP);
  });

  it('grants roles and starts with trading enabled', async function () {
    const ORACLE_ROLE = await guard.ORACLE_ROLE();
    expect(await guard.hasRole(ORACLE_ROLE, oracle.address)).to.equal(true);
    expect(await guard.hasRole(await guard.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    expect(await guard.tradingEnabled()).to.equal(true);
  });

  it('reverts on zero oracle address or zero cap', async function () {
    const TSVGuard = await ethers.getContractFactory('TSVGuard');
    await expect(TSVGuard.deploy(ethers.ZeroAddress, CAP)).to.be.revertedWithCustomError(
      TSVGuard,
      'ZeroAddress',
    );
    await expect(TSVGuard.deploy(oracle.address, 0)).to.be.revertedWithCustomError(
      TSVGuard,
      'ZeroCap',
    );
  });

  it('halts and resumes on oracle signal', async function () {
    await expect(guard.connect(oracle).setStockHaltStatus(true))
      .to.emit(guard, 'HaltUpdated')
      .withArgs(true, 'Underlying NMS stock halted (LULD)');
    expect(await guard.tradingEnabled()).to.equal(false);

    await guard.connect(oracle).setStockHaltStatus(false);
    expect(await guard.tradingEnabled()).to.equal(true);
  });

  it('rejects state changes from non-oracle accounts', async function () {
    const ORACLE_ROLE = await guard.ORACLE_ROLE();
    await expect(guard.connect(stranger).setStockHaltStatus(true))
      .to.be.revertedWithCustomError(guard, 'AccessControlUnauthorizedAccount')
      .withArgs(stranger.address, ORACLE_ROLE);
    await expect(guard.connect(stranger).recordVolume(1)).to.be.revertedWithCustomError(
      guard,
      'AccessControlUnauthorizedAccount',
    );
  });

  it('blocks trading once the daily cap is reached', async function () {
    await guard.connect(oracle).recordVolume(CAP - 1n);
    expect(await guard.tradingEnabled()).to.equal(true);

    await expect(guard.connect(oracle).recordVolume(1n)).to.emit(guard, 'CapBreached');
    expect(await guard.tradingEnabled()).to.equal(false);
  });

  it('re-enables trading on the next UTC day (lazy rollover)', async function () {
    await guard.connect(oracle).recordVolume(CAP);
    expect(await guard.tradingEnabled()).to.equal(false);

    await time.increase(1 * 24 * 60 * 60 + 1);
    expect(await guard.tradingEnabled()).to.equal(true);
    expect(await guard.effectiveDailyVolume()).to.equal(0n);

    await guard.connect(oracle).recordVolume(10n);
    expect(await guard.currentDailyVolume()).to.equal(10n);
  });

  it('does NOT clear a market halt on day rollover', async function () {
    await guard.connect(oracle).setStockHaltStatus(true);
    await time.increase(2 * 24 * 60 * 60);
    expect(await guard.marketHalted()).to.equal(true);
    expect(await guard.tradingEnabled()).to.equal(false);
  });

  it('lets the oracle update the daily cap', async function () {
    const newCap = ethers.parseUnits('2000', 18);
    await expect(guard.connect(oracle).setMaxDailyCap(newCap))
      .to.emit(guard, 'MaxDailyCapUpdated')
      .withArgs(CAP, newCap);
    expect(await guard.maxDailyCap()).to.equal(newCap);
    await expect(guard.connect(oracle).setMaxDailyCap(0)).to.be.revertedWithCustomError(
      guard,
      'ZeroCap',
    );
  });

  describe('ERC-8392 status surface', function () {
    it('advertises the ERC-8392 interface IDs via ERC-165', async function () {
      // IDs from the draft spec: each interface has exactly one function,
      // so the interface ID equals that function's selector.
      expect(await guard.supportsInterface('0xfecd6b9b')).to.equal(true); // IAssetStatus
      expect(await guard.supportsInterface('0xfe1d1980')).to.equal(true); // IReferenceMarketStatus
      expect(await guard.supportsInterface('0xffffffff')).to.equal(false);
    });

    it('reports ACTIVE/NORMAL program status from deployment', async function () {
      const status = await guard.assetStatus();
      expect(status.lifecycle).to.equal(2n); // ACTIVE
      expect(status.programStatus).to.equal(1n); // NORMAL
      expect(status.lifecycleAsOf).to.equal(await time.latest());
      expect(status.programAsOf).to.equal(await time.latest());
    });

    it('reports UNKNOWN interruption before the first oracle push', async function () {
      const status = await guard.referenceMarketStatus();
      expect(status.session).to.equal(0n); // UNKNOWN
      expect(status.interruption).to.equal(0n); // UNKNOWN, never reads as healthy
      expect(status.sessionAsOf).to.equal(0n);
      expect(status.interruptionAsOf).to.equal(0n);
      expect(status.nextScheduledTransition).to.equal(0n);
      expect(status.marketId).to.equal(ethers.ZeroHash);
    });

    it('maps halt/resume pushes to the standard interruption enum', async function () {
      await guard.connect(oracle).setStockHaltStatus(true);
      let status = await guard.referenceMarketStatus();
      expect(status.interruption).to.equal(3n); // ASSET_HALTED
      expect(status.interruptionAsOf).to.equal(await time.latest());

      await guard.connect(oracle).setStockHaltStatus(false);
      status = await guard.referenceMarketStatus();
      expect(status.interruption).to.equal(1n); // NONE
      expect(status.interruptionAsOf).to.equal(await time.latest());
    });

    it('reports the session relayed by the oracle', async function () {
      const next = (await time.latest()) + 3600;
      await expect(guard.connect(oracle).setMarketSession(1, next)) // REGULAR
        .to.emit(guard, 'SessionUpdated')
        .withArgs(1, next);

      const status = await guard.referenceMarketStatus();
      expect(status.session).to.equal(1n); // REGULAR
      expect(status.sessionAsOf).to.equal(await time.latest());
      expect(status.nextScheduledTransition).to.equal(next);
    });

    it('rejects invalid session values and non-oracle callers', async function () {
      await expect(guard.connect(oracle).setMarketSession(5, 0)).to.be.revertedWithCustomError(
        guard,
        'InvalidSession',
      );
      await expect(guard.connect(stranger).setMarketSession(1, 0))
        .to.be.revertedWithCustomError(guard, 'AccessControlUnauthorizedAccount')
        .withArgs(stranger.address, await guard.ORACLE_ROLE());
    });

    it('keeps session reporting orthogonal to halts and tradingEnabled', async function () {
      await guard.connect(oracle).setMarketSession(4, 0); // CLOSED
      // A closed session is informational: it must not gate trading.
      expect(await guard.tradingEnabled()).to.equal(true);

      await guard.connect(oracle).setStockHaltStatus(true);
      const status = await guard.referenceMarketStatus();
      expect(status.session).to.equal(4n); // CLOSED survives the halt push
      expect(status.interruption).to.equal(3n); // ASSET_HALTED
      expect(await guard.tradingEnabled()).to.equal(false);
    });

    it('lets the admin set the reference market MIC', async function () {
      const XNYS = ethers.encodeBytes32String('XNYS');
      await expect(guard.connect(admin).setMarketId(XNYS))
        .to.emit(guard, 'MarketIdUpdated')
        .withArgs(XNYS);

      const status = await guard.referenceMarketStatus();
      expect(status.marketId).to.equal(XNYS);

      await expect(guard.connect(oracle).setMarketId(XNYS)).to.be.revertedWithCustomError(
        guard,
        'AccessControlUnauthorizedAccount',
      );
    });
  });
});
```
