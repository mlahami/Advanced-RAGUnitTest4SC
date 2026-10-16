const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther, ZeroAddress, randomBytes, hexlify } = require("ethers");

const Status = { Active: 0, Completed: 1, Cancelled: 2 };
const HOUR = 3600;

async function advance(seconds) {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine', []);
}

describe('RecurringScheduler', () => {
  let scheduler;
  let payer;
  let merchant;
  let stranger;

  beforeEach(async () => {
    [payer, merchant, stranger] = await ethers.getSigners();
    const S = await ethers.getContractFactory('RecurringScheduler');
    scheduler = await S.deploy(payer.address);
  });

  const newSalt = () => hexlify(randomBytes(32));

  describe('Lifecycle', () => {
    it('rejects interval < 1 hour', async () => {
      const salt = newSalt();
      await expect(
        scheduler.connect(payer).createSubscription(merchant.address, ZeroAddress, parseEther('0.1'), 3599, 6, salt, {
          value: parseEther('0.6'),
        }),
      ).to.be.revertedWithCustomError(scheduler, 'IntervalTooShort');
    });

    it('rejects msg.value != total deposit', async () => {
      const salt = newSalt();
      await expect(
        scheduler.connect(payer).createSubscription(merchant.address, ZeroAddress, parseEther('0.1'), HOUR, 5, salt, {
          value: parseEther('0.4'),
        }),
      ).to.be.revertedWithCustomError(scheduler, 'AmountMismatch');
    });

    it('claim accrues 1 period per interval', async () => {
      const salt = newSalt();
      const amt = parseEther('0.1');
      await scheduler.connect(payer).createSubscription(merchant.address, ZeroAddress, amt, HOUR, 6, salt, { value: parseEther('0.6') });
      const id = await scheduler.computeSubId(payer.address, merchant.address, salt);

      expect(await scheduler.accruedPeriods(id)).to.equal(0);
      await advance(HOUR + 1);
      expect(await scheduler.accruedPeriods(id)).to.equal(1);

      const balBefore = await ethers.provider.getBalance(merchant.address);
      const tx = await scheduler.connect(merchant).claim(id);
      const r = await tx.wait();
      const gas = r .gasUsed * r .gasPrice;
      const balAfter = await ethers.provider.getBalance(merchant.address);
      expect(balAfter - balBefore + gas).to.equal(amt);
    });

    it('claim batches multiple accrued periods in one tx', async () => {
      const salt = newSalt();
      const amt = parseEther('0.1');
      await scheduler.connect(payer).createSubscription(merchant.address, ZeroAddress, amt, HOUR, 6, salt, { value: parseEther('0.6') });
      const id = await scheduler.computeSubId(payer.address, merchant.address, salt);

      await advance(3 * HOUR + 1);
      expect(await scheduler.accruedPeriods(id)).to.equal(3);
      await scheduler.connect(merchant).claim(id);
      const s = await scheduler.getSubscription(id);
      expect(s.claimedPeriods).to.equal(3);
    });

    it('completes after final period', async () => {
      const salt = newSalt();
      await scheduler.connect(payer).createSubscription(merchant.address, ZeroAddress, parseEther('0.1'), HOUR, 2, salt, { value: parseEther('0.2') });
      const id = await scheduler.computeSubId(payer.address, merchant.address, salt);
      await advance(2 * HOUR + 1);
      await scheduler.connect(merchant).claim(id);
      const s = await scheduler.getSubscription(id);
      expect(s.status).to.equal(Status.Completed);
    });

    it('cannot claim again after completion', async () => {
      const salt = newSalt();
      await scheduler.connect(payer).createSubscription(merchant.address, ZeroAddress, parseEther('0.1'), HOUR, 1, salt, { value: parseEther('0.1') });
      const id = await scheduler.computeSubId(payer.address, merchant.address, salt);
      await advance(HOUR + 1);
      await scheduler.connect(merchant).claim(id);
      await expect(scheduler.connect(merchant).claim(id)).to.be.revertedWithCustomError(scheduler, 'WrongStatus');
    });

    it('reverts claim when no periods accrued', async () => {
      const salt = newSalt();
      await scheduler.connect(payer).createSubscription(merchant.address, ZeroAddress, parseEther('0.1'), HOUR, 3, salt, { value: parseEther('0.3') });
      const id = await scheduler.computeSubId(payer.address, merchant.address, salt);
      await expect(scheduler.connect(merchant).claim(id)).to.be.revertedWithCustomError(scheduler, 'NoPeriodsAccrued');
    });
  });

  describe('Cancel', () => {
    it('payer cancel splits accrued and refunds remainder', async () => {
      const salt = newSalt();
      const amt = parseEther('0.1');
      await scheduler.connect(payer).createSubscription(merchant.address, ZeroAddress, amt, HOUR, 5, salt, { value: parseEther('0.5') });
      const id = await scheduler.computeSubId(payer.address, merchant.address, salt);

      await advance(2 * HOUR + 1);

      const merchStart = await ethers.provider.getBalance(merchant.address);
      const payerStart = await ethers.provider.getBalance(payer.address);
      const tx = await scheduler.connect(payer).cancel(id);
      const r = await tx.wait();
      const gas = r .gasUsed * r .gasPrice;

      const merchEnd = await ethers.provider.getBalance(merchant.address);
      const payerEnd = await ethers.provider.getBalance(payer.address);
      expect(merchEnd - merchStart).to.equal(amt * 2n);
      expect(payerEnd - payerStart + gas).to.equal(amt * 3n);

      const s = await scheduler.getSubscription(id);
      expect(s.status).to.equal(Status.Cancelled);
    });

    it('merchant cancel works too', async () => {
      const salt = newSalt();
      await scheduler.connect(payer).createSubscription(merchant.address, ZeroAddress, parseEther('0.1'), HOUR, 3, salt, { value: parseEther('0.3') });
      const id = await scheduler.computeSubId(payer.address, merchant.address, salt);
      await scheduler.connect(merchant).cancel(id);
      const s = await scheduler.getSubscription(id);
      expect(s.status).to.equal(Status.Cancelled);
    });

    it('stranger cannot cancel', async () => {
      const salt = newSalt();
      await scheduler.connect(payer).createSubscription(merchant.address, ZeroAddress, parseEther('0.1'), HOUR, 3, salt, { value: parseEther('0.3') });
      const id = await scheduler.computeSubId(payer.address, merchant.address, salt);
      await expect(scheduler.connect(stranger).cancel(id)).to.be.revertedWithCustomError(scheduler, 'NotPayer');
    });
  });
});
