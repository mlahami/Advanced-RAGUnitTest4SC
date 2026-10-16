const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Job", function () {
  async function deployJobFixture() {
    const [client, freelancer, other] = await ethers.getSigners();
    const Job = await ethers.getContractFactory("Job");
    const job = await Job.deploy();
    const budget = ethers.parseEther("1");
    return { job, client, freelancer, other, budget };
  }

  it("posts a job and escrows the budget", async function () {
    const { job, client, budget } = await loadFixture(deployJobFixture);

    await expect(
      job.connect(client).postJob("Build a landing page", budget, { value: budget })
    )
      .to.emit(job, "JobPosted")
      .withArgs(1n, client.address, "Build a landing page", budget);

    expect(await ethers.provider.getBalance(await job.getAddress())).to.equal(budget);

    const posted = await job.jobs(1);
    expect(posted.client).to.equal(client.address);
    expect(posted.isOpen).to.equal(true);
  });

  it("reverts if the sent value does not match the budget", async function () {
    const { job, client, budget } = await loadFixture(deployJobFixture);

    await expect(
      job.connect(client).postJob("Underfunded job", budget, { value: budget / 2n })
    ).to.be.revertedWith("Sent value must match budget.");
  });

  it("allows a freelancer to accept an open job", async function () {
    const { job, client, freelancer, budget } = await loadFixture(deployJobFixture);
    await job.connect(client).postJob("Design a logo", budget, { value: budget });

    await expect(job.connect(freelancer).acceptJob(1))
      .to.emit(job, "JobAccepted")
      .withArgs(1n, freelancer.address);

    const accepted = await job.jobs(1);
    expect(accepted.freelancer).to.equal(freelancer.address);
    expect(accepted.isOpen).to.equal(false);
  });

  it("prevents the client from accepting their own job", async function () {
    const { job, client, budget } = await loadFixture(deployJobFixture);
    await job.connect(client).postJob("Write docs", budget, { value: budget });

    await expect(job.connect(client).acceptJob(1)).to.be.revertedWith(
      "Client cannot accept their own job."
    );
  });

  it("prevents accepting an already-taken job", async function () {
    const { job, client, freelancer, other, budget } = await loadFixture(deployJobFixture);
    await job.connect(client).postJob("Audit contract", budget, { value: budget });
    await job.connect(freelancer).acceptJob(1);

    await expect(job.connect(other).acceptJob(1)).to.be.revertedWith(
      "Job already taken."
    );
  });

  it("releases escrowed funds to the freelancer once accepted", async function () {
    const { job, client, freelancer, budget } = await loadFixture(deployJobFixture);
    await job.connect(client).postJob("Ship feature", budget, { value: budget });
    await job.connect(freelancer).acceptJob(1);

    await expect(job.connect(client).releaseFunds(1)).to.changeEtherBalances(
      [job, freelancer],
      [-budget, budget]
    );

    const finished = await job.jobs(1);
    expect(finished.fundsReleased).to.equal(true);
  });

  it("emits FundsReleased when funds are released", async function () {
    const { job, client, freelancer, budget } = await loadFixture(deployJobFixture);
    await job.connect(client).postJob("Ship feature", budget, { value: budget });
    await job.connect(freelancer).acceptJob(1);

    await expect(job.connect(client).releaseFunds(1))
      .to.emit(job, "FundsReleased")
      .withArgs(1n, freelancer.address, budget);
  });

  it("only allows the client to release funds", async function () {
    const { job, client, freelancer, budget } = await loadFixture(deployJobFixture);
    await job.connect(client).postJob("Ship feature", budget, { value: budget });
    await job.connect(freelancer).acceptJob(1);

    await expect(job.connect(freelancer).releaseFunds(1)).to.be.revertedWith(
      "Only the client can release funds."
    );
  });

  it("prevents releasing funds before the job is accepted", async function () {
    const { job, client, budget } = await loadFixture(deployJobFixture);
    await job.connect(client).postJob("Ship feature", budget, { value: budget });

    await expect(job.connect(client).releaseFunds(1)).to.be.revertedWith(
      "Job has not been accepted yet."
    );
  });

  it("prevents releasing funds twice", async function () {
    const { job, client, freelancer, budget } = await loadFixture(deployJobFixture);
    await job.connect(client).postJob("Ship feature", budget, { value: budget });
    await job.connect(freelancer).acceptJob(1);
    await job.connect(client).releaseFunds(1);

    await expect(job.connect(client).releaseFunds(1)).to.be.revertedWith(
      "Funds already released."
    );
  });

  describe("cancelJob", function () {
    it("lets the client cancel an unaccepted job and refunds the full budget", async function () {
      const { job, client, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Never accepted", budget, { value: budget });

      await expect(job.connect(client).cancelJob(1)).to.changeEtherBalances(
        [job, client],
        [-budget, budget]
      );

      const cancelled = await job.jobs(1);
      expect(cancelled.isOpen).to.equal(false);
      expect(cancelled.isCancelled).to.equal(true);
    });

    it("emits JobCancelled with the refunded amount", async function () {
      const { job, client, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Never accepted", budget, { value: budget });

      await expect(job.connect(client).cancelJob(1))
        .to.emit(job, "JobCancelled")
        .withArgs(1n, client.address, budget);
    });

    it("prevents anyone but the client from cancelling", async function () {
      const { job, client, other, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Never accepted", budget, { value: budget });

      await expect(job.connect(other).cancelJob(1)).to.be.revertedWith(
        "Only the client can cancel this job."
      );
    });

    it("prevents cancelling a job that has already been accepted", async function () {
      const { job, client, freelancer, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Taken job", budget, { value: budget });
      await job.connect(freelancer).acceptJob(1);

      await expect(job.connect(client).cancelJob(1)).to.be.revertedWith(
        "Job already accepted; use reclaimExpiredFunds instead."
      );
    });

    it("prevents cancelling the same job twice", async function () {
      const { job, client, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Never accepted", budget, { value: budget });
      await job.connect(client).cancelJob(1);

      await expect(job.connect(client).cancelJob(1)).to.be.revertedWith(
        "Job already cancelled."
      );
    });

    it("blocks accepting a cancelled job", async function () {
      const { job, client, freelancer, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Never accepted", budget, { value: budget });
      await job.connect(client).cancelJob(1);

      await expect(job.connect(freelancer).acceptJob(1)).to.be.revertedWith(
        "Job already taken."
      );
    });
  });

  describe("reclaimExpiredFunds", function () {
    it("prevents reclaiming before the delivery window has elapsed", async function () {
      const { job, client, freelancer, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Ghosted job", budget, { value: budget });
      await job.connect(freelancer).acceptJob(1);

      await expect(job.connect(client).reclaimExpiredFunds(1)).to.be.revertedWith(
        "Delivery window has not expired yet."
      );
    });

    it("lets the client reclaim funds once the delivery window has expired", async function () {
      const { job, client, freelancer, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Ghosted job", budget, { value: budget });
      await job.connect(freelancer).acceptJob(1);

      const deliveryWindow = await job.DELIVERY_WINDOW();
      await time.increase(deliveryWindow + 1n);

      await expect(job.connect(client).reclaimExpiredFunds(1)).to.changeEtherBalances(
        [job, client],
        [-budget, budget]
      );

      const refunded = await job.jobs(1);
      expect(refunded.fundsReleased).to.equal(true);
    });

    it("emits JobRefunded once the delivery window has expired", async function () {
      const { job, client, freelancer, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Ghosted job", budget, { value: budget });
      await job.connect(freelancer).acceptJob(1);

      const deliveryWindow = await job.DELIVERY_WINDOW();
      await time.increase(deliveryWindow + 1n);

      await expect(job.connect(client).reclaimExpiredFunds(1))
        .to.emit(job, "JobRefunded")
        .withArgs(1n, client.address, budget);
    });

    it("prevents anyone but the client from reclaiming expired funds", async function () {
      const { job, client, freelancer, other, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Ghosted job", budget, { value: budget });
      await job.connect(freelancer).acceptJob(1);

      const deliveryWindow = await job.DELIVERY_WINDOW();
      await time.increase(deliveryWindow + 1n);

      await expect(job.connect(other).reclaimExpiredFunds(1)).to.be.revertedWith(
        "Only the client can reclaim funds."
      );
    });

    it("prevents reclaiming funds that were already released", async function () {
      const { job, client, freelancer, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Delivered job", budget, { value: budget });
      await job.connect(freelancer).acceptJob(1);
      await job.connect(client).releaseFunds(1);

      const deliveryWindow = await job.DELIVERY_WINDOW();
      await time.increase(deliveryWindow + 1n);

      await expect(job.connect(client).reclaimExpiredFunds(1)).to.be.revertedWith(
        "Funds already released."
      );
    });

    it("prevents reclaiming funds for a job that was never accepted", async function () {
      const { job, client, budget } = await loadFixture(deployJobFixture);
      await job.connect(client).postJob("Unaccepted job", budget, { value: budget });

      await expect(job.connect(client).reclaimExpiredFunds(1)).to.be.revertedWith(
        "Job has not been accepted yet."
      );
    });
  });
});
