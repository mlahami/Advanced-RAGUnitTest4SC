const { expect } = require("chai");
const { ethers } = require("hardhat");

const time = {
  async increase(seconds) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
    await ethers.provider.send("evm_mine", []);
  },
};

/**
 * These tests exist to prove the claims made about the sale.
 *
 * The claims are: one published price for everyone with no way to change it,
 * the buyer's money and the buyer's BONA move in the same transaction, the
 * BONA is in the buyer's wallet when that transaction confirms, the project
 * never holds a dollar that has not bought anything, what the contract can
 * sell is bounded two separate ways, and nothing here can reach a token that
 * belongs to a buyer.
 *
 * If a test here is removed, the corresponding claim must be removed from the
 * website and the documentation in the same commit.
 */
describe("DirectSale", function () {
  const BONA = (n) => ethers.parseUnits(String(n), 18);
  const USDC = (n) => ethers.parseUnits(String(n), 6);
  const DAY = 24 * 60 * 60;

  // The published price: 1 USDC = 100 BONA.
  const PRICE = BONA(100);
  const MAX_BONA = BONA(60_000_000);
  const TRANCHE = BONA(500_000);

  let bona, usdc, sale;
  let treasury, alice, bob, mallory;

  beforeEach(async function () {
    [treasury, alice, bob, mallory] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("BonaToken");
    bona = await Token.deploy(treasury.address);
    await bona.waitForDeployment();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy(treasury.address, USDC(1_000_000));
    await usdc.waitForDeployment();

    const Sale = await ethers.getContractFactory("DirectSale");
    sale = await Sale.deploy(
      await bona.getAddress(),
      await usdc.getAddress(),
      treasury.address,
      PRICE,
      MAX_BONA
    );
    await sale.waitForDeployment();

    // Buyers need dollars. The mock mints its whole supply to the deployer,
    // so hand some out from there.
    await usdc.transfer(alice.address, USDC(10_000));
    await usdc.transfer(bob.address, USDC(10_000));
    await usdc.connect(alice).approve(await sale.getAddress(), ethers.MaxUint256);
    await usdc.connect(bob).approve(await sale.getAddress(), ethers.MaxUint256);
  });

  /** Arm the sale the way the multisig will: one instalment of BONA. */
  async function arm(amount = TRANCHE) {
    await bona.transfer(await sale.getAddress(), amount);
  }

  describe("Terms are fixed at deployment", function () {
    it("publishes one price, and nothing can change it", async function () {
      expect(await sale.bonaPerUsdc()).to.equal(PRICE);
      expect(await sale.maxBona()).to.equal(MAX_BONA);

      const names = sale.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.name);
      for (const f of [
        "setPrice",
        "updatePrice",
        "setRate",
        "setMaxBona",
        "pause",
        "unpause",
        "owner",
        "transferOwnership",
        "setTreasury",
        "setVesting",
        "withdraw",
        "sweep",
        "rescue",
      ]) {
        expect(names, `${f}() must not exist`).to.not.include(f);
      }
    });

    it("quotes the published price before any transaction", async function () {
      expect(await sale.quote(USDC(1))).to.equal(BONA(100));
      expect(await sale.quote(USDC(10))).to.equal(BONA(1_000));
      expect(await sale.quote(USDC(2_500))).to.equal(BONA(250_000));
    });

    it("rejects a zero address, a zero price and a zero ceiling", async function () {
      const Sale = await ethers.getContractFactory("DirectSale");
      const args = [
        await bona.getAddress(),
        await usdc.getAddress(),
        treasury.address,
        PRICE,
        MAX_BONA,
      ];
      const swap = (i, v) => args.map((a, j) => (i === j ? v : a));

      for (const i of [0, 1, 2]) {
        await expect(Sale.deploy(...swap(i, ethers.ZeroAddress))).to.be.reverted;
      }
      await expect(Sale.deploy(...swap(3, 0))).to.be.revertedWithCustomError(sale, "BadPrice");
      await expect(Sale.deploy(...swap(4, 0))).to.be.revertedWithCustomError(
        sale,
        "BadAllocation"
      );
    });
  });

  describe("Buying", function () {
    beforeEach(arm);

    it("puts the published amount of BONA in the buyer's wallet", async function () {
      await sale.connect(alice).buy(USDC(10));

      expect(await bona.balanceOf(alice.address)).to.equal(BONA(1_000));
      expect(await sale.bonaSold()).to.equal(BONA(1_000));
      expect(await sale.boughtBy(alice.address)).to.equal(BONA(1_000));
    });

    it("charges the first buyer and the last buyer the same", async function () {
      await sale.connect(alice).buy(USDC(100));
      await sale.connect(bob).buy(USDC(100));
      await time.increase(90 * DAY);
      await sale.connect(alice).buy(USDC(100));

      expect(await bona.balanceOf(bob.address)).to.equal(BONA(10_000));
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(20_000));
      expect(await sale.boughtBy(alice.address)).to.equal(BONA(20_000));
    });

    /**
     * The property the whole contract is arranged around: the dollars land in
     * the multisig and the BONA lands in the wallet in one call, so the
     * project never holds money that has not yet bought anything.
     */
    it("sends the USDC straight to the multisig and keeps none", async function () {
      const before = await usdc.balanceOf(treasury.address);
      await sale.connect(alice).buy(USDC(250));

      expect(await usdc.balanceOf(treasury.address)).to.equal(before + USDC(250));
      expect(await usdc.balanceOf(await sale.getAddress())).to.equal(0);
      expect(await sale.usdcReceived()).to.equal(USDC(250));
    });

    it("moves the money and the BONA in the same transaction", async function () {
      const saleAddr = await sale.getAddress();
      await expect(sale.connect(alice).buy(USDC(10)))
        .to.emit(sale, "Bought")
        .withArgs(alice.address, USDC(10), BONA(1_000))
        .and.to.emit(usdc, "Transfer")
        .withArgs(alice.address, treasury.address, USDC(10))
        .and.to.emit(bona, "Transfer")
        .withArgs(saleAddr, alice.address, BONA(1_000));
    });

    it("leaves nothing of the buyer's in any contract", async function () {
      await sale.connect(alice).buy(USDC(10));

      // Every unit bought is in the wallet; the sale holds only what is
      // still for sale.
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(1_000));
      expect(await bona.balanceOf(await sale.getAddress())).to.equal(TRANCHE - BONA(1_000));
    });

    it("lets the buyer move their BONA the moment the purchase confirms", async function () {
      await sale.connect(alice).buy(USDC(10));

      // No lock, no vesting, no claim step: a plain transfer works at once.
      await bona.connect(alice).transfer(bob.address, BONA(400));
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(600));
      expect(await bona.balanceOf(bob.address)).to.equal(BONA(400));
    });

    it("handles fractional dollars at the same rate", async function () {
      await sale.connect(alice).buy(USDC("2.5"));
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(250));

      // The smallest unit of USDC buys exactly its share, with no rounding
      // in either direction that a buyer could notice.
      await sale.connect(bob).buy(USDC("1.000001"));
      expect(await bona.balanceOf(bob.address)).to.equal(BONA("100.0001"));
    });

    it("refuses a purchase below the minimum", async function () {
      await expect(sale.connect(alice).buy(USDC(1) - 1n)).to.be.revertedWithCustomError(
        sale,
        "BelowMinimum"
      );
      await expect(sale.connect(alice).buy(0)).to.be.revertedWithCustomError(
        sale,
        "BelowMinimum"
      );
      await sale.connect(alice).buy(USDC(1));
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(100));
    });
  });

  describe("Nothing is taken that is not delivered", function () {
    /**
     * The failure class this design removes. If the BONA cannot be delivered —
     * none in the contract, the instalment sold out, the ceiling reached —
     * the buyer's USDC must stay in the buyer's wallet.
     */
    it("takes no money when the sale holds no BONA", async function () {
      const buyer = await usdc.balanceOf(alice.address);
      const treasuryBefore = await usdc.balanceOf(treasury.address);

      await expect(sale.connect(alice).buy(USDC(10))).to.be.revertedWithCustomError(
        sale,
        "SoldOut"
      );

      expect(await usdc.balanceOf(alice.address)).to.equal(buyer);
      expect(await usdc.balanceOf(treasury.address)).to.equal(treasuryBefore);
      expect(await sale.bonaSold()).to.equal(0);
    });

    it("takes no money for a purchase larger than what it holds", async function () {
      await arm(BONA(1_000));
      const buyer = await usdc.balanceOf(alice.address);

      await expect(sale.connect(alice).buy(USDC(11))).to.be.revertedWithCustomError(
        sale,
        "SoldOut"
      );
      expect(await usdc.balanceOf(alice.address)).to.equal(buyer);
      expect(await bona.balanceOf(alice.address)).to.equal(0);
    });

    it("takes no money once the instalment runs out mid-sale", async function () {
      await arm(BONA(1_000));

      await sale.connect(alice).buy(USDC(10)); // exactly the instalment
      expect(await sale.availableBona()).to.equal(0);
      const before = await usdc.balanceOf(bob.address);

      await expect(sale.connect(bob).buy(USDC(1))).to.be.revertedWithCustomError(
        sale,
        "SoldOut"
      );
      expect(await usdc.balanceOf(bob.address)).to.equal(before);
    });

    it("delivers nothing when the buyer's dollars do not arrive", async function () {
      await arm();

      // No approval: USDC refuses the pull, and the whole call unwinds with
      // it — no BONA leaves the sale, nothing is recorded as sold.
      await usdc.connect(mallory).approve(await sale.getAddress(), 0);
      await usdc.transfer(mallory.address, USDC(10));
      await expect(sale.connect(mallory).buy(USDC(10))).to.be.reverted;

      // Approved but broke: the same.
      await usdc.connect(mallory).approve(await sale.getAddress(), ethers.MaxUint256);
      await expect(sale.connect(mallory).buy(USDC(11))).to.be.reverted;

      expect(await bona.balanceOf(mallory.address)).to.equal(0);
      expect(await bona.balanceOf(await sale.getAddress())).to.equal(TRANCHE);
      expect(await sale.bonaSold()).to.equal(0);
      expect(await sale.usdcReceived()).to.equal(0);
    });
  });

  describe("What the sale can sell is bounded two ways", function () {
    it("stops at its own lifetime ceiling", async function () {
      const Sale = await ethers.getContractFactory("DirectSale");
      const small = await Sale.deploy(
        await bona.getAddress(),
        await usdc.getAddress(),
        treasury.address,
        PRICE,
        BONA(1_000)
      );
      await small.waitForDeployment();
      await bona.transfer(await small.getAddress(), BONA(100_000));
      await usdc.connect(alice).approve(await small.getAddress(), ethers.MaxUint256);

      await small.connect(alice).buy(USDC(10)); // 1,000 BONA — the whole ceiling
      expect(await small.remainingBona()).to.equal(0);
      expect(await small.availableBona()).to.equal(0);

      const before = await usdc.balanceOf(alice.address);
      await expect(small.connect(alice).buy(USDC(1))).to.be.revertedWithCustomError(
        small,
        "SoldOut"
      );
      expect(await usdc.balanceOf(alice.address)).to.equal(before);
    });

    it("availableBona reports the tighter of the two limits", async function () {
      // Ceiling is huge; the instalment is what binds.
      await bona.transfer(await sale.getAddress(), BONA(5_000));
      expect(await sale.availableBona()).to.equal(BONA(5_000));

      // A small ceiling binds before a large instalment does.
      const Sale = await ethers.getContractFactory("DirectSale");
      const small = await Sale.deploy(
        await bona.getAddress(),
        await usdc.getAddress(),
        treasury.address,
        PRICE,
        BONA(2_000)
      );
      await small.waitForDeployment();
      await bona.transfer(await small.getAddress(), BONA(9_000));
      expect(await small.availableBona()).to.equal(BONA(2_000));
    });

    it("the ceiling is the published sale allocation and holds across purchases", async function () {
      expect(await sale.maxBona()).to.equal(BONA(60_000_000));
      await arm(BONA(1_000));
      await sale.connect(alice).buy(USDC(4));
      expect(await sale.remainingBona()).to.equal(MAX_BONA - BONA(400));
      expect(await sale.availableBona()).to.equal(BONA(600));
    });
  });

  describe("Reclaiming unsold tokens", function () {
    beforeEach(arm);

    it("only the multisig may reclaim", async function () {
      await expect(sale.connect(mallory).reclaimUnsold()).to.be.revertedWithCustomError(
        sale,
        "NotTreasury"
      );
      await expect(sale.connect(alice).reclaimUnsold()).to.be.revertedWithCustomError(
        sale,
        "NotTreasury"
      );
    });

    /**
     * Safe to take everything precisely because a purchase moves the buyer's
     * BONA out in the same transaction: nothing held here is ever owed.
     */
    it("returns the whole balance and cannot touch a buyer's tokens", async function () {
      await sale.connect(alice).buy(USDC(10));
      const bought = BONA(1_000);

      const before = await bona.balanceOf(treasury.address);
      await expect(sale.reclaimUnsold())
        .to.emit(sale, "UnsoldReclaimed")
        .withArgs(TRANCHE - bought);

      expect(await bona.balanceOf(await sale.getAddress())).to.equal(0);
      expect(await bona.balanceOf(treasury.address)).to.equal(before + TRANCHE - bought);

      // The buyer's tokens are in the buyer's wallet, untouched.
      expect(await bona.balanceOf(alice.address)).to.equal(bought);
    });

    it("emptying the contract is how the sale is stopped, and it charges nobody", async function () {
      await sale.reclaimUnsold();
      const before = await usdc.balanceOf(alice.address);
      await expect(sale.connect(alice).buy(USDC(10))).to.be.revertedWithCustomError(
        sale,
        "SoldOut"
      );
      expect(await usdc.balanceOf(alice.address)).to.equal(before);
    });

    it("topping the contract up again is how the sale is reopened", async function () {
      await sale.reclaimUnsold();
      await bona.transfer(await sale.getAddress(), BONA(200));

      await sale.connect(alice).buy(USDC(2));
      expect(await bona.balanceOf(alice.address)).to.equal(BONA(200));
      expect(await sale.availableBona()).to.equal(0);
    });

    it("reverts when there is nothing to reclaim", async function () {
      await sale.reclaimUnsold();
      await expect(sale.reclaimUnsold()).to.be.revertedWithCustomError(
        sale,
        "NothingToReclaim"
      );
    });
  });
});
