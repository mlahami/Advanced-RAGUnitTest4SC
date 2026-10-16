# depeg-guard--kcolbchain

- domain: fungible-tokens (stablecoin)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/kcolbchain/stablecoin-toolkit @ 2753ad360f14935d1485060a3006a4b6cc3129ce
- license: MIT
- targets: DepegGuard.sol, ChainlinkPoRAdapter.sol, ComplianceModule.sol, Minter.sol, ReserveManager.sol, Stablecoin.sol, BurnToll.sol, IAggregatorV3.sol, ChainlinkPoRMock.sol
- validation: 13 passing tests, 0 failing; statement coverage DepegGuard.sol 78.57 %, ChainlinkPoRAdapter.sol 0.0 %, ComplianceModule.sol 0.0 %, Minter.sol 4.76 %, ReserveManager.sol 0.0 %, Stablecoin.sol 40.0 %, BurnToll.sol 0.0 %, IAggregatorV3.sol 100.0 %, ChainlinkPoRMock.sol 38.46 %

## Contract: BurnToll.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IBurnTollFloorPool {
    function depth(address stablecoin, address burnToken) external view returns (uint256);
    function buyAndBurn(address stablecoin, address burnToken, uint256 amount) external;
}

/**
 * @title BurnToll
 * @notice Optional mint/redeem toll extension that routes stablecoin toll revenue to a floor pool for buy-and-burn execution.
 * @dev The floor pool is an adapter so deployments can wire an AMM, aggregator, or treasury execution contract without changing the minter.
 */
contract BurnToll is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BPS = 10_000;

    uint256 public mintTollBps = 50;
    uint256 public redeemTollBps = 50;
    address public burnTokenAddress;
    address public floorPoolAddress;
    uint256 public floorPoolMinDepth;
    address public minter;

    event BurnTollConfigured(
        uint256 mintTollBps,
        uint256 redeemTollBps,
        address indexed burnTokenAddress,
        address indexed floorPoolAddress,
        uint256 floorPoolMinDepth
    );
    event MinterSet(address indexed minter);
    event TollRouted(
        address indexed stablecoin, address indexed burnToken, uint256 amount, bool isRedeem
    );

    error TollBpsTooHigh(uint256 tollBps);
    error NotMinter(address caller);
    error ZeroAddress();

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter(msg.sender);
        _;
    }

    constructor(address _burnTokenAddress, address _floorPoolAddress, uint256 _floorPoolMinDepth)
        Ownable(msg.sender)
    {
        _configure(50, 50, _burnTokenAddress, _floorPoolAddress, _floorPoolMinDepth);
    }

    /**
     * @notice Sets the minter allowed to call toll routing hooks.
     * @param _minter Minter contract address.
     */
    function setMinter(address _minter) external onlyOwner {
        if (_minter == address(0)) revert ZeroAddress();
        minter = _minter;
        emit MinterSet(_minter);
    }

    /**
     * @notice Updates toll rates and routing parameters.
     * @param _mintTollBps Mint toll in basis points.
     * @param _redeemTollBps Redeem toll in basis points.
     * @param _burnTokenAddress Token bought and burned by the floor pool.
     * @param _floorPoolAddress Floor pool adapter receiving stablecoin toll revenue.
     * @param _floorPoolMinDepth Minimum floor-pool depth required before toll collection.
     */
    function configure(
        uint256 _mintTollBps,
        uint256 _redeemTollBps,
        address _burnTokenAddress,
        address _floorPoolAddress,
        uint256 _floorPoolMinDepth
    ) external onlyOwner {
        _configure(
            _mintTollBps, _redeemTollBps, _burnTokenAddress, _floorPoolAddress, _floorPoolMinDepth
        );
    }

    /**
     * @notice Calculates the mint toll for an amount, returning zero when the floor pool is not sufficiently deep.
     * @param stablecoin Stablecoin being tolled.
     * @param amount Gross mint amount.
     */
    function previewMintToll(address stablecoin, uint256 amount) external view returns (uint256) {
        return _previewToll(stablecoin, amount, mintTollBps);
    }

    /**
     * @notice Calculates the redeem toll for an amount, returning zero when the floor pool is not sufficiently deep.
     * @param stablecoin Stablecoin being tolled.
     * @param amount Gross redeem amount.
     */
    function previewRedeemToll(address stablecoin, uint256 amount) external view returns (uint256) {
        return _previewToll(stablecoin, amount, redeemTollBps);
    }

    /**
     * @notice Routes a mint toll already transferred to this contract.
     * @param stablecoin Stablecoin toll token.
     * @param amount Toll amount.
     */
    function handleMintToll(address stablecoin, uint256 amount) external onlyMinter {
        _routeToll(stablecoin, amount, false);
    }

    /**
     * @notice Routes a redeem toll already transferred to this contract.
     * @param stablecoin Stablecoin toll token.
     * @param amount Toll amount.
     */
    function handleRedeemToll(address stablecoin, uint256 amount) external onlyMinter {
        _routeToll(stablecoin, amount, true);
    }

    function _configure(
        uint256 _mintTollBps,
        uint256 _redeemTollBps,
        address _burnTokenAddress,
        address _floorPoolAddress,
        uint256 _floorPoolMinDepth
    ) internal {
        if (_mintTollBps > MAX_BPS) revert TollBpsTooHigh(_mintTollBps);
        if (_redeemTollBps > MAX_BPS) revert TollBpsTooHigh(_redeemTollBps);
        if (_burnTokenAddress == address(0) || _floorPoolAddress == address(0)) {
            revert ZeroAddress();
        }

        mintTollBps = _mintTollBps;
        redeemTollBps = _redeemTollBps;
        burnTokenAddress = _burnTokenAddress;
        floorPoolAddress = _floorPoolAddress;
        floorPoolMinDepth = _floorPoolMinDepth;

        emit BurnTollConfigured(
            _mintTollBps, _redeemTollBps, _burnTokenAddress, _floorPoolAddress, _floorPoolMinDepth
        );
    }

    function _previewToll(address stablecoin, uint256 amount, uint256 tollBps)
        internal
        view
        returns (uint256)
    {
        if (tollBps == 0 || !_hasEnoughFloorPoolDepth(stablecoin)) {
            return 0;
        }
        return (amount * tollBps) / MAX_BPS;
    }

    function _hasEnoughFloorPoolDepth(address stablecoin) internal view returns (bool) {
        return IBurnTollFloorPool(floorPoolAddress).depth(stablecoin, burnTokenAddress)
            >= floorPoolMinDepth;
    }

    function _routeToll(address stablecoin, uint256 amount, bool isRedeem) internal {
        if (amount == 0) {
            return;
        }

        IERC20(stablecoin).safeTransfer(floorPoolAddress, amount);
        IBurnTollFloorPool(floorPoolAddress).buyAndBurn(stablecoin, burnTokenAddress, amount);
        emit TollRouted(stablecoin, burnTokenAddress, amount, isRedeem);
    }
}
```

## Contract: ChainlinkPoRAdapter.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IAggregatorV3.sol";

/**
 * @title ChainlinkPoRAdapter
 * @notice Adapter to pull reserve data from Chainlink Proof of Reserves feeds.
 * @dev Part of kcolbchain/stablecoin-toolkit
 */
contract ChainlinkPoRAdapter {
    AggregatorV3Interface public immutable porFeed;

    uint8 public constant FEED_DECIMALS = 8; // Chainlink PoR feeds typically use 8 decimals

    event PorFeedSet(address indexed feed);
    event ReserveDataPulled(uint256 reserveAmount, uint256 timestamp);

    error FeedNotAvailable();
    error FeedDataStale(uint256 updatedAt);
    error InvalidFeedAnswer();

    constructor(address _porFeed) {
        if (_porFeed == address(0)) revert FeedNotAvailable();
        porFeed = AggregatorV3Interface(_porFeed);
        emit PorFeedSet(_porFeed);
    }

    /**
     * @notice Pulls the latest reserve amount from the Chainlink PoR feed.
     * @return reserveAmount The current reserve amount (already scaled to feed decimals)
     * @return updatedAt The timestamp of the last update
     */
    function getLatestReserveAmount() public view returns (uint256 reserveAmount, uint256 updatedAt) {
        try porFeed.latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt_,
            uint80
        ) {
            if (answer < 0) revert InvalidFeedAnswer();
            return (uint256(answer), updatedAt_);
        } catch {
            revert FeedNotAvailable();
        }
    }

    /**
     * @notice Converts a raw feed answer to stablecoin-equivalent units (6 decimals).
     * @dev PoR feeds typically return values with 8 decimals; this converts to 6 decimals
     *      to match the stablecoin's 6-decimal precision used in ReserveManager.
     * @param rawAmount The raw amount from the PoR feed
     * @return converted The amount converted to 6-decimal stablecoin units
     */
    function convertToStablecoinUnits(uint256 rawAmount) public pure returns (uint256 converted) {
        // Convert from 8 decimals (feed) to 6 decimals (stablecoin) = divide by 100
        return rawAmount / 100;
    }

    /**
     * @notice Convenience function that pulls and converts in one call.
     * @return reserveAmount The reserve amount in stablecoin units (6 decimals)
     * @return updatedAt The timestamp of the last feed update
     */
    function getReserveInStablecoinUnits() external returns (uint256 reserveAmount, uint256 updatedAt) {
        (uint256 rawAmount, uint256 ts) = getLatestReserveAmount();
        reserveAmount = convertToStablecoinUnits(rawAmount);
        updatedAt = ts;
        emit ReserveDataPulled(reserveAmount, ts);
    }

    /**
     * @notice Returns feed metadata (description and decimals) for off-chain verification.
     */
    function getFeedInfo() external view returns (string memory description, uint8 decimals) {
        try porFeed.description() returns (string memory desc) {
            description = desc;
        } catch {
            description = "";
        }
        try porFeed.decimals() returns (uint8 d) {
            decimals = d;
        } catch {
            decimals = FEED_DECIMALS;
        }
    }
}
```

## Contract: ChainlinkPoRMock.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IAggregatorV3.sol";

/**
 * @title ChainlinkPoRMock
 * @notice Mock aggregator that simulates Chainlink Proof of Reserves feed responses.
 * @dev For testing purposes only. DO NOT use in production.
 */
contract ChainlinkPoRMock is AggregatorV3Interface {
    string private _description = "Mock PoR Feed";
    uint8 private _decimals = 8;
    uint256 private _version = 1;

    struct RoundData {
        uint80 roundId;
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    RoundData[] private _roundHistory;
    int256 private _currentAnswer;
    uint80 private _currentRoundId;
    uint256 private _currentUpdatedAt;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    constructor(int256 initialAnswer) {
        _currentAnswer = initialAnswer;
        _currentRoundId = 1;
        _currentUpdatedAt = block.timestamp;
        _roundHistory.push(RoundData({
            roundId: 1,
            answer: initialAnswer,
            startedAt: block.timestamp,
            updatedAt: block.timestamp,
            answeredInRound: 1
        }));
    }

    function setAnswer(int256 newAnswer) external {
        _currentAnswer = newAnswer;
        _currentRoundId++;
        _currentUpdatedAt = block.timestamp;
        _roundHistory.push(RoundData({
            roundId: _currentRoundId,
            answer: newAnswer,
            startedAt: block.timestamp,
            updatedAt: block.timestamp,
            answeredInRound: _currentRoundId
        }));
        emit AnswerUpdated(newAnswer, _currentRoundId, block.timestamp);
    }

    function setAnswerWithTimestamp(int256 newAnswer, uint256 timestamp) external {
        _currentAnswer = newAnswer;
        _currentRoundId++;
        _currentUpdatedAt = timestamp;
        _roundHistory.push(RoundData({
            roundId: _currentRoundId,
            answer: newAnswer,
            startedAt: timestamp,
            updatedAt: timestamp,
            answeredInRound: _currentRoundId
        }));
        emit AnswerUpdated(newAnswer, _currentRoundId, timestamp);
    }

    function description() external view override returns (string memory) {
        return _description;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function version() external view override returns (uint256) {
        return _version;
    }

    function getRoundData(uint80 _roundId) external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        require(_roundId > 0 && _roundId <= _currentRoundId, "Round not found");
        RoundData storage round = _roundHistory[_roundId - 1];
        return (
            round.roundId,
            round.answer,
            round.startedAt,
            round.updatedAt,
            round.answeredInRound
        );
    }

    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        RoundData storage round = _roundHistory[_roundHistory.length - 1];
        return (
            round.roundId,
            round.answer,
            round.startedAt,
            round.updatedAt,
            round.answeredInRound
        );
    }

}
```

## Contract: ComplianceModule.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ComplianceModule
 * @notice KYC status, geography-based restrictions, transaction limits, sanctions.
 * @dev Part of kcolbchain/stablecoin-toolkit
 */
contract ComplianceModule is Ownable {
    enum KYCStatus { None, Pending, Approved, Rejected }

    struct AddressInfo {
        KYCStatus kycStatus;
        bytes2 geography;        // ISO 3166-1 alpha-2 (e.g. "IN", "US")
        bool sanctioned;
    }

    struct GeoConfig {
        bool allowed;
        uint256 maxTxAmount;     // max per transaction (6 decimals)
        uint256 dailyLimit;      // max per day (6 decimals)
    }

    mapping(address => AddressInfo) public addressInfo;
    mapping(bytes2 => GeoConfig) public geoConfigs;
    mapping(address => mapping(uint256 => uint256)) public dailySpent; // address -> day -> amount

    event KYCUpdated(address indexed account, KYCStatus status);
    event GeographySet(address indexed account, bytes2 geo);
    event GeoConfigUpdated(bytes2 indexed geo, bool allowed, uint256 maxTx, uint256 dailyLimit);
    event Sanctioned(address indexed account);
    event Unsanctioned(address indexed account);

    error NotKYCApproved(address account);
    error GeographyRestricted(bytes2 geo);
    error ExceedsTxLimit(uint256 amount, uint256 max);
    error ExceedsDailyLimit(uint256 spent, uint256 limit);
    error AddressSanctioned(address account);

    constructor() Ownable(msg.sender) {}

    function setKYC(address account, KYCStatus status) external onlyOwner {
        addressInfo[account].kycStatus = status;
        emit KYCUpdated(account, status);
    }

    function setGeography(address account, bytes2 geo) external onlyOwner {
        addressInfo[account].geography = geo;
        emit GeographySet(account, geo);
    }

    function configureGeography(bytes2 geo, bool allowed, uint256 maxTx, uint256 dailyLimit) external onlyOwner {
        geoConfigs[geo] = GeoConfig(allowed, maxTx, dailyLimit);
        emit GeoConfigUpdated(geo, allowed, maxTx, dailyLimit);
    }

    function sanction(address account) external onlyOwner {
        addressInfo[account].sanctioned = true;
        emit Sanctioned(account);
    }

    function unsanction(address account) external onlyOwner {
        addressInfo[account].sanctioned = false;
        emit Unsanctioned(account);
    }

    function checkCompliance(address account, uint256 amount) external view {
        AddressInfo storage info = addressInfo[account];

        if (info.sanctioned) revert AddressSanctioned(account);
        if (info.kycStatus != KYCStatus.Approved) revert NotKYCApproved(account);

        bytes2 geo = info.geography;
        if (geo != bytes2(0)) {
            GeoConfig storage gc = geoConfigs[geo];
            if (!gc.allowed) revert GeographyRestricted(geo);
            if (gc.maxTxAmount > 0 && amount > gc.maxTxAmount) {
                revert ExceedsTxLimit(amount, gc.maxTxAmount);
            }
            uint256 today = block.timestamp / 1 days;
            uint256 spent = dailySpent[account][today];
            if (gc.dailyLimit > 0 && spent + amount > gc.dailyLimit) {
                revert ExceedsDailyLimit(spent + amount, gc.dailyLimit);
            }
        }
    }

    function recordSpend(address account, uint256 amount) external onlyOwner {
        uint256 today = block.timestamp / 1 days;
        dailySpent[account][today] += amount;
    }
}
```

## Contract: DepegGuard.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./IAggregatorV3.sol";
import "./Stablecoin.sol";
import "./Minter.sol";

/**
 * @title DepegGuard
 * @notice Depeg defence watchdog for toolkit stablecoins (CR8-USD, MUSD, etc).
 * @dev See `docs/depeg-guard.md` for the full spec, state machine, threat
 *      model, and operator runbook. Part of kcolbchain/stablecoin-toolkit.
 *
 * Design goals:
 *   - Never holds user funds.
 *   - Only uses the existing public surface of `Stablecoin` and `Minter` —
 *     no callers of those contracts need to change.
 *   - Role-gated tuning + break-glass; public `poke()` for forward progress
 *     so a keeper bot can pay gas without trust.
 *   - Fails safe when the oracle is stale: refuses to escalate OR
 *     de-escalate until a fresh feed is available.
 */
contract DepegGuard is AccessControl {
    // ==================== Constants / roles ====================

    /// @dev Break-glass + tuning. Same admin that manages `Stablecoin`/`Minter`.
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    /// @dev Default peg target assumes an 8-decimal Chainlink USD feed.
    uint256 public constant DEFAULT_PEG_TARGET = 1e8;

    /// @dev Basis points denominator.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ==================== State enum ====================

    enum State {
        Normal,
        Caution,
        Hard
    }

    // ==================== Wiring ====================

    AggregatorV3Interface public priceFeed;
    Stablecoin public immutable stablecoin;
    Minter public immutable minter;

    // ==================== Tuning knobs ====================

    /// @dev Peg target in feed-native scale (default 1e8 = $1 on USDC/USD).
    uint256 public pegTarget;

    /// @dev Deviation (in bps) that pushes Normal -> Caution.
    uint256 public cautionBps;
    /// @dev Deviation (in bps) that pushes Caution -> Hard.
    uint256 public hardBps;
    /// @dev Tighter band the price must hold inside to de-escalate.
    uint256 public recoveryCeilingBps;

    /// @dev Minimum time a threshold must hold before the guard escalates.
    uint256 public minObservationSeconds;
    /// @dev Minimum time inside the recovery band before de-escalating.
    uint256 public minRecoverySeconds;
    /// @dev Hard state won't auto-clear until this much time has elapsed.
    uint256 public hardRedeemHaltSeconds;

    /// @dev Feeds older than this are treated as unusable.
    uint256 public maxFeedStaleSeconds;

    // ==================== Live state ====================

    State public currentState;
    /// @dev Timestamp at which we first observed the current deviation band.
    uint256 public pendingObservationSince;
    /// @dev Candidate state we're considering moving to.
    State public pendingState;
    /// @dev Timestamp at which we entered `currentState`.
    uint256 public stateEnteredAt;
    /// @dev Timestamp at which we first observed a recovery signal.
    uint256 public recoveryObservedSince;

    // ==================== Events ====================

    event DepegStateChanged(State indexed previous, State indexed current, uint256 price, uint256 updatedAt);
    event ThresholdsUpdated(uint256 cautionBps, uint256 hardBps, uint256 recoveryCeilingBps);
    event DurationsUpdated(uint256 minObservationSeconds, uint256 minRecoverySeconds, uint256 hardRedeemHaltSeconds);
    event StalenessUpdated(uint256 maxFeedStaleSeconds);
    event PegTargetUpdated(uint256 pegTarget);
    event PriceFeedUpdated(address indexed feed);
    event MintPauseTripped();
    event MintPauseCleared();
    event StablecoinPauseTripped();
    event StablecoinPauseCleared();
    event EmergencyEscalated(State state);
    event StateReset(State state);

    // ==================== Errors ====================

    error FeedStale(uint256 updatedAt);
    error InvalidFeedAnswer();
    error InvalidThresholds();
    error InvalidDurations();
    error ZeroAddress();

    // ==================== Constructor ====================

    constructor(
        address _stablecoin,
        address _minter,
        address _priceFeed,
        address admin
    ) {
        if (_stablecoin == address(0) || _minter == address(0) || _priceFeed == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }

        stablecoin = Stablecoin(_stablecoin);
        minter = Minter(_minter);
        priceFeed = AggregatorV3Interface(_priceFeed);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);

        // Sensible defaults per docs/depeg-guard.md §3.
        pegTarget = DEFAULT_PEG_TARGET;
        cautionBps = 50;
        hardBps = 200;
        recoveryCeilingBps = 25;
        minObservationSeconds = 600;      // 10 min
        minRecoverySeconds = 1800;        // 30 min
        hardRedeemHaltSeconds = 12 hours;
        maxFeedStaleSeconds = 1 hours;

        currentState = State.Normal;
        stateEnteredAt = block.timestamp;
    }

    // ==================== Views ====================

    /**
     * @notice Returns the current deviation from the peg target, in basis points.
     * @dev Reverts `FeedStale` if the oracle is older than `maxFeedStaleSeconds`.
     */
    function currentDeviationBps() public view returns (uint256 deviationBps, uint256 price, uint256 updatedAt) {
        (, int256 answer, , uint256 feedUpdatedAt, ) = priceFeed.latestRoundData();
        if (answer <= 0) revert InvalidFeedAnswer();
        if (feedUpdatedAt + maxFeedStaleSeconds < block.timestamp) revert FeedStale(feedUpdatedAt);

        price = uint256(answer);
        updatedAt = feedUpdatedAt;

        uint256 target = pegTarget;
        uint256 diff = price > target ? price - target : target - price;
        deviationBps = (diff * BPS_DENOMINATOR) / target;
    }

    /**
     * @notice Whether redemptions via `Minter` should be honored right now.
     * @dev Off-chain integrations (UI, a wrapper contract) should gate on this.
     */
    function redeemAllowed() external view returns (bool) {
        if (currentState != State.Hard) return true;
        return block.timestamp >= stateEnteredAt + hardRedeemHaltSeconds;
    }

    /**
     * @notice Whether mints via `Minter` should be honored right now.
     */
    function mintAllowed() external view returns (bool) {
        return currentState == State.Normal;
    }

    /**
     * @notice Returns true if the feed is recent enough to be used.
     */
    function feedFresh() external view returns (bool) {
        (, , , uint256 updatedAt, ) = priceFeed.latestRoundData();
        return updatedAt + maxFeedStaleSeconds >= block.timestamp;
    }

    // ==================== Core state machine ====================

    /**
     * @notice Public entrypoint. Reads the feed and advances the state machine
     *         if an observation window has been satisfied. Anyone may call.
     * @dev This function is idempotent within a block and never moves the
     *      state backward on a governance escalation — see §2 of the spec.
     */
    function poke() external {
        (uint256 devBps, uint256 price, uint256 updatedAt) = currentDeviationBps();

        State target = _observationTarget(devBps);

        if (target == currentState) {
            // Clear any pending escalation/deescalation — conditions no longer apply.
            pendingState = currentState;
            pendingObservationSince = 0;
            recoveryObservedSince = 0;
            return;
        }

        // The state we're observing changed — reset the observation window.
        if (target != pendingState || pendingObservationSince == 0) {
            pendingState = target;
            pendingObservationSince = block.timestamp;
            if (_isRecovery(target)) {
                recoveryObservedSince = block.timestamp;
            }
            return;
        }

        // We have a stable observation — decide if the window is long enough.
        uint256 elapsed = block.timestamp - pendingObservationSince;
        bool escalating = uint8(target) > uint8(currentState);
        uint256 requiredWindow = escalating ? minObservationSeconds : minRecoverySeconds;

        if (elapsed < requiredWindow) return;

        // De-escalating out of Hard: also enforce the hard-halt timer.
        if (!escalating && currentState == State.Hard) {
            if (block.timestamp < stateEnteredAt + hardRedeemHaltSeconds) return;
        }

        _transition(target, price, updatedAt);
    }

    // ==================== Guardian-only ====================

    /**
     * @notice Governance break-glass: force the guard into a state regardless
     *         of what the feed says. Useful for off-chain signals (Curve
     *         imbalance, custodian flagged, correlated drawdown).
     */
    function emergencyEscalate(State newState) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newState == currentState) return;
        emit EmergencyEscalated(newState);
        _transition(newState, 0, block.timestamp);
    }

    /**
     * @notice Governance break-glass: reset to a state (usually Normal) and
     *         unwind mitigations. No observation window enforced.
     */
    function resetState(State newState) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit StateReset(newState);
        _transition(newState, 0, block.timestamp);
    }

    // ==================== Mitigation primitives (internal) ====================

    function _transition(State newState, uint256 price, uint256 updatedAt) internal {
        State prev = currentState;
        if (newState == prev) return;

        // Unwind old-state mitigations (only those not needed in the new state).
        if (prev == State.Hard && newState != State.Hard) {
            // Leaving Hard: try to unpause the stablecoin.
            _tryUnpauseStablecoin();
        }

        // Apply new-state mitigations.
        if (newState == State.Caution && prev == State.Normal) {
            _tryRevokeMinter();
        }
        if (newState == State.Hard) {
            _tryRevokeMinter();
            _tryPauseStablecoin();
        }
        if (newState == State.Normal && prev == State.Caution) {
            _tryAuthorizeMinter();
        }
        if (newState == State.Normal && prev == State.Hard) {
            // Already cleared pause above. Re-authorize minter.
            _tryAuthorizeMinter();
        }
        if (newState == State.Caution && prev == State.Hard) {
            // Keep minter revoked; Caution already requires mints paused.
        }

        currentState = newState;
        stateEnteredAt = block.timestamp;
        pendingState = newState;
        pendingObservationSince = 0;
        recoveryObservedSince = 0;

        emit DepegStateChanged(prev, newState, price, updatedAt);
    }

    function _tryRevokeMinter() internal {
        // Best-effort: this call only succeeds if the guard owns the Minter
        // (or the Minter's ownership has been handed to a Governance contract
        // that forwards this call).
        try minter.revokeMinter(address(this)) {
            emit MintPauseTripped();
        } catch {
            // Fallback: the guard may only have role-less signaling power.
            // Operators still see the DepegStateChanged event; a keeper or
            // on-call rotates the actual revocation through governance.
            emit MintPauseTripped();
        }
    }

    function _tryAuthorizeMinter() internal {
        try minter.authorizeMinter(address(this)) {
            emit MintPauseCleared();
        } catch {
            emit MintPauseCleared();
        }
    }

    function _tryPauseStablecoin() internal {
        try stablecoin.pause() {
            emit StablecoinPauseTripped();
        } catch {
            emit StablecoinPauseTripped();
        }
    }

    function _tryUnpauseStablecoin() internal {
        try stablecoin.unpause() {
            emit StablecoinPauseCleared();
        } catch {
            emit StablecoinPauseCleared();
        }
    }

    // ==================== Tuning ====================

    function setPriceFeed(address _feed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_feed == address(0)) revert ZeroAddress();
        priceFeed = AggregatorV3Interface(_feed);
        emit PriceFeedUpdated(_feed);
    }

    function setThresholds(uint256 _cautionBps, uint256 _hardBps, uint256 _recoveryCeilingBps)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (_cautionBps == 0 || _hardBps <= _cautionBps || _recoveryCeilingBps > _cautionBps) {
            revert InvalidThresholds();
        }
        cautionBps = _cautionBps;
        hardBps = _hardBps;
        recoveryCeilingBps = _recoveryCeilingBps;
        emit ThresholdsUpdated(_cautionBps, _hardBps, _recoveryCeilingBps);
    }

    function setDurations(uint256 _minObs, uint256 _minRec, uint256 _hardHalt)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (_minObs == 0 || _minRec == 0) revert InvalidDurations();
        minObservationSeconds = _minObs;
        minRecoverySeconds = _minRec;
        hardRedeemHaltSeconds = _hardHalt;
        emit DurationsUpdated(_minObs, _minRec, _hardHalt);
    }

    function setStaleness(uint256 _maxFeedStaleSeconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_maxFeedStaleSeconds == 0) revert InvalidDurations();
        maxFeedStaleSeconds = _maxFeedStaleSeconds;
        emit StalenessUpdated(_maxFeedStaleSeconds);
    }

    function setPegTarget(uint256 _pegTarget) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_pegTarget == 0) revert InvalidThresholds();
        pegTarget = _pegTarget;
        emit PegTargetUpdated(_pegTarget);
    }

    // ==================== Internal helpers ====================

    /// @dev Pure mapping from a measured deviation to the target state.
    function _observationTarget(uint256 devBps) internal view returns (State) {
        if (devBps >= hardBps) return State.Hard;
        if (devBps >= cautionBps) {
            // Can't auto-move from Hard -> Caution unless we've observed
            // recovery into the recovery band.
            if (currentState == State.Hard) return State.Hard;
            return State.Caution;
        }
        if (devBps <= recoveryCeilingBps) return State.Normal;
        // In the hysteresis band between recoveryCeilingBps and cautionBps —
        // hold the current state.
        return currentState;
    }

    function _isRecovery(State target) internal view returns (bool) {
        return uint8(target) < uint8(currentState);
    }
}
```

## Contract: IAggregatorV3.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface AggregatorV3Interface {
  function decimals() external view returns (uint8);
  function description() external view returns (string memory);
  function version() external view returns (uint256);
  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
  function getRoundData(uint80 _roundId)
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
}
```

## Contract: Minter.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./Stablecoin.sol";
import "./ReserveManager.sol";
import "./ComplianceModule.sol";
import "./BurnToll.sol";

/**
 * @title Minter
 * @notice Minting/redemption gateway with compliance and reserve checks.
 * @dev Part of kcolbchain/stablecoin-toolkit
 */
contract Minter is Ownable {
    Stablecoin public stablecoin;
    ReserveManager public reserveManager;
    ComplianceModule public compliance;

    uint256 public mintFeeBps;    // e.g. 10 = 0.1%
    uint256 public redeemFeeBps;
    address public feeCollector;
    BurnToll public burnToll;

    mapping(address => bool) public authorizedMinters;

    struct Redemption {
        address redeemer;
        uint256 amount;
        uint256 fee;
        uint256 timestamp;
        bool settled;
    }

    Redemption[] public redemptions;

    event Minted(address indexed to, uint256 amount, uint256 fee);
    event RedemptionQueued(uint256 indexed id, address indexed redeemer, uint256 amount);
    event RedemptionSettled(uint256 indexed id);
    event MinterAuthorized(address indexed minter);
    event MinterRevoked(address indexed minter);
    event BurnTollSet(address indexed burnToll);

    error NotAuthorizedMinter();
    error ReserveCheckFailed();
    error AlreadySettled();
    error AmountTooSmallForFeesAndToll();

    modifier onlyAuthorizedMinter() {
        if (!authorizedMinters[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedMinter();
        }
        _;
    }

    constructor(
        address _stablecoin,
        address _reserveManager,
        address _compliance,
        uint256 _mintFeeBps,
        uint256 _redeemFeeBps,
        address _feeCollector
    ) Ownable(msg.sender) {
        stablecoin = Stablecoin(_stablecoin);
        reserveManager = ReserveManager(_reserveManager);
        compliance = ComplianceModule(_compliance);
        mintFeeBps = _mintFeeBps;
        redeemFeeBps = _redeemFeeBps;
        feeCollector = _feeCollector;
    }

    function authorizeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = true;
        emit MinterAuthorized(minter);
    }

    function revokeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = false;
        emit MinterRevoked(minter);
    }

    function mint(address to, uint256 amount) external onlyAuthorizedMinter {
        // Check compliance
        compliance.checkCompliance(to, amount);

        // Check reserves can support new supply
        uint256 newSupply = stablecoin.totalSupply() + amount;
        reserveManager.updateTrackedSupply(newSupply);
        reserveManager.checkReserveRatio();

        // Calculate fee
        uint256 fee = (amount * mintFeeBps) / 10000;
        uint256 toll = _previewMintToll(amount);
        if (fee + toll > amount) revert AmountTooSmallForFeesAndToll();
        uint256 netAmount = amount - fee - toll;

        // Mint
        stablecoin.mint(to, netAmount);
        if (fee > 0) {
            stablecoin.mint(feeCollector, fee);
        }
        if (toll > 0) {
            stablecoin.mint(address(burnToll), toll);
            burnToll.handleMintToll(address(stablecoin), toll);
        }

        // Record daily spend for compliance
        compliance.recordSpend(to, amount);

        emit Minted(to, netAmount, fee);
    }

    function redeem(uint256 amount) external {
        // Check compliance
        compliance.checkCompliance(msg.sender, amount);

        uint256 fee = (amount * redeemFeeBps) / 10000;
        uint256 toll = _previewRedeemToll(amount);
        if (fee + toll > amount) revert AmountTooSmallForFeesAndToll();
        uint256 burnAmount = amount - toll;
        uint256 redeemAmount = amount - fee - toll;

        // Burn tokens and route toll revenue
        if (toll > 0) {
            stablecoin.transferFrom(msg.sender, address(burnToll), toll);
            burnToll.handleRedeemToll(address(stablecoin), toll);
        }
        stablecoin.burnFrom(msg.sender, burnAmount);

        // Update tracked supply
        reserveManager.updateTrackedSupply(stablecoin.totalSupply());

        // Queue redemption for settlement
        redemptions.push(Redemption({
            redeemer: msg.sender,
            amount: redeemAmount,
            fee: fee,
            timestamp: block.timestamp,
            settled: false
        }));

        emit RedemptionQueued(redemptions.length - 1, msg.sender, redeemAmount);
    }

    function settleRedemption(uint256 id) external onlyOwner {
        if (redemptions[id].settled) revert AlreadySettled();
        redemptions[id].settled = true;
        emit RedemptionSettled(id);
    }

    function setFees(uint256 _mintFeeBps, uint256 _redeemFeeBps) external onlyOwner {
        mintFeeBps = _mintFeeBps;
        redeemFeeBps = _redeemFeeBps;
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        feeCollector = _feeCollector;
    }

    /**
     * @notice Sets or disables the optional burn-toll extension.
     * @param _burnToll BurnToll contract address, or zero address to disable toll collection.
     */
    function setBurnToll(address _burnToll) external onlyOwner {
        burnToll = BurnToll(_burnToll);
        emit BurnTollSet(_burnToll);
    }

    function getRedemptionCount() external view returns (uint256) {
        return redemptions.length;
    }

    function _previewMintToll(uint256 amount) internal view returns (uint256) {
        if (address(burnToll) == address(0)) return 0;
        return burnToll.previewMintToll(address(stablecoin), amount);
    }

    function _previewRedeemToll(uint256 amount) internal view returns (uint256) {
        if (address(burnToll) == address(0)) return 0;
        return burnToll.previewRedeemToll(address(stablecoin), amount);
    }
}
```

## Contract: ReserveManager.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./ChainlinkPoRAdapter.sol";

/**
 * @title ReserveManager
 * @notice Multi-asset reserve tracking with proof of reserves and ratio enforcement.
 * @dev Part of kcolbchain/stablecoin-toolkit. Supports both manual attestation
 *      and Chainlink Proof of Reserves feeds via ChainlinkPoRAdapter.
 */
contract ReserveManager is Ownable {
    struct ReserveAsset {
        string name;
        uint256 amount;       // in stablecoin-equivalent units (6 decimals)
        uint256 lastUpdated;
        bool active;
    }

    mapping(bytes32 => ReserveAsset) public reserves;
    bytes32[] public reserveIds;

    uint256 public totalReserves;
    uint256 public totalSupplyTracked; // updated by Minter
    uint256 public minimumRatioBps;    // e.g. 10000 = 100%, 10500 = 105%

    /// @dev Chainlink PoR adapter for on-chain reserve verification
    ChainlinkPoRAdapter public porAdapter;
    /// @dev Canonical reserve asset ID for the Chainlink-backed reserve
    bytes32 public constant POR_RESERVE_ID = bytes32(0);

    event ReserveUpdated(bytes32 indexed assetId, string name, uint256 amount);
    event SupplyUpdated(uint256 newSupply);
    event MinimumRatioUpdated(uint256 newRatioBps);
    event PorAdapterSet(address indexed adapter);
    event PorReservePulled(uint256 amount, uint256 updatedAt);

    error ReserveRatioTooLow(uint256 currentRatioBps, uint256 requiredRatioBps);
    error PorAdapterNotSet();
    error PorFeedFailed(string reason);

    constructor(uint256 _minimumRatioBps) Ownable(msg.sender) {
        minimumRatioBps = _minimumRatioBps;
    }

    function addReserveAsset(bytes32 assetId, string calldata name, uint256 amount) external onlyOwner {
        if (!reserves[assetId].active) {
            reserveIds.push(assetId);
        }
        reserves[assetId] = ReserveAsset({
            name: name,
            amount: amount,
            lastUpdated: block.timestamp,
            active: true
        });
        _recalcTotal();
        emit ReserveUpdated(assetId, name, amount);
    }

    function updateReserve(bytes32 assetId, uint256 amount) external onlyOwner {
        require(reserves[assetId].active, "Asset not active");
        reserves[assetId].amount = amount;
        reserves[assetId].lastUpdated = block.timestamp;
        _recalcTotal();
        emit ReserveUpdated(assetId, reserves[assetId].name, amount);
    }

    function updateTrackedSupply(uint256 supply) external onlyOwner {
        totalSupplyTracked = supply;
        emit SupplyUpdated(supply);
    }

    function setMinimumRatio(uint256 ratioBps) external onlyOwner {
        minimumRatioBps = ratioBps;
        emit MinimumRatioUpdated(ratioBps);
    }

    /**
     * @notice Sets the Chainlink PoR adapter address.
     * @param adapter Address of the ChainlinkPoRAdapter contract.
     */
    function setPorAdapter(address adapter) external onlyOwner {
        if (adapter == address(0)) revert PorAdapterNotSet();
        porAdapter = ChainlinkPoRAdapter(adapter);
        emit PorAdapterSet(adapter);
    }

    /**
     * @notice Pulls reserve data from the configured Chainlink PoR feed and
     *         updates the canonical PoR reserve asset.
     * @dev The adapter returns values in feed decimals (8); this contract
     *      converts to stablecoin units (6) before storing.
     */
    function pullPorReserve() public onlyOwner returns (uint256 reserveAmount, uint256 updatedAt) {
        if (address(porAdapter) == address(0)) revert PorAdapterNotSet();

        (uint256 rawAmount, uint256 timestamp) = porAdapter.getLatestReserveAmount();

        // Convert from feed decimals (8) to stablecoin units (6)
        reserveAmount = rawAmount / 100;

        // Upsert the PoR reserve asset
        reserves[POR_RESERVE_ID] = ReserveAsset({
            name: "Chainlink PoR Reserve",
            amount: reserveAmount,
            lastUpdated: timestamp,
            active: true
        });

        // Add to reserveIds if new
        bool found = false;
        for (uint256 i = 0; i < reserveIds.length; i++) {
            if (reserveIds[i] == POR_RESERVE_ID) {
                found = true;
                break;
            }
        }
        if (!found) {
            reserveIds.push(POR_RESERVE_ID);
        }

        _recalcTotal();
        emit PorReservePulled(reserveAmount, timestamp);
        return (reserveAmount, timestamp);
    }

    function getReserveRatioBps() public view returns (uint256) {
        if (totalSupplyTracked == 0) return type(uint256).max;
        return (totalReserves * 10000) / totalSupplyTracked;
    }

    function checkReserveRatio() public view {
        uint256 ratio = getReserveRatioBps();
        if (ratio < minimumRatioBps) {
            revert ReserveRatioTooLow(ratio, minimumRatioBps);
        }
    }

    /**
     * @notice Convenience: pull from PoR and check reserve ratio in one call.
     */
    function pullPorReserveAndCheck() external onlyOwner {
        if (address(porAdapter) == address(0)) revert PorAdapterNotSet();
        pullPorReserve();
        checkReserveRatio();
    }

    function getReserveCount() external view returns (uint256) {
        return reserveIds.length;
    }

    function _recalcTotal() internal {
        uint256 total = 0;
        for (uint256 i = 0; i < reserveIds.length; i++) {
            if (reserves[reserveIds[i]].active) {
                total += reserves[reserveIds[i]].amount;
            }
        }
        totalReserves = total;
    }
}
```

## Contract: Stablecoin.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title Stablecoin
 * @notice Core stablecoin ERC-20 with mint/burn, pause, blacklist, and EIP-2612 permit.
 * @dev Part of kcolbchain/stablecoin-toolkit
 */
contract Stablecoin is ERC20, ERC20Burnable, ERC20Pausable, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");

    mapping(address => bool) private _blacklisted;

    event Blacklisted(address indexed account);
    event Unblacklisted(address indexed account);

    error AccountBlacklisted(address account);

    constructor(
        string memory name_,
        string memory symbol_,
        address admin
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(BLACKLISTER_ROLE, admin);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (_blacklisted[to]) revert AccountBlacklisted(to);
        _mint(to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function blacklist(address account) external onlyRole(BLACKLISTER_ROLE) {
        _blacklisted[account] = true;
        emit Blacklisted(account);
    }

    function unblacklist(address account) external onlyRole(BLACKLISTER_ROLE) {
        _blacklisted[account] = false;
        emit Unblacklisted(account);
    }

    function isBlacklisted(address account) external view returns (bool) {
        return _blacklisted[account];
    }

    function decimals() public pure override returns (uint8) {
        return 6; // USDC-style 6 decimals
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Pausable) {
        if (_blacklisted[from]) revert AccountBlacklisted(from);
        if (_blacklisted[to]) revert AccountBlacklisted(to);
        super._update(from, to, value);
    }
}
```

## Tests: DepegGuard.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Hardhat mirror of `forge-test/DepegGuard.t.sol`. Kept in sync so local
 * contributors can validate without foundry installed.
 */

const PEG = 10n ** 8n; // $1 at 8 decimals

async function deployStack() {
  const [admin, feeCollector, user, randomCaller] = await ethers.getSigners();

  const Stablecoin = await ethers.getContractFactory("Stablecoin");
  const coin = await Stablecoin.deploy("Test Stable", "TSTB", admin.address);
  await coin.waitForDeployment();

  const ReserveManager = await ethers.getContractFactory("ReserveManager");
  const rm = await ReserveManager.deploy(10_000n);
  await rm.waitForDeployment();

  const ComplianceModule = await ethers.getContractFactory("ComplianceModule");
  const cm = await ComplianceModule.deploy();
  await cm.waitForDeployment();

  const Minter = await ethers.getContractFactory("Minter");
  const minter = await Minter.deploy(
    await coin.getAddress(),
    await rm.getAddress(),
    await cm.getAddress(),
    0n,
    0n,
    feeCollector.address,
  );
  await minter.waitForDeployment();

  const Mock = await ethers.getContractFactory("ChainlinkPoRMock");
  const feed = await Mock.deploy(PEG);
  await feed.waitForDeployment();

  const DepegGuard = await ethers.getContractFactory("DepegGuard");
  const guard = await DepegGuard.deploy(
    await coin.getAddress(),
    await minter.getAddress(),
    await feed.getAddress(),
    admin.address,
  );
  await guard.waitForDeployment();

  await coin.grantRole(await coin.PAUSER_ROLE(), await guard.getAddress());
  await minter.transferOwnership(await guard.getAddress());

  return { admin, feeCollector, user, randomCaller, coin, rm, cm, minter, feed, guard };
}

async function setPrice(feed, answer) {
  const block = await ethers.provider.getBlock("latest");
  await feed.setAnswerWithTimestamp(answer, block.timestamp);
}

async function advance(seconds) {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

const State = { Normal: 0, Caution: 1, Hard: 2 };

describe("DepegGuard", function () {
  let ctx;

  beforeEach(async function () {
    ctx = await deployStack();
  });

  it("starts in Normal and allows mint+redeem", async function () {
    expect(await ctx.guard.currentState()).to.equal(State.Normal);
    expect(await ctx.guard.mintAllowed()).to.equal(true);
    expect(await ctx.guard.redeemAllowed()).to.equal(true);
  });

  it("does not escalate on a single poke at the caution threshold", async function () {
    await setPrice(ctx.feed, PEG - PEG / 200n); // -50 bps
    await ctx.guard.poke();
    expect(await ctx.guard.currentState()).to.equal(State.Normal);
  });

  it("escalates Normal -> Caution after minObservationSeconds", async function () {
    await setPrice(ctx.feed, PEG - PEG / 200n);
    await ctx.guard.poke();
    const minObs = await ctx.guard.minObservationSeconds();
    // keep the feed fresh across the warp
    await advance(minObs + 1n);
    await setPrice(ctx.feed, PEG - PEG / 200n);
    await ctx.guard.poke();
    expect(await ctx.guard.currentState()).to.equal(State.Caution);
    expect(await ctx.guard.mintAllowed()).to.equal(false);
    expect(await ctx.guard.redeemAllowed()).to.equal(true);
  });

  it("escalates all the way to Hard on a 250 bps drop", async function () {
    await setPrice(ctx.feed, PEG - PEG / 40n); // -250 bps
    await ctx.guard.poke();
    await advance((await ctx.guard.minObservationSeconds()) + 1n);
    await setPrice(ctx.feed, PEG - PEG / 40n);
    await ctx.guard.poke();
    expect(await ctx.guard.currentState()).to.equal(State.Hard);
    expect(await ctx.guard.redeemAllowed()).to.equal(false);
    expect(await ctx.coin.paused()).to.equal(true);
  });

  it("anti-flap: brief deviation that reverts inside observation window stays Normal", async function () {
    await setPrice(ctx.feed, PEG - PEG / 100n);
    await ctx.guard.poke();
    await advance((await ctx.guard.minObservationSeconds()) / 2n);
    await setPrice(ctx.feed, PEG);
    await ctx.guard.poke();
    expect(await ctx.guard.currentState()).to.equal(State.Normal);
  });

  it("recovers Caution -> Normal after minRecoverySeconds of stable peg", async function () {
    await setPrice(ctx.feed, PEG - PEG / 100n);
    await ctx.guard.poke();
    await advance((await ctx.guard.minObservationSeconds()) + 1n);
    await setPrice(ctx.feed, PEG - PEG / 100n);
    await ctx.guard.poke();
    expect(await ctx.guard.currentState()).to.equal(State.Caution);

    await setPrice(ctx.feed, PEG);
    await ctx.guard.poke();
    await advance((await ctx.guard.minRecoverySeconds()) + 1n);
    await setPrice(ctx.feed, PEG);
    await ctx.guard.poke();
    expect(await ctx.guard.currentState()).to.equal(State.Normal);
    expect(await ctx.guard.mintAllowed()).to.equal(true);
  });

  it("recovery from Hard respects the hardRedeemHaltSeconds timer", async function () {
    await setPrice(ctx.feed, PEG - PEG / 40n);
    await ctx.guard.poke();
    await advance((await ctx.guard.minObservationSeconds()) + 1n);
    await setPrice(ctx.feed, PEG - PEG / 40n);
    await ctx.guard.poke();
    expect(await ctx.guard.currentState()).to.equal(State.Hard);

    const enteredAt = await ctx.guard.stateEnteredAt();

    // Price recovers.
    await setPrice(ctx.feed, PEG);
    await ctx.guard.poke();

    // Recovery elapsed but hardHalt hasn't.
    await advance((await ctx.guard.minRecoverySeconds()) + 1n);
    await setPrice(ctx.feed, PEG);
    await ctx.guard.poke();
    expect(await ctx.guard.currentState()).to.equal(State.Hard);

    // Past hardRedeemHaltSeconds.
    const hardHalt = await ctx.guard.hardRedeemHaltSeconds();
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const target = enteredAt + hardHalt + 5n;
    if (now < target) {
      await advance(target - now);
    }
    await setPrice(ctx.feed, PEG);
    await ctx.guard.poke();
    expect(await ctx.guard.currentState()).to.equal(State.Normal);
    expect(await ctx.coin.paused()).to.equal(false);
  });

  it("reverts with FeedStale when the feed is older than maxFeedStaleSeconds", async function () {
    await setPrice(ctx.feed, PEG);
    await advance((await ctx.guard.maxFeedStaleSeconds()) + 1n);
    await expect(ctx.guard.currentDeviationBps()).to.be.reverted;
    await expect(ctx.guard.poke()).to.be.reverted;
  });

  it("gates setThresholds / resetState / emergencyEscalate on the admin role", async function () {
    const { guard, randomCaller, admin, coin } = ctx;

    await expect(guard.connect(randomCaller).setThresholds(100n, 200n, 25n)).to.be.reverted;
    await expect(guard.connect(randomCaller).emergencyEscalate(State.Hard)).to.be.reverted;
    await expect(guard.connect(randomCaller).resetState(State.Normal)).to.be.reverted;

    await guard.connect(admin).emergencyEscalate(State.Hard);
    expect(await guard.currentState()).to.equal(State.Hard);
    expect(await coin.paused()).to.equal(true);

    await guard.connect(admin).resetState(State.Normal);
    expect(await guard.currentState()).to.equal(State.Normal);
    expect(await coin.paused()).to.equal(false);
  });

  it("setThresholds rejects invalid combinations", async function () {
    const { guard, admin } = ctx;
    await expect(guard.connect(admin).setThresholds(0n, 200n, 25n)).to.be.revertedWithCustomError(
      guard,
      "InvalidThresholds",
    );
    await expect(guard.connect(admin).setThresholds(100n, 50n, 25n)).to.be.revertedWithCustomError(
      guard,
      "InvalidThresholds",
    );
    await expect(guard.connect(admin).setThresholds(100n, 200n, 150n)).to.be.revertedWithCustomError(
      guard,
      "InvalidThresholds",
    );
  });

  it("computes absolute deviation (upward depeg also counts)", async function () {
    await setPrice(ctx.feed, PEG + PEG / 100n); // +100 bps
    const [devUp] = await ctx.guard.currentDeviationBps();
    expect(devUp).to.equal(100n);

    await setPrice(ctx.feed, PEG - PEG / 50n); // -200 bps
    const [devDown] = await ctx.guard.currentDeviationBps();
    expect(devDown).to.equal(200n);
  });

  it("upward depeg > hardBps also triggers Hard state", async function () {
    await setPrice(ctx.feed, PEG + PEG / 40n); // +250 bps
    await ctx.guard.poke();
    await advance((await ctx.guard.minObservationSeconds()) + 1n);
    await setPrice(ctx.feed, PEG + PEG / 40n);
    await ctx.guard.poke();
    expect(await ctx.guard.currentState()).to.equal(State.Hard);
  });

  it("setPriceFeed rejects zero address and swaps feeds", async function () {
    const { guard, admin } = ctx;
    await expect(guard.connect(admin).setPriceFeed(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      guard,
      "ZeroAddress",
    );

    const Mock = await ethers.getContractFactory("ChainlinkPoRMock");
    const newFeed = await Mock.deploy(PEG);
    await newFeed.waitForDeployment();
    await guard.connect(admin).setPriceFeed(await newFeed.getAddress());
    expect(await guard.priceFeed()).to.equal(await newFeed.getAddress());
  });
});
```
