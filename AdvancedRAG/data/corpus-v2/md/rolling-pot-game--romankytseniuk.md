# rolling-pot-game--romankytseniuk

- domain: games-lotteries (lottery)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/RomanKytseniuk/rolling-pot @ 8f6a0ec201deb3a6b8a5b312bece6c7875549a9c
- license: MIT
- targets: RollingPotGame.sol, RollingPotFactory.sol, MockRandomnessProvider.sol, ZeroRequestIdRandomnessProvider.sol, SelfDestructSender.sol, ReentrantClaimer.sol, IRollingPotRandomnessConsumer.sol, IRollingPotRandomnessProvider.sol
- validation: 17 passing tests, 0 failing; statement coverage RollingPotGame.sol 95.89 %, RollingPotFactory.sol 100.0 %, MockRandomnessProvider.sol 100.0 %, ZeroRequestIdRandomnessProvider.sol 100.0 %, SelfDestructSender.sol 100.0 %, ReentrantClaimer.sol 100.0 %, IRollingPotRandomnessConsumer.sol 100.0 %, IRollingPotRandomnessProvider.sol 100.0 %

## Contract: IRollingPotRandomnessConsumer.sol (dependency)

```solidity
// Defines the callback interface used by randomness providers to deliver randomness.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

/**
 * @title IRollingPotRandomnessConsumer
 * @notice A Rolling Pot game implements this to receive random words.
 */
interface IRollingPotRandomnessConsumer {
    /**
     * @notice Delivers a random word to the consumer.
     * @param requestId The request identifier created by the provider.
     * @param randomWord The generated random word.
     */
    function onRandomWord(uint256 requestId, uint256 randomWord) external;
}
```

## Contract: IRollingPotRandomnessProvider.sol (dependency)

```solidity
// Defines the interface Rolling Pot games use to request verifiable randomness.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

/**
 * @title IRollingPotRandomnessProvider
 * @notice Defines a minimal interface for requesting a single random word.
 */
interface IRollingPotRandomnessProvider {
    /**
     * @notice Requests one random word for a specific game round.
     * @param game The RollingPotGame contract address.
     * @param roundIndex The round index being resolved.
     * @return requestId A provider-defined request identifier.
     */
    function requestRandomWord(address game, uint256 roundIndex) external returns (uint256 requestId);
}
```

## Contract: MockRandomnessProvider.sol (dependency)

```solidity
// Provides deterministic, test-controlled randomness for local development and simulations.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { IRollingPotRandomnessConsumer } from "./IRollingPotRandomnessConsumer.sol";
import { IRollingPotRandomnessProvider } from "./IRollingPotRandomnessProvider.sol";

/**
 * @title MockRandomnessProvider
 * @notice A mock randomness provider that allows explicit fulfillment in tests.
 */
contract MockRandomnessProvider is IRollingPotRandomnessProvider {
    /**
     * @notice Stores the context of a randomness request.
     */
    struct RequestContext {
        address game;
        uint256 roundIndex;
        bool fulfilled;
    }

    uint256 public nextRequestId = 1;
    mapping(uint256 requestId => RequestContext) public requests;

    event RandomWordRequested(uint256 indexed requestId, address indexed game, uint256 indexed roundIndex);
    event RandomWordFulfilled(uint256 indexed requestId, uint256 randomWord);

    /**
     * @notice Requests a random word and records the request for later fulfillment.
     * @param game The RollingPotGame contract address.
     * @param roundIndex The round index being resolved.
     * @return requestId The created request identifier.
     */
    function requestRandomWord(address game, uint256 roundIndex) external override returns (uint256 requestId) {
        requestId = nextRequestId;
        nextRequestId += 1;

        requests[requestId] = RequestContext({ game: game, roundIndex: roundIndex, fulfilled: false });

        emit RandomWordRequested(requestId, game, roundIndex);
    }

    /**
     * @notice Fulfills a previously requested random word by calling the game callback.
     * @param requestId The request identifier.
     * @param randomWord The random value to deliver.
     */
    function fulfillRequest(uint256 requestId, uint256 randomWord) external {
        RequestContext storage context = requests[requestId];
        require(context.game != address(0), "MockRandomnessProvider: unknown request");
        require(!context.fulfilled, "MockRandomnessProvider: already fulfilled");

        context.fulfilled = true;

        IRollingPotRandomnessConsumer(context.game).onRandomWord(requestId, randomWord);

        emit RandomWordFulfilled(requestId, randomWord);
    }
}
```

## Contract: ReentrantClaimer.sol (dependency)

```solidity
// Attempts to reenter a RollingPotGame.claim() call to validate nonReentrant protections.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { RollingPotGame } from "./RollingPotGame.sol";

/**
 * @title ReentrantClaimer
 * @notice A malicious contract that tries to reenter claim() during ETH receipt.
 */
contract ReentrantClaimer {
    address public game;
    bool public reenterAttempted;

    /**
     * @notice Sets the target game address.
     * @param gameAddress The RollingPotGame address.
     */
    function setGame(address gameAddress) external {
        game = gameAddress;
    }

    /**
     * @notice Joins the current round of the configured game.
     */
    function joinGame() external payable {
        RollingPotGame(payable(game)).join{ value: msg.value }();
    }

    /**
     * @notice Calls claim() on the configured game.
     */
    function claimFromGame() external {
        RollingPotGame(payable(game)).claim();
    }

    /**
     * @notice Receives ETH and attempts reentrancy once.
     */
    receive() external payable {
        if (!reenterAttempted) {
            reenterAttempted = true;
            try RollingPotGame(payable(game)).claim() {
                // If this succeeds, reentrancy protection is broken.
            } catch {
                // Ignore reentrancy failure.
            }
        }
    }
}
```

## Contract: RollingPotFactory.sol (dependency)

```solidity
// Deploys and registers Rolling Pot games using minimal proxy clones.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { RollingPotGame } from "./RollingPotGame.sol";

/**
 * @title RollingPotFactory
 * @notice Factory responsible for creating new autonomous Rolling Pot games.
 */
contract RollingPotFactory {
    /// @notice The game implementation contract used for clones.
    address public immutable gameImplementation;

    /// @notice Registry of all created games.
    address[] private allGames;

    /// @notice True if an address was created as a game by this factory.
    mapping(address game => bool registered) public isRegisteredGame;

    event GameCreated(
        address indexed game,
        address indexed creator,
        uint256 indexed gameId,
        uint64 roundDurationSeconds,
        uint32 capPerRound,
        uint16 resolveProbabilityBps,
        uint16 feeBps,
        uint32 feeStartRound,
        address feeRecipient,
        uint256 baseEntryPriceWei,
        uint256 entryPriceIncrementWei,
        uint64 randomnessTimeoutSeconds,
        address randomnessProvider,
        uint256 operatorSeedWei
    );

    /**
     * @notice Deploys the game implementation used by clones.
     */
    constructor() {
        gameImplementation = address(new RollingPotGame());
    }

    /**
     * @notice Returns the number of games created by this factory.
     * @return count The number of games.
     */
    function gamesCount() external view returns (uint256 count) {
        return allGames.length;
    }

    /**
     * @notice Returns a slice of game addresses for pagination.
     * @param offset The start index.
     * @param limit The maximum number of results.
     * @return games The game addresses.
     */
    function getGames(uint256 offset, uint256 limit) external view returns (address[] memory games) {
        require(limit > 0, "RollingPotFactory: limit is zero");
        if (offset >= allGames.length) {
            return new address[](0);
        }

        uint256 endExclusive = offset + limit;
        if (endExclusive > allGames.length) {
            endExclusive = allGames.length;
        }

        uint256 size = endExclusive - offset;
        games = new address[](size);
        for (uint256 index = 0; index < size; index += 1) {
            games[index] = allGames[offset + index];
        }
    }

    /**
     * @notice Creates a new Rolling Pot game instance with fixed parameters.
     * @param roundDurationSeconds Fixed duration of each round.
     * @param capPerRound Maximum participants per round (must be <= 200).
     * @param resolveProbabilityBps Probability (bps) that an eligible round resolves.
     * @param feeBps Fee (bps) charged on resolution subject to guardrails.
     * @param feeStartRound First round index where a fee may apply.
     * @param feeRecipient Address that receives fees.
     * @param baseEntryPriceWei Entry price for round 0.
     * @param entryPriceIncrementWei Entry price increment per round.
     * @param randomnessTimeoutSeconds Seconds after which randomness can be retried.
     * @param randomnessProvider Randomness provider adapter.
     * @return game The created game address.
     */
    function createGame(
        uint64 roundDurationSeconds,
        uint32 capPerRound,
        uint16 resolveProbabilityBps,
        uint16 feeBps,
        uint32 feeStartRound,
        address feeRecipient,
        uint256 baseEntryPriceWei,
        uint256 entryPriceIncrementWei,
        uint64 randomnessTimeoutSeconds,
        address randomnessProvider
    ) external payable returns (address game) {
        require(roundDurationSeconds >= 30, "RollingPotFactory: roundDuration too small");
        require(capPerRound > 0 && capPerRound <= 200, "RollingPotFactory: cap out of bounds");
        require(resolveProbabilityBps > 0 && resolveProbabilityBps <= 10_000, "RollingPotFactory: bad probability");
        require(feeBps <= 10_000, "RollingPotFactory: bad fee");
        require(feeRecipient != address(0), "RollingPotFactory: feeRecipient is zero");
        require(baseEntryPriceWei > 0, "RollingPotFactory: baseEntryPrice is zero");
        require(randomnessProvider != address(0), "RollingPotFactory: provider is zero");

        game = Clones.clone(gameImplementation);

        RollingPotGame(payable(game)).initialize{ value: msg.value }(
            roundDurationSeconds,
            capPerRound,
            resolveProbabilityBps,
            feeBps,
            feeStartRound,
            feeRecipient,
            baseEntryPriceWei,
            entryPriceIncrementWei,
            randomnessTimeoutSeconds,
            randomnessProvider
        );

        uint256 gameId = allGames.length;
        allGames.push(game);
        isRegisteredGame[game] = true;

        emit GameCreated(
            game,
            msg.sender,
            gameId,
            roundDurationSeconds,
            capPerRound,
            resolveProbabilityBps,
            feeBps,
            feeStartRound,
            feeRecipient,
            baseEntryPriceWei,
            entryPriceIncrementWei,
            randomnessTimeoutSeconds,
            randomnessProvider,
            msg.value
        );
    }
}
```

## Contract: RollingPotGame.sol (primary target)

```solidity
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
```

## Contract: SelfDestructSender.sol (dependency)

```solidity
// Sends ETH to a target via selfdestruct to test forced ETH behavior.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

/**
 * @title SelfDestructSender
 * @notice A helper contract that can force-send ETH via selfdestruct.
 */
contract SelfDestructSender {
    /**
     * @notice Accepts initial ETH funding for later selfdestruct transfer.
     */
    constructor() payable {}

    /**
     * @notice Destroys the contract and sends its balance to the target.
     * @param target The recipient of the remaining ETH.
     */
    function destroy(address payable target) external {
        selfdestruct(target);
    }
}
```

## Contract: ZeroRequestIdRandomnessProvider.sol (dependency)

```solidity
// Mock randomness provider that returns requestId 0 to test requestId validation.
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { IRollingPotRandomnessProvider } from "./IRollingPotRandomnessProvider.sol";

/**
 * @title ZeroRequestIdRandomnessProvider
 * @notice A mock provider that always returns requestId 0.
 */
contract ZeroRequestIdRandomnessProvider is IRollingPotRandomnessProvider {
    /**
     * @notice Returns 0 to simulate a misbehaving provider.
     */
    function requestRandomWord(address, uint256) external pure override returns (uint256 requestId) {
        return 0;
    }
}
```

## Tests: GameFlow.test.js

```javascript
// Integration tests for end-to-end Rolling Pot game flows via factory + randomness provider.

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

/**
 * Advances Hardhat time by the provided number of seconds.
 */
async function increaseTime(seconds) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

/**
 * Creates a game via the factory and returns the instantiated game contract.
 */
async function createGameViaFactory(params
 ) {
  const [creator] = await ethers.getSigners();

  await params.factory
    .connect(creator)
    .createGame(
      30,
      3,
      params.resolveProbabilityBps,
      params.feeBps,
      params.feeStartRound,
      creator.address,
      params.baseEntryPriceWei,
      params.entryPriceIncrementWei,
      10,
      await params.provider.getAddress(),
      { value: params.seedWei }
    );

  const games = await params.factory.getGames(0, 10);
  return (await ethers.getContractAt("RollingPotGame", games[games.length - 1]));
}

// Groups integration tests for full game lifecycle.
describe("Game flow (integration)", function () {
  // Ensures a game can be created, resolved, and claimed end-to-end.
  it("creates a game, resolves it, and allows winners to claim", async function () {
    const providerFactory = await ethers.getContractFactory("MockRandomnessProvider");
    const provider = (await providerFactory.deploy());

    const factoryFactory = await ethers.getContractFactory("RollingPotFactory");
    const factory = (await factoryFactory.deploy());

    const game = await createGameViaFactory({
      factory,
      provider,
      seedWei: 0n,
      resolveProbabilityBps: 10_000,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 5n,
      entryPriceIncrementWei: 0n
    });

    const [, playerA, playerB] = await ethers.getSigners();
    await game.connect(playerA).join({ value: 5n });
    await game.connect(playerB).join({ value: 5n });

    await increaseTime(31);
    await game.closeRound();

    const requestId = await game.activeRequestId();
    await provider.fulfillRequest(requestId, 0n);

    expect(await game.gameState()).to.equal(3); // Resolved
    expect(await game.claimableWei(playerA.address)).to.equal(5n);
    expect(await game.claimableWei(playerB.address)).to.equal(5n);

    await expect(() => game.connect(playerA).claim()).to.changeEtherBalance(playerA, 5n);
    expect(await game.claimableWei(playerA.address)).to.equal(0n);
  });

  // Ensures a non-resolving round rolls forward and can accept entries in the next round.
  it("rolls forward on non-resolution and opens the next round", async function () {
    const providerFactory = await ethers.getContractFactory("MockRandomnessProvider");
    const provider = (await providerFactory.deploy());

    const factoryFactory = await ethers.getContractFactory("RollingPotFactory");
    const factory = (await factoryFactory.deploy());

    const game = await createGameViaFactory({
      factory,
      provider,
      seedWei: 0n,
      resolveProbabilityBps: 1,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 1n,
      entryPriceIncrementWei: 1n
    });

    const [, player] = await ethers.getSigners();
    await game.connect(player).join({ value: 1n });

    await increaseTime(31);
    await game.closeRound();

    const requestId = await game.activeRequestId();
    await provider.fulfillRequest(requestId, 9999n);

    expect(await game.gameState()).to.equal(0); // Open
    expect(await game.currentRoundIndex()).to.equal(1n);
    expect(await game.currentEntryPriceWei()).to.equal(2n);
  });
});
```

## Tests: MultiGame.test.js

```javascript
// Integration tests for multiple concurrent games created by the factory.

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

/**
 * Advances Hardhat time by the provided number of seconds.
 */
async function increaseTime(seconds) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

/**
 * Creates a game via the factory and returns the game address.
 */
async function createGame(factory, provider) {
  const [creator] = await ethers.getSigners();
  const tx = await factory
    .connect(creator)
    .createGame(30, 3, 10_000, 0, 0, creator.address, 1n, 0n, 10, await provider.getAddress(), { value: 0n });
  await tx.wait();

  const games = await factory.getGames(0, 10);
  return games[games.length - 1];
}

// Groups tests that ensure games operate independently.
describe("Multi-game concurrency (integration)", function () {
  // Ensures two games can resolve independently without cross-state interference.
  it("runs two independent games in parallel", async function () {
    const providerFactory = await ethers.getContractFactory("MockRandomnessProvider");
    const provider = (await providerFactory.deploy());

    const factoryFactory = await ethers.getContractFactory("RollingPotFactory");
    const factory = (await factoryFactory.deploy());

    const gameAAddress = await createGame(factory, provider);
    const gameBAddress = await createGame(factory, provider);

    expect(gameAAddress).to.not.equal(gameBAddress);
    expect(await factory.gamesCount()).to.equal(2n);

    const gameA = (await ethers.getContractAt("RollingPotGame", gameAAddress));
    const gameB = (await ethers.getContractAt("RollingPotGame", gameBAddress));

    const [, playerA, playerB] = await ethers.getSigners();
    await gameA.connect(playerA).join({ value: 1n });
    await gameB.connect(playerB).join({ value: 1n });

    await increaseTime(31);
    await gameA.closeRound();
    await gameB.closeRound();

    const requestA = await gameA.activeRequestId();
    const requestB = await gameB.activeRequestId();

    await provider.fulfillRequest(requestA, 0n);
    await provider.fulfillRequest(requestB, 0n);

    expect(await gameA.gameState()).to.equal(3);
    expect(await gameB.gameState()).to.equal(3);
  });
});
```

## Tests: RollingPotFactory.test.js

```javascript
// Unit tests for the RollingPotFactory contract game creation and registry behavior.

const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Deploys the factory and a mock randomness provider for testing.
 */
async function deployFactoryWithMockProvider()
{
  const providerFactory = await ethers.getContractFactory("MockRandomnessProvider");
  const provider = (await providerFactory.deploy());

  const factoryFactory = await ethers.getContractFactory("RollingPotFactory");
  const factory = (await factoryFactory.deploy());

  return { factory, provider };
}

// Groups unit tests for the RollingPotFactory contract.
describe("RollingPotFactory (unit)", function () {
  // Ensures creating a game deploys a clone, initializes it, and registers it.
  it("creates a game clone and registers it in the factory", async function () {
    const { factory, provider } = await deployFactoryWithMockProvider();
    const [creator] = await ethers.getSigners();

    const tx = await factory
      .connect(creator)
      .createGame(
        60,
        3,
        1,
        0,
        0,
        creator.address,
        1n,
        0n,
        30,
        await provider.getAddress(),
        { value: 5n }
      );

    await expect(tx).to.emit(factory, "GameCreated");

    expect(await factory.gamesCount()).to.equal(1n);

    const games = await factory.getGames(0, 10);
    expect(games.length).to.equal(1);
    expect(games[0]).to.properAddress;

    const game = (await ethers.getContractAt("RollingPotGame", games[0]));
    expect(await game.initialized()).to.equal(true);
    expect(await game.capPerRound()).to.equal(3);
  });

  // Ensures pagination returns an empty list when offset is out of bounds.
  it("returns empty list when pagination offset exceeds games length", async function () {
    const { factory } = await deployFactoryWithMockProvider();
    const games = await factory.getGames(999, 10);
    expect(games.length).to.equal(0);
  });
});
```

## Tests: RollingPotGame.test.js

```javascript
// Unit tests for the RollingPotGame contract round lifecycle and accounting.

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

/**
 * Advances Hardhat time by the provided number of seconds.
 */
async function increaseTime(seconds) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

/**
 * Deploys a RollingPotGame initialized for unit testing.
 */
async function deployInitializedGame(params
 )
{
  const [deployer] = await ethers.getSigners();

  const providerFactory = await ethers.getContractFactory("MockRandomnessProvider");
  const provider = (await providerFactory.deploy());

  const gameFactory = await ethers.getContractFactory("RollingPotGame");
  const game = (await gameFactory.deploy());

  await game
    .connect(deployer)
    .initialize(
      params.roundDurationSeconds,
      params.capPerRound,
      params.resolveProbabilityBps,
      params.feeBps,
      params.feeStartRound,
      deployer.address,
      params.baseEntryPriceWei,
      params.entryPriceIncrementWei,
      params.randomnessTimeoutSeconds,
      await provider.getAddress(),
      { value: params.seedWei }
    );

  return { game, provider };
}

// Groups unit tests for the RollingPotGame contract.
describe("RollingPotGame (unit)", function () {
  // Verifies successful joining behavior under normal conditions.
  it("allows joining during an open round with exact entry price", async function () {
    const { game } = await deployInitializedGame({
      roundDurationSeconds: 60,
      capPerRound: 3,
      resolveProbabilityBps: 1,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 1n,
      entryPriceIncrementWei: 0n,
      randomnessTimeoutSeconds: 30,
      seedWei: 0n
    });

    const [, player] = await ethers.getSigners();

    await expect(game.connect(player).join({ value: 1n }))
      .to.emit(game, "Joined")
      .withArgs(await game.getAddress(), 0n, player.address, 1n);
  });

  // Ensures one-entry-per-address-per-round is enforced.
  it("rejects joining twice in the same round", async function () {
    const { game } = await deployInitializedGame({
      roundDurationSeconds: 60,
      capPerRound: 3,
      resolveProbabilityBps: 1,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 1n,
      entryPriceIncrementWei: 0n,
      randomnessTimeoutSeconds: 30,
      seedWei: 0n
    });

    const [, player] = await ethers.getSigners();

    await game.connect(player).join({ value: 1n });
    await expect(game.connect(player).join({ value: 1n })).to.be.revertedWith(
      "RollingPotGame: already joined this round"
    );
  });

  // Ensures empty rounds roll forward deterministically without randomness.
  it("rolls forward without requesting randomness when round closes with zero participants", async function () {
    const { game } = await deployInitializedGame({
      roundDurationSeconds: 30,
      capPerRound: 3,
      resolveProbabilityBps: 1,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 1n,
      entryPriceIncrementWei: 1n,
      randomnessTimeoutSeconds: 30,
      seedWei: 5n
    });

    await increaseTime(31);

    await expect(game.closeRound())
      .to.emit(game, "RoundClosed")
      .and.to.emit(game, "RoundRolled")
      .and.to.emit(game, "RoundOpened");

    expect(await game.currentRoundIndex()).to.equal(1n);
    expect(await game.gameState()).to.equal(0); // Open
    expect(await game.activeRequestId()).to.equal(0n);
  });

  // Ensures closing a populated round requests randomness and enters pending state.
  it("requests randomness when closing a round with participants", async function () {
    const { game } = await deployInitializedGame({
      roundDurationSeconds: 30,
      capPerRound: 3,
      resolveProbabilityBps: 1,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 1n,
      entryPriceIncrementWei: 0n,
      randomnessTimeoutSeconds: 30,
      seedWei: 0n
    });

    const [, player] = await ethers.getSigners();
    await game.connect(player).join({ value: 1n });

    await increaseTime(31);

    await expect(game.closeRound())
      .to.emit(game, "RoundClosed")
      .and.to.emit(game, "RandomnessRequested");

    expect(await game.gameState()).to.equal(2); // RandomnessPending
    expect(await game.activeRequestId()).to.not.equal(0n);
  });

  // Ensures a misbehaving provider returning requestId=0 causes a clean revert.
  it("reverts if provider returns requestId 0", async function () {
    const [deployer, player] = await ethers.getSigners();

    const zeroProviderFactory = await ethers.getContractFactory("ZeroRequestIdRandomnessProvider");
    const zeroProvider = await zeroProviderFactory.connect(deployer).deploy();
    await zeroProvider.waitForDeployment();

    const gameFactory = await ethers.getContractFactory("RollingPotGame");
    const game = (await gameFactory.connect(deployer).deploy());

    await game.initialize(
      30,
      3,
      1,
      0,
      0,
      deployer.address,
      1n,
      0n,
      10,
      await zeroProvider.getAddress(),
      { value: 0n }
    );

    await game.connect(player).join({ value: 1n });
    await increaseTime(31);

    await expect(game.closeRound()).to.be.revertedWith("RollingPotGame: provider returned requestId 0");
    expect(await game.gameState()).to.equal(0); // Open
    expect(await game.activeRequestId()).to.equal(0n);
  });

  // Ensures a stuck randomness request can be retried permissionlessly after timeout.
  it("allows retrying randomness after the configured timeout", async function () {
    const { game } = await deployInitializedGame({
      roundDurationSeconds: 30,
      capPerRound: 3,
      resolveProbabilityBps: 1,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 1n,
      entryPriceIncrementWei: 0n,
      randomnessTimeoutSeconds: 10,
      seedWei: 0n
    });

    const [, player] = await ethers.getSigners();
    await game.connect(player).join({ value: 1n });

    await increaseTime(31);
    await game.closeRound();

    const firstRequestId = await game.activeRequestId();
    await increaseTime(11);
    await game.retryRandomness();
    const secondRequestId = await game.activeRequestId();

    expect(secondRequestId).to.not.equal(firstRequestId);
  });

  // Ensures fulfilling a stale (older) requestId after a retry does not revert and does not corrupt state.
  it("ignores stale randomness fulfillments after retry", async function () {
    const { game, provider } = await deployInitializedGame({
      roundDurationSeconds: 30,
      capPerRound: 3,
      resolveProbabilityBps: 10_000,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 1n,
      entryPriceIncrementWei: 0n,
      randomnessTimeoutSeconds: 10,
      seedWei: 0n
    });

    const [, player] = await ethers.getSigners();
    await game.connect(player).join({ value: 1n });

    await increaseTime(31);
    await game.closeRound();
    const firstRequestId = await game.activeRequestId();

    await increaseTime(11);
    await game.retryRandomness();
    const secondRequestId = await game.activeRequestId();
    expect(secondRequestId).to.not.equal(firstRequestId);

    await expect(provider.fulfillRequest(firstRequestId, 0n))
      .to.emit(game, "RandomnessIgnored")
      .withArgs(await game.getAddress(), 0n, firstRequestId);

    expect(await game.gameState()).to.equal(2); // RandomnessPending

    await provider.fulfillRequest(secondRequestId, 0n);
    expect(await game.gameState()).to.equal(3); // Resolved
  });

  // Ensures forced ETH via selfdestruct is included in the pool (treated as donation).
  it("includes selfdestruct-forced ETH in the resolved pool", async function () {
    const { game, provider } = await deployInitializedGame({
      roundDurationSeconds: 30,
      capPerRound: 3,
      resolveProbabilityBps: 10_000,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 1n,
      entryPriceIncrementWei: 0n,
      randomnessTimeoutSeconds: 10,
      seedWei: 0n
    });

    const [deployer, player] = await ethers.getSigners();
    await game.connect(player).join({ value: 1n });

    const senderFactory = await ethers.getContractFactory("SelfDestructSender");
    const sender = await senderFactory.connect(deployer).deploy({ value: 5n });
    await sender.waitForDeployment();
    await sender.destroy(await game.getAddress());

    await increaseTime(31);
    await game.closeRound();
    const requestId = await game.activeRequestId();
    await provider.fulfillRequest(requestId, 0n);

    expect(await game.claimableWei(player.address)).to.equal(6n);
  });

  // Ensures a contract winner attempting claim() reentrancy cannot over-claim.
  it("prevents claim() reentrancy", async function () {
    const { game, provider } = await deployInitializedGame({
      roundDurationSeconds: 30,
      capPerRound: 3,
      resolveProbabilityBps: 10_000,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 2n,
      entryPriceIncrementWei: 0n,
      randomnessTimeoutSeconds: 10,
      seedWei: 0n
    });

    const [deployer] = await ethers.getSigners();
    const claimerFactory = await ethers.getContractFactory("ReentrantClaimer");
    const claimer = await claimerFactory.connect(deployer).deploy();
    await claimer.waitForDeployment();
    await claimer.setGame(await game.getAddress());

    await claimer.joinGame({ value: 2n });

    await increaseTime(31);
    await game.closeRound();
    const requestId = await game.activeRequestId();
    await provider.fulfillRequest(requestId, 0n);

    expect(await game.claimableWei(await claimer.getAddress())).to.equal(2n);
    await expect(() => claimer.claimFromGame()).to.changeEtherBalance(claimer, 2n);
    expect(await game.claimableWei(await claimer.getAddress())).to.equal(0n);
  });

  // Ensures a resolving random word ends the game and creates claimables.
  it("resolves and creates claimables when randomness triggers resolution", async function () {
    const { game, provider } = await deployInitializedGame({
      roundDurationSeconds: 30,
      capPerRound: 3,
      resolveProbabilityBps: 10_000,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 3n,
      entryPriceIncrementWei: 0n,
      randomnessTimeoutSeconds: 30,
      seedWei: 0n
    });

    const [, playerA, playerB] = await ethers.getSigners();
    await game.connect(playerA).join({ value: 3n });
    await game.connect(playerB).join({ value: 3n });

    await increaseTime(31);
    await game.closeRound();

    const requestId = await game.activeRequestId();
    await provider.fulfillRequest(requestId, 0n);

    expect(await game.gameState()).to.equal(3); // Resolved
    expect(await game.claimableWei(playerA.address)).to.equal(3n);
    expect(await game.claimableWei(playerB.address)).to.equal(3n);
  });

  // Ensures fee guardrails disable fees that would make payouts less than entry cost.
  it("applies fee guardrails by disabling fee if per-winner payout would fall below entry price", async function () {
    const { game, provider } = await deployInitializedGame({
      roundDurationSeconds: 30,
      capPerRound: 3,
      resolveProbabilityBps: 10_000,
      feeBps: 5_000,
      feeStartRound: 0,
      baseEntryPriceWei: 10n,
      entryPriceIncrementWei: 0n,
      randomnessTimeoutSeconds: 30,
      seedWei: 0n
    });

    const [, player] = await ethers.getSigners();
    await game.connect(player).join({ value: 10n });

    await increaseTime(31);
    await game.closeRound();

    const requestId = await game.activeRequestId();
    await provider.fulfillRequest(requestId, 0n);

    // Pool is 10 wei, 50% fee would make per-winner payout 5 < entry(10) => fee disabled.
    expect(await game.claimableWei(player.address)).to.equal(10n);
  });

  // Ensures remainder wei are distributed deterministically to earliest joiners.
  it("distributes remainder by adding +1 wei to the first winners in join order", async function () {
    const { game, provider } = await deployInitializedGame({
      roundDurationSeconds: 30,
      capPerRound: 3,
      resolveProbabilityBps: 10_000,
      feeBps: 0,
      feeStartRound: 0,
      baseEntryPriceWei: 1n,
      entryPriceIncrementWei: 0n,
      randomnessTimeoutSeconds: 30,
      seedWei: 1n
    });

    const [, playerA, playerB, playerC] = await ethers.getSigners();
    await game.connect(playerA).join({ value: 1n });
    await game.connect(playerB).join({ value: 1n });
    await game.connect(playerC).join({ value: 1n });

    await increaseTime(31);
    await game.closeRound();

    const requestId = await game.activeRequestId();
    await provider.fulfillRequest(requestId, 0n);

    expect(await game.claimableWei(playerA.address)).to.equal(2n);
    expect(await game.claimableWei(playerB.address)).to.equal(1n);
    expect(await game.claimableWei(playerC.address)).to.equal(1n);
  });
});
```
