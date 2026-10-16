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
