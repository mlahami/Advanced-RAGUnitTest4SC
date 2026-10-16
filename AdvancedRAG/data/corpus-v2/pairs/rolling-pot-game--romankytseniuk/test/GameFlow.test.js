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
