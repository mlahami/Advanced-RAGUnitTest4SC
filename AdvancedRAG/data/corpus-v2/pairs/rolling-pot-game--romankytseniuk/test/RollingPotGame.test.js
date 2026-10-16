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
