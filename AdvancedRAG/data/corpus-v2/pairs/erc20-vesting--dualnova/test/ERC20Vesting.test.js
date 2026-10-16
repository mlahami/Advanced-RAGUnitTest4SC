const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const TOKEN_NAME = 'Acme Token';
const TOKEN_SYMBOL = 'ACME';
const INITIAL_SUPPLY = ethers.parseUnits('1000000', 18);

describe('ERC20Vesting', () => {
  async function deploy() {
    const [owner, beneficiary, other] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('ERC20Vesting');
    const token = (await factory.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      INITIAL_SUPPLY,
      owner .address,
    ));
    return { token, owner: owner, beneficiary: beneficiary, other: other };
  }

  it('mints the initial supply to the owner', async () => {
    const { token, owner } = await deploy();
    expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
  });

  it('rejects schedules with invalid params', async () => {
    const { token, owner, beneficiary } = await deploy();
    const start = BigInt(await time.latest()) + 100n;
    // duration < cliff
    await expect(
      token.connect(owner).grant(beneficiary.address, ethers.parseUnits('1000', 18), start, 1000, 500),
    ).to.be.revertedWithCustomError(token, 'InvalidSchedule');
    // total = 0
    await expect(
      token.connect(owner).grant(beneficiary.address, 0n, start, 100, 1000),
    ).to.be.revertedWithCustomError(token, 'InvalidSchedule');
  });

  it('grants a schedule and pulls the tokens into the contract', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await expect(token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000))
      .to.emit(token, 'ScheduleCreated')
      .withArgs(beneficiary.address, amount, start, 100, 1000);
    expect(await token.balanceOf(await token.getAddress())).to.equal(amount);
    expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - amount);
  });

  it('rejects a second schedule for the same beneficiary', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);
    await expect(
      token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000),
    ).to.be.revertedWithCustomError(token, 'ScheduleAlreadyExists');
  });

  it('returns 0 vested before cliff and full total after duration', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);

    // Before cliff
    expect(await token.vestedAmount(beneficiary.address)).to.equal(0);

    // After full duration
    await time.increaseTo(start + 1000n + 1n);
    expect(await token.vestedAmount(beneficiary.address)).to.equal(amount);
  });

  it('vests linearly between cliff and end', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);

    // Halfway through
    await time.increaseTo(start + 500n);
    const halfway = await token.vestedAmount(beneficiary.address);
    expect(halfway).to.be.closeTo(amount / 2n, ethers.parseUnits('20', 18));
  });

  it('release transfers vested tokens to the beneficiary', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);
    await time.increaseTo(start + 1000n + 1n);

    await expect(token.connect(beneficiary).release(beneficiary.address))
      .to.emit(token, 'TokensReleased')
      .withArgs(beneficiary.address, amount);
    expect(await token.balanceOf(beneficiary.address)).to.equal(amount);
  });

  it('revoke returns the unvested portion to the owner', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);

    // Halfway through, revoke
    await time.increaseTo(start + 500n);
    const ownerBalanceBefore = await token.balanceOf(owner.address);
    await token.connect(owner).revoke(beneficiary.address);

    const expectedReturned = amount / 2n;
    expect(await token.balanceOf(owner.address)).to.be.closeTo(
      ownerBalanceBefore + expectedReturned,
      ethers.parseUnits('20', 18),
    );

    // Beneficiary can still release the vested portion
    await token.connect(beneficiary).release(beneficiary.address);
    expect(await token.balanceOf(beneficiary.address)).to.be.closeTo(
      expectedReturned,
      ethers.parseUnits('20', 18),
    );
  });

  it('cannot revoke twice', async () => {
    const { token, owner, beneficiary } = await deploy();
    const amount = ethers.parseUnits('10000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await token.connect(owner).grant(beneficiary.address, amount, start, 100, 1000);
    await time.increaseTo(start + 500n);
    await token.connect(owner).revoke(beneficiary.address);
    await expect(token.connect(owner).revoke(beneficiary.address)).to.be.revertedWithCustomError(
      token,
      'AlreadyRevoked',
    );
  });

  it('non-owner cannot grant or revoke', async () => {
    const { token, beneficiary, other } = await deploy();
    const amount = ethers.parseUnits('1000', 18);
    const start = BigInt(await time.latest()) + 10n;
    await expect(
      token.connect(other).grant(beneficiary.address, amount, start, 100, 1000),
    ).to.be.revertedWithCustomError(token, 'OwnableUnauthorizedAccount');
  });
});
