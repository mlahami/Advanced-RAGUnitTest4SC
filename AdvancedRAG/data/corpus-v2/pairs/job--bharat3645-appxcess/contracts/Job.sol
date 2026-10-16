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
