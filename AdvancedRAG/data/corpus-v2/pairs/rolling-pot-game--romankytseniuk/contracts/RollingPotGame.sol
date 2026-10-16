// Implements a single Rolling Pot game instance with autonomous round progression and payouts.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IRollingPotRandomnessConsumer } from "./IRollingPotRandomnessConsumer.sol";
import { IRollingPotRandomnessProvider } from "./IRollingPotRandomnessProvider.sol";

/**
 * @title RollingPotGame
 * @notice A standalone game (“pot”) that runs time-based rounds and either resolves or rolls forward.
 */
contract RollingPotGame is ReentrancyGuard, IRollingPotRandomnessConsumer {
    /**
     * @notice Represents the lifecycle state of the current round / game.
     */
    enum GameState {
        Open,
        Closed,
        RandomnessPending,
        Resolved
    }

    /// @notice Emitted when a new round opens.
    event RoundOpened(
        address indexed game,
        uint256 indexed roundIndex,
        uint256 startTime,
        uint256 endTime,
        uint256 entryPriceWei
    );

    /// @notice Emitted when a player joins a round.
    event Joined(address indexed game, uint256 indexed roundIndex, address indexed player, uint256 amountWei);

    /// @notice Emitted when a round is closed.
    event RoundClosed(address indexed game, uint256 indexed roundIndex, uint256 participantCount, uint256 potAmountWei);

    /// @notice Emitted when randomness is requested for a round.
    event RandomnessRequested(address indexed game, uint256 indexed roundIndex, uint256 indexed requestId);

    /// @notice Emitted when randomness is retried and a new request replaces the active one.
    event RandomnessRetried(
        address indexed game,
        uint256 indexed roundIndex,
        uint256 indexed oldRequestId,
        uint256 newRequestId
    );

    /// @notice Emitted when a randomness callback is ignored (stale or out-of-state).
    event RandomnessIgnored(address indexed game, uint256 indexed roundIndex, uint256 indexed requestId);

    /// @notice Emitted when a round rolls forward to the next round.
    event RoundRolled(
        address indexed game,
        uint256 indexed roundIndex,
        uint256 indexed nextRoundIndex,
        uint256 carriedPotAmountWei
    );

    /// @notice Emitted when a round resolves and the game ends.
    event RoundResolved(
        address indexed game,
        uint256 indexed roundIndex,
        uint256 winnersCount,
        uint256 feeChargedWei,
        uint256 perWinnerBasePayoutWei
    );

    /// @notice Emitted when a user claims a payout.
    event Claimed(address indexed game, uint256 indexed roundIndex, address indexed player, uint256 amountWei);

    /// @notice True once the contract is initialized.
    bool public initialized;

    /// @notice Current round/game state.
    GameState public gameState;

    /// @notice Round duration in seconds.
    uint64 public roundDurationSeconds;

    /// @notice Upper bound for capPerRound: resolution credits every winner inside the VRF callback,
    /// so the round size must stay within Chainlink VRF v2.5's callback gas limit.
    uint32 public constant MAX_CAP_PER_ROUND = 80;

    /// @notice Maximum number of participants per round.
    uint32 public capPerRound;

    /// @notice Resolution probability in basis points (0..10_000), applied identically per eligible round.
    uint16 public resolveProbabilityBps;

    /// @notice Fee in basis points (0..10_000), applied only on resolution and only after `feeStartRound`.
    uint16 public feeBps;

    /// @notice The first round index where fees may apply.
    uint32 public feeStartRound;

    /// @notice Address that receives fees via the claimable mapping.
    address public feeRecipient;

    /// @notice Base entry price in wei for round 0.
    uint256 public baseEntryPriceWei;

    /// @notice Entry price increment in wei per round.
    uint256 public entryPriceIncrementWei;

    /// @notice Randomness request retry timeout.
    uint64 public randomnessTimeoutSeconds;

    /// @notice The randomness provider adapter used by this game.
    address public randomnessProvider;

    /// @notice Current round index.
    uint256 public currentRoundIndex;

    /// @notice Current round start timestamp.
    uint256 public roundStartTimestamp;

    /// @notice Current round end timestamp.
    uint256 public roundEndTimestamp;

    /// @notice Current round entry price in wei.
    uint256 public currentEntryPriceWei;

    /// @notice Participants of the current round in join order (bounded by cap).
    address[] private participants;

    /// @notice Tracks last joined round index + 1 (0 means never joined), enforcing one entry per address per round.
    mapping(address player => uint256 lastJoinedRoundPlusOne) public lastJoinedRoundIndexPlusOne;

    /// @notice Pull-payment balances for winners (and the fee recipient).
    mapping(address player => uint256 amountWei) public claimableWei;

    /// @notice The active randomness request id for the current round, if any.
    uint256 public activeRequestId;

    /// @notice Timestamp when the active randomness request was created.
    uint256 public randomnessRequestedAt;

    /**
     * @notice Initializes the game instance.
     * @param _roundDurationSeconds Fixed duration of each round in seconds.
     * @param _capPerRound Maximum number of participants per round.
     * @param _resolveProbabilityBps Probability (bps) that an eligible round resolves.
     * @param _feeBps Fee (bps) charged on resolution (subject to guardrails).
     * @param _feeStartRound First round index where a fee may apply.
     * @param _feeRecipient Address receiving fees via the claimable mapping.
     * @param _baseEntryPriceWei Entry price for round 0.
     * @param _entryPriceIncrementWei Entry price increment per round.
     * @param _randomnessTimeoutSeconds Seconds after which randomness can be retried.
     * @param _randomnessProvider Randomness provider adapter.
     */
    function initialize(
        uint64 _roundDurationSeconds,
        uint32 _capPerRound,
        uint16 _resolveProbabilityBps,
        uint16 _feeBps,
        uint32 _feeStartRound,
        address _feeRecipient,
        uint256 _baseEntryPriceWei,
        uint256 _entryPriceIncrementWei,
        uint64 _randomnessTimeoutSeconds,
        address _randomnessProvider
    ) external payable {
        require(!initialized, "RollingPotGame: already initialized");
        require(_roundDurationSeconds >= 30, "RollingPotGame: roundDuration too small");
        require(_capPerRound > 0 && _capPerRound <= MAX_CAP_PER_ROUND, "RollingPotGame: cap out of bounds");
        require(_resolveProbabilityBps > 0 && _resolveProbabilityBps <= 10_000, "RollingPotGame: bad probability");
        require(_feeBps <= 10_000, "RollingPotGame: bad fee");
        require(_feeRecipient != address(0), "RollingPotGame: feeRecipient is zero");
        require(_baseEntryPriceWei > 0, "RollingPotGame: baseEntryPrice is zero");
        require(_randomnessProvider != address(0), "RollingPotGame: provider is zero");

        initialized = true;

        roundDurationSeconds = _roundDurationSeconds;
        capPerRound = _capPerRound;
        resolveProbabilityBps = _resolveProbabilityBps;
        feeBps = _feeBps;
        feeStartRound = _feeStartRound;
        feeRecipient = _feeRecipient;
        baseEntryPriceWei = _baseEntryPriceWei;
        entryPriceIncrementWei = _entryPriceIncrementWei;
        randomnessTimeoutSeconds = _randomnessTimeoutSeconds;
        randomnessProvider = _randomnessProvider;

        currentRoundIndex = 0;
        roundStartTimestamp = block.timestamp;
        roundEndTimestamp = block.timestamp + _roundDurationSeconds;
        currentEntryPriceWei = _calculateEntryPriceWei(0);
        gameState = GameState.Open;

        emit RoundOpened(address(this), 0, roundStartTimestamp, roundEndTimestamp, currentEntryPriceWei);
    }

    /**
     * @notice Returns the current round participants in join order.
     * @return roundParticipants The participants array.
     */
    function getParticipants() external view returns (address[] memory roundParticipants) {
        return participants;
    }

    /**
     * @notice Allows a player to join the current round by paying the exact entry price.
     */
    function join() external payable {
        require(gameState == GameState.Open, "RollingPotGame: round not open");
        require(block.timestamp < roundEndTimestamp, "RollingPotGame: round ended");
        require(participants.length < capPerRound, "RollingPotGame: cap reached");
        require(msg.value == currentEntryPriceWei, "RollingPotGame: wrong entry price");

        uint256 expectedPlusOne = currentRoundIndex + 1;
        require(
            lastJoinedRoundIndexPlusOne[msg.sender] != expectedPlusOne,
            "RollingPotGame: already joined this round"
        );

        lastJoinedRoundIndexPlusOne[msg.sender] = expectedPlusOne;
        participants.push(msg.sender);

        emit Joined(address(this), currentRoundIndex, msg.sender, msg.value);
    }

    /**
     * @notice Closes the current round and either rolls forward (if no participants) or requests randomness.
     */
    function closeRound() external {
        require(gameState == GameState.Open, "RollingPotGame: not open");
        require(block.timestamp >= roundEndTimestamp, "RollingPotGame: too early");

        gameState = GameState.Closed;

        emit RoundClosed(address(this), currentRoundIndex, participants.length, address(this).balance);

        if (participants.length == 0) {
            _rollForward();
            return;
        }

        _requestRandomness();
    }

    /**
     * @notice Requests randomness again if a request is stuck beyond the configured timeout.
     */
    function retryRandomness() external {
        require(gameState == GameState.RandomnessPending, "RollingPotGame: not pending");
        require(randomnessRequestedAt > 0, "RollingPotGame: no request");
        require(
            block.timestamp >= randomnessRequestedAt + randomnessTimeoutSeconds,
            "RollingPotGame: timeout not reached"
        );

        uint256 oldRequestId = activeRequestId;
        uint256 newRequestId = _requestRandomness();

        emit RandomnessRetried(address(this), currentRoundIndex, oldRequestId, newRequestId);
    }

    /**
     * @notice Callback used by the configured provider to deliver randomness.
     * @param requestId The request identifier.
     * @param randomWord The random word.
     */
    function onRandomWord(uint256 requestId, uint256 randomWord) external override {
        require(msg.sender == randomnessProvider, "RollingPotGame: only provider");

        if (gameState != GameState.RandomnessPending) {
            emit RandomnessIgnored(address(this), currentRoundIndex, requestId);
            return;
        }

        if (requestId != activeRequestId) {
            emit RandomnessIgnored(address(this), currentRoundIndex, requestId);
            return;
        }

        bool shouldResolve = (randomWord % 10_000) < resolveProbabilityBps;

        if (shouldResolve) {
            _resolveAndEnd();
        } else {
            _rollForward();
        }
    }

    /**
     * @notice Claims any accumulated winnings or fees for the caller.
     */
    function claim() external nonReentrant {
        uint256 amount = claimableWei[msg.sender];
        require(amount > 0, "RollingPotGame: nothing to claim");

        claimableWei[msg.sender] = 0;

        (bool success, ) = msg.sender.call{ value: amount }("");
        require(success, "RollingPotGame: claim transfer failed");

        emit Claimed(address(this), currentRoundIndex, msg.sender, amount);
    }

    /**
     * @notice Calculates the entry price for a given round index.
     * @param roundIndex The round index.
     * @return entryPriceWei The entry price in wei.
     */
    function _calculateEntryPriceWei(uint256 roundIndex) internal view returns (uint256 entryPriceWei) {
        return baseEntryPriceWei + (entryPriceIncrementWei * roundIndex);
    }

    /**
     * @notice Requests randomness and updates request tracking state.
     */
    function _requestRandomness() internal returns (uint256 requestId) {
        gameState = GameState.RandomnessPending;
        randomnessRequestedAt = block.timestamp;

        requestId = IRollingPotRandomnessProvider(randomnessProvider).requestRandomWord(
            address(this),
            currentRoundIndex
        );

        require(requestId != 0, "RollingPotGame: provider returned requestId 0");

        activeRequestId = requestId;

        emit RandomnessRequested(address(this), currentRoundIndex, requestId);

        return requestId;
    }

    /**
     * @notice Rolls the entire pool into the next round and opens it.
     */
    function _rollForward() internal {
        uint256 previousRoundIndex = currentRoundIndex;
        uint256 carriedPotAmountWei = address(this).balance;

        currentRoundIndex = previousRoundIndex + 1;
        roundStartTimestamp = block.timestamp;
        roundEndTimestamp = block.timestamp + roundDurationSeconds;
        currentEntryPriceWei = _calculateEntryPriceWei(currentRoundIndex);

        delete participants;
        activeRequestId = 0;
        randomnessRequestedAt = 0;

        gameState = GameState.Open;

        emit RoundRolled(address(this), previousRoundIndex, currentRoundIndex, carriedPotAmountWei);
        emit RoundOpened(address(this), currentRoundIndex, roundStartTimestamp, roundEndTimestamp, currentEntryPriceWei);
    }

    /**
     * @notice Resolves the current round, records claimables, and ends the game.
     */
    function _resolveAndEnd() internal {
        uint256 winnersCount = participants.length;
        require(winnersCount > 0, "RollingPotGame: no winners");

        uint256 pool = address(this).balance;
        uint256 feeCharged = 0;
        uint256 netPool = pool;

        if (currentRoundIndex >= feeStartRound && feeBps > 0) {
            uint256 grossFee = (pool * feeBps) / 10_000;
            uint256 candidateNetPool = pool - grossFee;
            uint256 perWinnerFloor = candidateNetPool / winnersCount;

            if (perWinnerFloor >= currentEntryPriceWei) {
                feeCharged = grossFee;
                netPool = candidateNetPool;
            }
        }

        uint256 perWinnerBase = netPool / winnersCount;
        uint256 remainder = netPool % winnersCount;

        for (uint256 index = 0; index < winnersCount; index += 1) {
            address winner = participants[index];
            uint256 payout = perWinnerBase;
            if (index < remainder) {
                payout += 1;
            }
            claimableWei[winner] += payout;
        }

        if (feeCharged > 0) {
            claimableWei[feeRecipient] += feeCharged;
        }

        gameState = GameState.Resolved;

        emit RoundResolved(address(this), currentRoundIndex, winnersCount, feeCharged, perWinnerBase);
    }
}
