const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const DAY = 24 * 60 * 60;

describe("Crowdfunding", function () {
  let cf, creator, alice, bob;

  beforeEach(async function () {
    [creator, alice, bob] = await ethers.getSigners();
    const F = await ethers.getContractFactory("Crowdfunding");
    cf = await F.connect(creator).deploy();
    await cf.waitForDeployment();
  });

  async function newCampaign(goalEth = "1", durSec = 7 * DAY) {
    const tx = await cf.createCampaign(
      ethers.parseEther(goalEth),
      durSec,
      "Test campaign",
      "A description"
    );
    await tx.wait();
    return await cf.campaignCount();
  }

  describe("createCampaign", function () {
    it("creates a campaign and emits an event", async function () {
      await expect(cf.createCampaign(ethers.parseEther("1"), 7 * DAY, "T", "D"))
        .to.emit(cf, "CampaignCreated")
        .withArgs(1, creator.address, ethers.parseEther("1"), anyValue, "T");
      const c = await cf.getCampaign(1);
      expect(c.creator).to.equal(creator.address);
      expect(c.goal).to.equal(ethers.parseEther("1"));
      expect(c.pledged).to.equal(0);
    });

    it("rejects a zero goal", async function () {
      await expect(
        cf.createCampaign(0, 7 * DAY, "T", "D")
      ).to.be.revertedWithCustomError(cf, "ZeroGoal");
    });

    it("rejects out-of-range durations", async function () {
      await expect(
        cf.createCampaign(ethers.parseEther("1"), 60, "T", "D")
      ).to.be.revertedWithCustomError(cf, "BadDuration");
      await expect(
        cf.createCampaign(ethers.parseEther("1"), 91 * DAY, "T", "D")
      ).to.be.revertedWithCustomError(cf, "BadDuration");
    });
  });

  describe("pledge / unpledge", function () {
    it("accepts pledges and tracks per-backer balances", async function () {
      const id = await newCampaign();
      await expect(cf.connect(alice).pledge(id, { value: ethers.parseEther("0.3") }))
        .to.emit(cf, "Pledged")
        .withArgs(id, alice.address, ethers.parseEther("0.3"), ethers.parseEther("0.3"));
      await cf.connect(bob).pledge(id, { value: ethers.parseEther("0.2") });
      const c = await cf.getCampaign(id);
      expect(c.pledged).to.equal(ethers.parseEther("0.5"));
      expect(await cf.pledgeOf(id, alice.address)).to.equal(ethers.parseEther("0.3"));
    });

    it("rejects a zero-value pledge", async function () {
      const id = await newCampaign();
      await expect(
        cf.connect(alice).pledge(id, { value: 0 })
      ).to.be.revertedWithCustomError(cf, "ZeroPledge");
    });

    it("rejects pledging to a missing campaign", async function () {
      await expect(
        cf.connect(alice).pledge(999, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(cf, "CampaignMissing");
    });

    it("lets a backer withdraw while live, then blocks over-withdraw", async function () {
      const id = await newCampaign();
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("0.5") });
      await expect(
        cf.connect(alice).unpledge(id, ethers.parseEther("0.2"))
      ).to.emit(cf, "Unpledged");
      expect(await cf.pledgeOf(id, alice.address)).to.equal(ethers.parseEther("0.3"));
      await expect(
        cf.connect(alice).unpledge(id, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(cf, "NothingPledged");
    });

    it("blocks pledging after the deadline", async function () {
      const id = await newCampaign("1", 1 * DAY);
      await time.increase(1 * DAY + 1);
      await expect(
        cf.connect(alice).pledge(id, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(cf, "CampaignEnded");
    });
  });

  describe("claim (success path)", function () {
    it("pays the creator when the goal is met and time is up", async function () {
      const id = await newCampaign("1", 2 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("0.6") });
      await cf.connect(bob).pledge(id, { value: ethers.parseEther("0.5") });
      await time.increase(2 * DAY + 1);

      await expect(cf.connect(creator).claim(id)).to.changeEtherBalance(
        creator,
        ethers.parseEther("1.1")
      );
      const c = await cf.getCampaign(id);
      expect(c.claimed).to.equal(true);
    });

    it("blocks claim before the deadline", async function () {
      const id = await newCampaign("1", 2 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1.5") });
      await expect(
        cf.connect(creator).claim(id)
      ).to.be.revertedWithCustomError(cf, "CampaignLive");
    });

    it("blocks claim if the goal was not met", async function () {
      const id = await newCampaign("1", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("0.4") });
      await time.increase(1 * DAY + 1);
      await expect(
        cf.connect(creator).claim(id)
      ).to.be.revertedWithCustomError(cf, "GoalNotMet");
    });

    it("blocks a non-creator from claiming", async function () {
      const id = await newCampaign("1", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("2") });
      await time.increase(1 * DAY + 1);
      await expect(
        cf.connect(alice).claim(id)
      ).to.be.revertedWithCustomError(cf, "NotCreator");
    });

    it("blocks a double claim", async function () {
      const id = await newCampaign("1", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1.2") });
      await time.increase(1 * DAY + 1);
      await cf.connect(creator).claim(id);
      await expect(
        cf.connect(creator).claim(id)
      ).to.be.revertedWithCustomError(cf, "AlreadyClaimed");
    });
  });

  describe("refund (failure path)", function () {
    it("lets backers pull refunds when the goal is missed", async function () {
      const id = await newCampaign("5", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1") });
      await time.increase(1 * DAY + 1);
      await expect(cf.connect(alice).refund(id)).to.changeEtherBalance(
        alice,
        ethers.parseEther("1")
      );
      expect(await cf.pledgeOf(id, alice.address)).to.equal(0);
    });

    it("blocks refund when the goal was met", async function () {
      const id = await newCampaign("1", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1.5") });
      await time.increase(1 * DAY + 1);
      await expect(
        cf.connect(alice).refund(id)
      ).to.be.revertedWithCustomError(cf, "GoalWasMet");
    });

    it("blocks a double refund", async function () {
      const id = await newCampaign("5", 1 * DAY);
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1") });
      await time.increase(1 * DAY + 1);
      await cf.connect(alice).refund(id);
      await expect(
        cf.connect(alice).refund(id)
      ).to.be.revertedWithCustomError(cf, "NothingPledged");
    });
  });

  describe("statusOf", function () {
    it("reports live / succeeded / failed", async function () {
      const id = await newCampaign("1", 1 * DAY);
      expect(await cf.statusOf(id)).to.equal(0); // live
      await cf.connect(alice).pledge(id, { value: ethers.parseEther("1") });
      await time.increase(1 * DAY + 1);
      expect(await cf.statusOf(id)).to.equal(1); // succeeded

      const id2 = await newCampaign("5", 1 * DAY);
      await cf.connect(alice).pledge(id2, { value: ethers.parseEther("1") });
      await time.increase(1 * DAY + 1);
      expect(await cf.statusOf(id2)).to.equal(2); // failed
    });
  });
});
