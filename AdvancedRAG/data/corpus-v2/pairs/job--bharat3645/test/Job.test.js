const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

describe("Job", function () {
  async function deployJobFixture() {
    const [client, freelancer, other] = await ethers.getSigners();
    const Job = await ethers.getContractFactory("Job");
    const job = await Job.deploy();
    return { job, client, freelancer, other };
  }

  async function postedJobFixture() {
    const base = await deployJobFixture();
    const description = "Build a landing page";
    const budget = ethers.parseEther("1");
    await base.job.connect(base.client).postJob(description, budget);
    return { ...base, description, budget, jobId: 1n };
  }

  describe("postJob", function () {
    it("stores the job and starts jobCounter at 1", async function () {
      const { job, client } = await loadFixture(deployJobFixture);
      const description = "Design a logo";
      const budget = ethers.parseEther("0.5");

      await job.connect(client).postJob(description, budget);

      expect(await job.jobCounter()).to.equal(1n);

      const stored = await job.jobs(1n);
      expect(stored.client).to.equal(client.address);
      expect(stored.description).to.equal(description);
      expect(stored.budget).to.equal(budget);
      expect(stored.isOpen).to.equal(true);
      expect(stored.freelancer).to.equal(ethers.ZeroAddress);
    });

    it("emits JobPosted with the right args", async function () {
      const { job, client } = await loadFixture(deployJobFixture);
      const description = "Write docs";
      const budget = ethers.parseEther("0.2");

      await expect(job.connect(client).postJob(description, budget))
        .to.emit(job, "JobPosted")
        .withArgs(1n, client.address, description, budget);
    });

    it("increments jobCounter across multiple posts", async function () {
      const { job, client } = await loadFixture(deployJobFixture);

      await job.connect(client).postJob("Job one", ethers.parseEther("1"));
      await job.connect(client).postJob("Job two", ethers.parseEther("2"));

      expect(await job.jobCounter()).to.equal(2n);
      expect((await job.jobs(2n)).description).to.equal("Job two");
    });
  });

  describe("acceptJob", function () {
    it("assigns the freelancer, closes the job, and emits JobAccepted", async function () {
      const { job, freelancer, jobId } = await loadFixture(postedJobFixture);

      await expect(job.connect(freelancer).acceptJob(jobId))
        .to.emit(job, "JobAccepted")
        .withArgs(jobId, freelancer.address);

      const stored = await job.jobs(jobId);
      expect(stored.freelancer).to.equal(freelancer.address);
      expect(stored.isOpen).to.equal(false);
    });

    it("reverts if the job is already taken", async function () {
      const { job, freelancer, other, jobId } = await loadFixture(postedJobFixture);

      await job.connect(freelancer).acceptJob(jobId);

      await expect(job.connect(other).acceptJob(jobId)).to.be.revertedWith(
        "Job already taken."
      );
    });

    it("reverts for a job id that was never posted", async function () {
      const { job, freelancer } = await loadFixture(deployJobFixture);

      await expect(job.connect(freelancer).acceptJob(999n)).to.be.revertedWith(
        "Job already taken."
      );
    });
  });
});
