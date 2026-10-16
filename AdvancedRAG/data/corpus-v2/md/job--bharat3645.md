# job--bharat3645

- domain: escrow-conditional-payments (freelance-bounty)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/bharat3645/GigX @ b801e356ec9d7bb65119a2bc3ceb3b015190ab00
- license: MIT
- targets: Job.sol
- validation: 6 passing tests, 0 failing; statement coverage Job.sol 100.0 %

## Contract: Job.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Job {
    struct JobDetail {
        address client;
        string description;
        uint256 budget;
        bool isOpen;
        address freelancer;
    }

    mapping(uint256 => JobDetail) public jobs;
    uint256 public jobCounter;

    event JobPosted(uint256 jobId, address indexed client, string description, uint256 budget);
    event JobAccepted(uint256 jobId, address indexed freelancer);

    function postJob(string calldata _description, uint256 _budget) external {
        jobCounter++;
        jobs[jobCounter] = JobDetail(msg.sender, _description, _budget, true, address(0));
        emit JobPosted(jobCounter, msg.sender, _description, _budget);
    }

    function acceptJob(uint256 _jobId) external {
        JobDetail storage job = jobs[_jobId];
        require(job.isOpen, "Job already taken.");
        job.freelancer = msg.sender;
        job.isOpen = false;
        emit JobAccepted(_jobId, msg.sender);
    }
}
```

## Tests: Job.test.js

```javascript
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
```
