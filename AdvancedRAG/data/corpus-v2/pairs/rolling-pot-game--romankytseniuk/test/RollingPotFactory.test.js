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
