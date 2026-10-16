// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// ==========================================================================
// Voting.sol — Bhārat Secure Vote
//
// A simple decentralized voting contract for a college mock-election demo.
// One wallet address = one vote, the admin (Election Officer) registers
// voters ahead of time, and results are only visible after the election
// is officially ended by the admin.
//
// PRIVACY NOTE: I am NOT using zk-proofs or ring signatures here. Votes
// are pseudonymous — they are tied to a wallet address, not to a real
// person's identity. A real election would need real identity checks
// (Aadhaar / e-KYC style) on top of this. That is out of scope for this
// project, and I have written this limitation in the README too.
// ==========================================================================

contract Voting {
    // ------------------------------------------------------------------
    // State variables
    // ------------------------------------------------------------------

    // The Election Officer — the only address allowed to register voters,
    // add candidates, and start/end the election. Set in the constructor.
    address public admin;

    // Candidate struct. I store candidates in an array so the frontend
    // can simply loop over them in order. The `id` is just the array
    // index, but I keep it in the struct anyway so the frontend never
    // has to guess it. Each candidate also has a representative wallet
    // address, so the Election Officer can look up their details later.
    struct Candidate {
        uint256 id;
        string name;
        string partySymbol;
        address candidateAddress;
        uint256 voteCount;
    }

    Candidate[] public candidates;

    // Quick duplicate check when adding candidates — two different
    // people cannot share one wallet address on the ballot. Kept
    // private because nobody outside needs to read it directly.
    mapping(address => bool) private usedCandidateAddresses;

    // Mappings give O(1) lookups — that is why I use them here instead
    // of searching through arrays.
    mapping(address => bool) public isRegistered;
    mapping(address => bool) public hasVoted;

    // ------------------------------------------------------------------
    // Commit-reveal privacy state
    // ------------------------------------------------------------------
    // Instead of storing the candidateId directly, the voter sends a
    // salted hash of it (a "commitment"). The actual choice stays hidden
    // on-chain until counting starts, when the voter reveals their
    // (candidateId, salt) pair and the contract verifies the hash.
    //
    // This is the commit-and-reveal pattern, which is taught in intro
    // blockchain courses. The salt is a random 32-byte value generated
    // by the voter's frontend, so no one can brute-force the hash and
    // read the choice before counting.
    mapping(address => bytes32) public commitments;
    mapping(address => bool) public hasRevealed;

    // Election window set by the admin. Voting only works while
    // block.timestamp is inside [start, end].
    uint256 public electionStartTime;
    uint256 public electionEndTime;

    // Admin can end the election early with endElection(). Results stay
    // locked until then.
    bool public electionEnded;

    // Total votes cast so far — handy for the results page.
    uint256 public totalVotes;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    // Privacy choice: I only log WHICH address voted, not who they voted
    // for. So there is no on-chain event trail per candidate — even the
    // admin cannot see the full history from events alone.
    event VoteCast(address indexed voter);

    // Emitted when a voter reveals their choice during counting. This
    // one DOES include the candidate — revealing is public by design,
    // since results are meant to be public after the election.
    event VoteRevealed(address indexed voter, uint256 candidateId);

    event CandidateAdded(
        uint256 indexed id,
        string name,
        string partySymbol,
        address candidateAddress
    );
    event VoterRegistered(address indexed voter);
    event ElectionStarted(uint256 startTime, uint256 endTime);
    event ElectionEnded(uint256 totalVotes);

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only the Election Officer can do this");
        _;
    }

    // Checks the election window using block.timestamp.
    modifier votingOpen() {
        require(
            block.timestamp >= electionStartTime,
            "Election has not started yet"
        );
        require(
            block.timestamp <= electionEndTime,
            "Election has ended"
        );
        _;
    }

    // Counting only starts once the admin ends the election (or when the
    // window passes naturally). Until then, reveal() refuses to work.
    modifier countingOpen() {
        require(
            electionEnded || block.timestamp > electionEndTime,
            "Votes are not being counted yet"
        );
        _;
    }

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    // The deployer becomes the admin. I pass the election window here so
    // the whole election can be planned before deployment.
    constructor(uint256 startTime, uint256 endTime) {
        require(endTime > startTime, "End time must be after start time");
        admin = msg.sender;
        electionStartTime = startTime;
        electionEndTime = endTime;
        emit ElectionStarted(startTime, endTime);
    }

    // ------------------------------------------------------------------
    // Admin functions
    // ------------------------------------------------------------------

    // Add a candidate to the ballot. `partySymbol` holds a symbol or
    // emoji (the frontend shows it as the party logo), and
    // `candidateAddress` is the candidate's representative wallet —
    // stored so the admin can look them up by address later.
    function addCandidate(
        string memory name,
        string memory partySymbol,
        address candidateAddress
    ) public onlyAdmin {
        require(candidateAddress != address(0), "Invalid candidate address");
        require(!usedCandidateAddresses[candidateAddress], "This address is already a candidate");
        usedCandidateAddresses[candidateAddress] = true;

        candidates.push(Candidate(candidates.length, name, partySymbol, candidateAddress, 0));
        emit CandidateAdded(candidates.length - 1, name, partySymbol, candidateAddress);
    }

    // Look up a candidate's details by their wallet address. Admin-only,
    // because before the results are declared there is no reason for
    // anyone else to dig into candidate records this way.
    function getCandidateByAddress(address candidateAddress)
        public
        view
        onlyAdmin
        returns (Candidate memory)
    {
        // Small list, so a simple loop is fine and easy to understand.
        for (uint256 i = 0; i < candidates.length; i++) {
            if (candidates[i].candidateAddress == candidateAddress) {
                return candidates[i];
            }
        }
        revert("No candidate found with this address");
    }

    // Register a voter wallet ahead of time. In a real system this step
    // would involve actual identity verification (Aadhaar, etc.), but
    // that is out of scope for this project — we just trust the admin
    // adds the right addresses.
    function registerVoter(address voter) public onlyAdmin {
        require(voter != address(0), "Invalid address");
        require(!isRegistered[voter], "Already registered");
        isRegistered[voter] = true;
        emit VoterRegistered(voter);
    }

    // Lets the admin move the election window (for example, to extend
    // polling hours on demo day).
    function setElectionWindow(uint256 startTime, uint256 endTime) public onlyAdmin {
        require(endTime > startTime, "End time must be after start time");
        electionStartTime = startTime;
        electionEndTime = endTime;
        emit ElectionStarted(startTime, endTime);
    }

    // End the election early. Results stay locked until this is called.
    function endElection() public onlyAdmin {
        require(!electionEnded, "Election already ended");
        electionEnded = true;
        emit ElectionEnded(totalVotes);
    }

    // ------------------------------------------------------------------
    // Public functions
    // ------------------------------------------------------------------

    // Commit phase: cast a vote for a candidate WITHOUT storing which
    // one. The voter includes a random salt, and we only store
    // keccak256(candidateId, salt). Every check happens HERE in the
    // contract — never trust the frontend to enforce rules.
    function vote(uint256 candidateId, bytes32 salt) public votingOpen {
        // Only voters who were registered by the admin can vote.
        require(isRegistered[msg.sender], "You are not a registered voter");
        // One wallet address = one vote.
        require(!hasVoted[msg.sender], "You have already voted");
        // Once the admin calls endElection, no more votes.
        require(!electionEnded, "Election has been ended by the admin");
        // candidateId comes from the user, so always check the bounds.
        require(candidateId < candidates.length, "Invalid candidate id");
        // An empty salt would make the hash trivially guessable — the
        // whole point is that the salt is random and kept secret.
        require(salt != bytes32(0), "Salt cannot be empty");

        // Store the commitment only. The candidate id is neither stored
        // nor emitted, so the choice is hidden on-chain until counting.
        commitments[msg.sender] = keccak256(abi.encodePacked(candidateId, salt));
        hasVoted[msg.sender] = true;

        // Reentrancy note: vote() makes no external calls and all state
        // changes happen before the event (checks-effects-interactions
        // pattern), so there is no reentrancy surface here. I am aware
        // of the attack, just no guard library needed for this contract.
        emit VoteCast(msg.sender);
    }

    // Reveal phase: after counting opens, the voter proves which
    // candidate they chose by sending (candidateId, salt). The contract
    // re-hashes the pair and only counts the vote if it matches the
    // stored commitment — so votes can't be tampered with during the
    // hidden period.
    function reveal(uint256 candidateId, bytes32 salt) public countingOpen {
        require(hasVoted[msg.sender], "You have not voted yet");
        require(!hasRevealed[msg.sender], "You have already revealed your vote");
        require(
            keccak256(abi.encodePacked(candidateId, salt)) == commitments[msg.sender],
            "Hash does not match your committed vote"
        );

        hasRevealed[msg.sender] = true;
        candidates[candidateId].voteCount += 1;
        totalVotes += 1;

        // The choice is public now — that is the whole point of counting.
        emit VoteRevealed(msg.sender, candidateId);
    }

    // ------------------------------------------------------------------
    // View functions
    // ------------------------------------------------------------------

    function candidateCount() public view returns (uint256) {
        return candidates.length;
    }

    // Results are locked until the admin declares the election over.
    function getResults() public view returns (Candidate[] memory) {
        require(electionEnded, "Results are not out yet - election still in progress");
        return candidates;
    }
}