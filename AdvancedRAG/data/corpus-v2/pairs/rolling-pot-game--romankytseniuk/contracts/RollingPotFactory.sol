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
