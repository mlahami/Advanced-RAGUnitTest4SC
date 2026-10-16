# job--bharat3645-appxcess

- domain: escrow-conditional-payments (freelance-escrow)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/bharat3645/AppXcess-GigX @ f48dfe3dedd0a759c00305a69509ab9601f70bc1
- license: MIT
- targets: Job.sol
- validation: 22 passing tests, 0 failing; statement coverage Job.sol 100.0 %

## Contract: Job.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Job — an on-chain escrowed job marketplace.
/// @notice Clients post jobs and escrow the full budget in this contract.
///         A freelancer accepts the job, and once the client is satisfied
///         they release the escrowed funds. To avoid funds getting stuck
///         forever, two safety valves exist:
///           1. `cancelJob` — the client can reclaim the budget any time
///              before a freelancer accepts.
///           2. `reclaimExpiredFunds` — if a freelancer accepts but never
///              delivers, the client can reclaim the budget once the
///              `DELIVERY_WINDOW` has elapsed since acceptance.
contract Job {
    /// @notice How long a freelancer has to deliver after accepting a job
    ///         before the client is allowed to reclaim the escrowed funds.
    uint256 public constant DELIVERY_WINDOW = 30 days;

    struct JobDetail {
        address client;
        string description;
        uint256 budget;
        bool isOpen;
        address freelancer;
        bool fundsReleased;
        uint256 acceptedAt;
        bool isCancelled;
    }

    mapping(uint256 => JobDetail) public jobs;
    uint256 public jobCounter;

    event JobPosted(uint256 jobId, address indexed client, string description, uint256 budget);
    event JobAccepted(uint256 jobId, address indexed freelancer);
    event FundsReleased(uint256 jobId, address indexed freelancer, uint256 amount);
    event JobCancelled(uint256 jobId, address indexed client, uint256 amount);
    event JobRefunded(uint256 jobId, address indexed client, uint256 amount);

    /// @notice Post a new job and escrow the budget in this contract.
    /// @dev The caller must send exactly `_budget` wei so funds are held on-chain
    ///      until the client releases them to the accepted freelancer.
    function postJob(string calldata _description, uint256 _budget) external payable {
        require(_budget > 0, "Budget must be greater than zero.");
        require(msg.value == _budget, "Sent value must match budget.");

        jobCounter++;
        jobs[jobCounter] = JobDetail(
            msg.sender,
            _description,
            _budget,
            true,
            address(0),
            false,
            0,
            false
        );
        emit JobPosted(jobCounter, msg.sender, _description, _budget);
    }

    function acceptJob(uint256 _jobId) external {
        JobDetail storage job = jobs[_jobId];
        require(job.client != address(0), "Job does not exist.");
        require(job.isOpen, "Job already taken.");
        require(msg.sender != job.client, "Client cannot accept their own job.");

        job.freelancer = msg.sender;
        job.isOpen = false;
        job.acceptedAt = block.timestamp;
        emit JobAccepted(_jobId, msg.sender);
    }

    /// @notice Release the escrowed budget to the freelancer once work is accepted.
    /// @dev Only the client who posted the job can release funds, and only once.
    function releaseFunds(uint256 _jobId) external {
        JobDetail storage job = jobs[_jobId];
        require(job.client != address(0), "Job does not exist.");
        require(msg.sender == job.client, "Only the client can release funds.");
        require(!job.isOpen, "Job has not been accepted yet.");
        require(job.freelancer != address(0), "No freelancer assigned.");
        require(!job.fundsReleased, "Funds already released.");
        require(!job.isCancelled, "Job was cancelled.");

        job.fundsReleased = true;
        uint256 amount = job.budget;
        (bool success, ) = payable(job.freelancer).call{value: amount}("");
        require(success, "Transfer to freelancer failed.");

        emit FundsReleased(_jobId, job.freelancer, amount);
    }

    /// @notice Cancel a job that no freelancer has accepted yet and reclaim the escrow.
    /// @dev Only usable while the job is still open, so an accepted freelancer's
    ///      work can never be pulled out from under them via cancellation.
    function cancelJob(uint256 _jobId) external {
        JobDetail storage job = jobs[_jobId];
        require(job.client != address(0), "Job does not exist.");
        require(msg.sender == job.client, "Only the client can cancel this job.");
        require(!job.isCancelled, "Job already cancelled.");
        require(job.isOpen, "Job already accepted; use reclaimExpiredFunds instead.");

        job.isOpen = false;
        job.isCancelled = true;
        uint256 amount = job.budget;
        (bool success, ) = payable(job.client).call{value: amount}("");
        require(success, "Refund to client failed.");

        emit JobCancelled(_jobId, job.client, amount);
    }

    /// @notice Reclaim escrowed funds if an accepted freelancer never delivers.
    /// @dev Guards against funds being locked forever: once `DELIVERY_WINDOW`
    ///      has passed since acceptance with no release, the client can pull
    ///      the escrow back. Reuses `fundsReleased` as the terminal flag so
    ///      this and `releaseFunds` can never both succeed for the same job.
    function reclaimExpiredFunds(uint256 _jobId) external {
        JobDetail storage job = jobs[_jobId];
        require(job.client != address(0), "Job does not exist.");
        require(msg.sender == job.client, "Only the client can reclaim funds.");
        require(!job.isOpen, "Job has not been accepted yet.");
        require(job.freelancer != address(0), "No freelancer assigned.");
        require(!job.fundsReleased, "Funds already released.");
        require(!job.isCancelled, "Job was cancelled.");
        require(
            block.timestamp >= job.acceptedAt + DELIVERY_WINDOW,
            "Delivery window has not expired yet."
        );

        job.fundsReleased = true;
        uint256 amount = job.budget;
        (bool success, ) = payable(job.client).call{value: amount}("");
        require(success, "Refund to client failed.");

        emit JobRefunded(_jobId, job.client, amount);
    }
}
```

## Tests: Job.js

```javascript
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
```
