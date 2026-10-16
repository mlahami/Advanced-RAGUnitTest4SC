const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const MIN_STAKE = ethers.parseEther("100");
const SCALE = ethers.parseEther("1");

async function fixture() {
  const [admin, treasury, alice, bob, fisherman, runner] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockERC20");
  const token = await Mock.deploy();
  await token.waitForDeployment();

  const Staking = await ethers.getContractFactory("AnnealStaking");
  const staking = await Staking.deploy(await token.getAddress(), MIN_STAKE, treasury.address);
  await staking.waitForDeployment();

  // Grant AUDITOR_ROLE to runner
  const role = await staking.AUDITOR_ROLE();
  await (await staking.grantRole(role, runner.address)).wait();

  for (const u of [alice, bob, admin]) {
    await (await token.mint(u.address, ethers.parseEther("10000"))).wait();
    await (await token.connect(u).approve(await staking.getAddress(), ethers.MaxUint256)).wait();
  }

  return { admin, treasury, alice, bob, fisherman, runner, token, staking };
}

async function advanceDays(d) {
  await network.provider.send("evm_increaseTime", [d * 86400]);
  await network.provider.send("evm_mine", []);
}

describe("AnnealStaking", () => {
  it("stakes and emits Staked event", async () => {
    const { staking, alice, token } = await fixture();
    const amt = ethers.parseEther("500");
    await expect(staking.connect(alice).stake(amt))
      .to.emit(staking, "Staked")
      .withArgs(alice.address, amt);
    const info = await staking.getAuditorInfo(alice.address);
    expect(info.amount).to.equal(amt);
    expect(info.active).to.equal(true);
    expect(await token.balanceOf(await staking.getAddress())).to.equal(amt);
  });

  it("unstakes after cooldown", async () => {
    const { staking, alice, token } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("500"))).wait();
    await advanceDays(8);
    await expect(staking.connect(alice).unstake(ethers.parseEther("200")))
      .to.emit(staking, "Unstaked")
      .withArgs(alice.address, ethers.parseEther("200"));
    expect((await staking.getAuditorInfo(alice.address)).amount).to.equal(ethers.parseEther("300"));
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("9700"));
  });

  it("reverts unstake before cooldown", async () => {
    const { staking, alice } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("500"))).wait();
    await expect(staking.connect(alice).unstake(ethers.parseEther("100")))
      .to.be.revertedWithCustomError(staking, "CooldownNotMet");
  });

  it("slashes 2.5% with fisherman+treasury split", async () => {
    const { staking, admin, alice, treasury, token } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("1000"))).wait();
    const before = await token.balanceOf(admin.address);
    const treasuryBefore = await token.balanceOf(treasury.address);
    await expect(staking.connect(admin).slash(alice.address, 250, "bad audit"))
      .to.emit(staking, "Slashed")
      .withArgs(alice.address, ethers.parseEther("25"), "bad audit");
    expect((await staking.getAuditorInfo(alice.address)).amount).to.equal(ethers.parseEther("975"));
    const fisherman = await token.balanceOf(admin.address);
    const treasuryAfter = await token.balanceOf(treasury.address);
    expect(fisherman - before).to.equal(ethers.parseEther("12.5"));
    expect(treasuryAfter - treasuryBefore).to.equal(ethers.parseEther("12.5"));
  });

  it("rejects slash exceeding 10% cap", async () => {
    const { staking, admin, alice } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("1000"))).wait();
    await expect(staking.connect(admin).slash(alice.address, 1001, "too much"))
      .to.be.revertedWithCustomError(staking, "ExceedsMaxSlash");
  });

  it("non-arbitrator cannot slash", async () => {
    const { staking, alice, bob } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("1000"))).wait();
    await expect(staking.connect(bob).slash(alice.address, 100, "nope"))
      .to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount");
  });

  it("recordAudit updates accuracy", async () => {
    const { staking, alice, runner } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("500"))).wait();
    await (await staking.connect(runner).recordAudit(alice.address, true)).wait();
    await (await staking.connect(runner).recordAudit(alice.address, true)).wait();
    await (await staking.connect(runner).recordAudit(alice.address, false)).wait();
    const info = await staking.getAuditorInfo(alice.address);
    expect(info.totalAudits).to.equal(3n);
    expect(info.correctAudits).to.equal(2n);
    expect(info.accuracy).to.equal(66n);
  });

  it("distributes fees 60/30/10", async () => {
    const { staking, alice, admin, treasury, token } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("1000"))).wait();
    const tBefore = await token.balanceOf(treasury.address);
    const fee = ethers.parseEther("100");
    await expect(staking.connect(admin).distributeFee(fee))
      .to.emit(staking, "FeeDistributed")
      .withArgs(ethers.parseEther("60"), ethers.parseEther("30"), ethers.parseEther("10"));
    expect((await token.balanceOf(treasury.address)) - tBefore).to.equal(ethers.parseEther("10"));
  });

  it("stakers can claim accumulated rewards", async () => {
    const { staking, alice, bob, admin, token } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("1000"))).wait();
    await (await staking.connect(bob).stake(ethers.parseEther("1000"))).wait();
    await (await staking.connect(admin).distributeFee(ethers.parseEther("200"))).wait(); // 60 stakers
    const before = await token.balanceOf(alice.address);
    await (await staking.connect(alice).claimRewards()).wait();
    const gained = (await token.balanceOf(alice.address)) - before;
    expect(gained).to.equal(ethers.parseEther("30")); // 60 / 2 stakers
  });

  it("slash that drops auditor below minStake deactivates them", async () => {
    const { staking, admin, alice } = await fixture();
    // Stake exactly min so any slash drops below.
    await (await staking.connect(alice).stake(MIN_STAKE)).wait();
    await (await staking.connect(admin).slash(alice.address, 100, "1%")).wait(); // 1 token off
    const info = await staking.getAuditorInfo(alice.address);
    expect(info.active).to.equal(false);
    expect(info.slashedAmount).to.be.greaterThan(0n);
  });

  it("below-minimum stake reverts", async () => {
    const { staking, alice } = await fixture();
    await expect(staking.connect(alice).stake(ethers.parseEther("10")))
      .to.be.revertedWithCustomError(staking, "BelowMinStake");
  });
});

// Silence ts unused warning for SCALE if present
void SCALE;
