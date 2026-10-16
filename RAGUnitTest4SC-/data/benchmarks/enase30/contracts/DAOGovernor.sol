// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

//DAO Governor â€” proposal creation, on-chain voting, execution with timelock
contract DAOGovernor {
    IERC20Vote public token;
    uint256 public votingPeriod;   // seconds
    uint256 public timelockDelay;  // seconds after vote ends

    enum ProposalState { Pending, Active, Succeeded, Defeated, Queued, Executed }

    struct Proposal {
        address proposer;
        address target;
        bytes callData;
        string description;
        uint256 startTime;
        uint256 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        bool queued;
        uint256 eta; // earliest execution time
    }

    Proposal[] public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(uint256 indexed id, address proposer, string description);
    event VoteCast(address indexed voter, uint256 indexed proposalId, bool support, uint256 weight);
    event ProposalQueued(uint256 indexed id, uint256 eta);
    event ProposalExecuted(uint256 indexed id);

    constructor(address _token, uint256 _votingPeriod, uint256 _timelockDelay) {
        token = IERC20Vote(_token);
        votingPeriod = _votingPeriod;
        timelockDelay = _timelockDelay;
    }

    function propose(address _target, bytes calldata _callData, string calldata _description)
        external returns (uint256 id)
    {
        id = proposals.length;
        proposals.push(Proposal({
            proposer: msg.sender,
            target: _target,
            callData: _callData,
            description: _description,
            startTime: block.timestamp,
            endTime: block.timestamp + votingPeriod,
            forVotes: 0,
            againstVotes: 0,
            executed: false,
            queued: false,
            eta: 0
        }));
        emit ProposalCreated(id, msg.sender, _description);
    }

    function castVote(uint256 _id, bool _support) external {
        Proposal storage p = proposals[_id];
        require(block.timestamp >= p.startTime && block.timestamp <= p.endTime, "Not active");
        require(!hasVoted[_id][msg.sender], "Already voted");
        uint256 weight = token.balanceOf(msg.sender);
        require(weight > 0, "No voting power");
        hasVoted[_id][msg.sender] = true;
        if (_support) p.forVotes += weight;
        else p.againstVotes += weight;
        emit VoteCast(msg.sender, _id, _support, weight);
    }

    function queue(uint256 _id) external {
        Proposal storage p = proposals[_id];
        require(block.timestamp > p.endTime, "Still active");
        require(p.forVotes > p.againstVotes, "Proposal defeated");
        require(!p.queued, "Already queued");
        p.queued = true;
        p.eta = block.timestamp + timelockDelay;
        emit ProposalQueued(_id, p.eta);
    }

    function execute(uint256 _id) external {
        Proposal storage p = proposals[_id];
        require(p.queued && !p.executed, "Not queued or already executed");
        require(block.timestamp >= p.eta, "Timelock not expired");
        p.executed = true;
        (bool ok, ) = p.target.call(p.callData);
        require(ok, "Execution failed");
        emit ProposalExecuted(_id);
    }
}

interface IERC20Vote {
    function balanceOf(address account) external view returns (uint256);
}
