# advanced-voting--shree2160

- domain: voting-governance (voting)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/shree2160/Blockchain-Voting-System @ a98b411bf299d0780c7daf03307771801ffc6410
- license: MIT
- targets: AdvancedVoting.sol
- validation: 19 passing tests, 0 failing; statement coverage AdvancedVoting.sol 87.84 %

## Contract: AdvancedVoting.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title AdvancedVoting — CryptoVote Campus V2.0
 * @author CryptoVote Team
 * @notice Implements Off-Chain Identity Privacy + Anti-Coercion Override Protocol
 *         + Gasless Meta-Transactions via EIP-712 Typed Structured Data
 *
 * PRIVACY MODEL:
 *   • Real student identities NEVER enter the chain.
 *   • Admin whitelists anonymous wallet addresses generated fresh by each student.
 *   • No mapping from wallet → student name exists anywhere on-chain.
 *
 * ANTI-COERCION MODEL:
 *   • A whitelisted wallet may call vote() multiple times before electionDeadline.
 *   • Each call atomically reverses the previous vote and applies the new one.
 *   • After electionDeadline the contract is frozen; no further state changes occur.
 *
 * GASLESS MODEL (EIP-712):
 *   • Students sign a typed ballot off-chain (free — no ETH needed).
 *   • A trusted Relayer submits the signature and pays gas on behalf of the student.
 *   • The contract recovers the student's address via ecrecover and counts the vote.
 *   • Nonces prevent replay attacks.
 */
contract AdvancedVoting {
    // ─────────────────────────────────────────────────────────── Types ──────
    struct Candidate {
        string name;        // Candidate display name
        string imageUri;    // Off-chain image URI (IPFS / HTTPS)
        string pitch;       // One-line election pitch
        uint256 voteCount;  // Running tally (gas-efficient: read via getter)
        bool    isActive;   // Flag to toggle candidacy
    }

    struct VoteRecord {
        uint256 candidateId; // Which candidate this wallet voted for
        bool    hasVoted;    // Guard flag for override path
        uint256 votedAt;     // Timestamp of most-recent vote (audit trail)
    }

    // ─────────────────────────────────────────────────────── State vars ──────
    address public admin;
    uint256 public electionDeadline;
    bool    public electionFinalized; // set by admin after tallying
    address public campusAuthority;   // public key representing college registrar
    uint256 public electionId;        // counter for sequential elections

    // FR-01  Privacy mapping — anonymous wallets only, never real names
    mapping(address => bool)       public validAnonymousWallets;

    // FR-02  Anti-coercion — stores the current ballot per wallet per electionId
    mapping(uint256 => mapping(address => VoteRecord)) public voterRecords;

    Candidate[] public candidates;

    // ── EIP-712 Gasless Meta-Transaction State ──────────────────────────────
    // Replay protection: each voter has a nonce that increments after every gasless vote
    mapping(address => uint256) public metaTxNonces;

    // EIP-712 Domain Separator (computed once at deploy, cached for gas savings)
    bytes32 public DOMAIN_SEPARATOR;

    // EIP-712 type hash for the Vote struct: Vote(address voter,uint256 candidateId,uint256 nonce)
    bytes32 public constant VOTE_TYPEHASH = keccak256("Vote(address voter,uint256 candidateId,uint256 nonce)");

    // ─────────────────────────────────────────────────────────── Events ──────
    event WalletWhitelisted(address indexed wallet, uint256 timestamp);
    event VoteCast(address indexed voter, uint256 indexed candidateId, bool wasOverride, uint256 timestamp);
    event GaslessVoteCast(address indexed voter, uint256 indexed candidateId, address indexed relayer, bool wasOverride, uint256 timestamp);
    event CandidateAdded(uint256 indexed id, string name);
    event ElectionFinalized(uint256 timestamp, uint256[] finalTallies);
    event CandidateRemoved(uint256 indexed id);
    event ElectionDeadlineUpdated(uint256 newDeadline);
    event ElectionReset(uint256 indexed electionId, uint256 newDeadline);

    // ──────────────────────────────────────────────────────── Modifiers ──────
    modifier onlyAdmin() {
        require(msg.sender == admin, "AV: caller is not admin");
        _;
    }

    modifier electionActive() {
        require(block.timestamp < electionDeadline, "AV: election period has ended");
        require(!electionFinalized,                 "AV: election already finalized");
        _;
    }

    modifier electionEnded() {
        require(block.timestamp >= electionDeadline || electionFinalized, "AV: election still active");
        _;
    }

    // ─────────────────────────────────────────────────────── Constructor ──────
    /**
     * @param _durationInMinutes  How long the election window is open (from deploy).
     * @param _campusAuthority    The public key representing the off-chain registration server.
     */
    constructor(uint256 _durationInMinutes, address _campusAuthority) {
        require(_durationInMinutes > 0, "AV: duration must be > 0");
        require(_campusAuthority != address(0), "AV: authority address invalid");
        admin            = msg.sender;
        electionDeadline = block.timestamp + (_durationInMinutes * 1 minutes);
        campusAuthority  = _campusAuthority;

        // EIP-712 Domain Separator — unique to this contract deployment
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("CryptoVote Campus"),
            keccak256("2"),
            block.chainid,
            address(this)
        ));
    }

    // ─────────────────────────────────────────────── Candidate Management ──────
    /**
     * @notice Admin adds a candidate before the election starts.
     * @param _name     Candidate name
     * @param _imageUri IPFS/HTTPS URI for candidate photo
     * @param _pitch    Single-sentence election pitch
     */
    function addCandidate(
        string calldata _name,
        string calldata _imageUri,
        string calldata _pitch
    ) external onlyAdmin {
        require(bytes(_name).length > 0, "AV: name cannot be empty");
        uint256 id = candidates.length;
        candidates.push(Candidate({
            name:      _name,
            imageUri:  _imageUri,
            pitch:     _pitch,
            voteCount: 0,
            isActive:  true
        }));
        emit CandidateAdded(id, _name);
    }

    // ─────────────────────────────────────────────── Voter Whitelisting ──────
    /**
     * @notice Cryptographic Voter Self-Registration (ECDSA)
     * @param _signature Signature generated off-chain by the college registrar.
     */
    function registerVoter(bytes calldata _signature) external electionActive {
        require(!validAnonymousWallets[msg.sender], "AV: already whitelisted");
        
        // Hash the voter's address
        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        // Recover signer using ecrecover
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);
        address signer = ecrecover(ethSignedMessageHash, v, r, s);
        
        require(signer == campusAuthority, "AV: invalid campus authorization");
        
        validAnonymousWallets[msg.sender] = true;
        emit WalletWhitelisted(msg.sender, block.timestamp);
    }

    /**
     * @notice Relayed Cryptographic Voter Self-Registration (ECDSA)
     * @dev Allows the Gasless Relayer to pay the gas fee to register a student wallet.
     * @param _voter The voter address being registered.
     * @param _signature Signature generated off-chain by the college registrar for this specific voter.
     */
    function registerVoterFor(address _voter, bytes calldata _signature) external electionActive {
        require(!validAnonymousWallets[_voter], "AV: already whitelisted");
        
        // Hash the voter's address
        bytes32 messageHash = keccak256(abi.encodePacked(_voter));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        // Recover signer using ecrecover
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);
        address signer = ecrecover(ethSignedMessageHash, v, r, s);
        
        require(signer == campusAuthority, "AV: invalid campus authorization");
        
        validAnonymousWallets[_voter] = true;
        emit WalletWhitelisted(_voter, block.timestamp);
    }

    function splitSignature(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "AV: invalid signature length");
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }

    /**
     * @notice FR-01  Whitelist a single anonymous wallet.
     * @param _wallet The brand-new, empty wallet address provided by the student.
     */
    function whitelistAnonymousWallet(address _wallet) public onlyAdmin {
        require(_wallet != address(0), "AV: zero address");
        require(!validAnonymousWallets[_wallet], "AV: already whitelisted");
        validAnonymousWallets[_wallet] = true;
        emit WalletWhitelisted(_wallet, block.timestamp);
    }

    /**
     * @notice FR-01  Batch whitelist to save admin gas on large cohorts.
     * @param _wallets Array of anonymous wallet addresses.
     */
    function batchWhitelistWallets(address[] calldata _wallets) external onlyAdmin {
        for (uint256 i = 0; i < _wallets.length; i++) {
            if (!validAnonymousWallets[_wallets[i]] && _wallets[i] != address(0)) {
                validAnonymousWallets[_wallets[i]] = true;
                emit WalletWhitelisted(_wallets[i], block.timestamp);
            }
        }
    }

    // ───────────────────────────────────────────── Core Voting Logic ──────
    /**
     * @notice FR-02 & FR-03  Cast or override a vote (standard — voter pays gas).
     * @param _candidateId  Zero-indexed position in the candidates array.
     */
    function vote(uint256 _candidateId) external electionActive {
        require(validAnonymousWallets[msg.sender], "AV: wallet not authorized");
        _executeVote(msg.sender, _candidateId, false);
    }

    // ── EIP-712 Gasless Meta-Transaction Voting ─────────────────────────────
    /**
     * @notice Gasless vote: a Relayer calls this on behalf of the voter.
     *         The voter signs an EIP-712 typed message off-chain (free).
     *         The Relayer submits the signature and pays the gas fee.
     *
     * @param _voter        The whitelisted voter's address (recovered from sig).
     * @param _candidateId  Candidate to vote for.
     * @param _nonce        Replay-protection nonce (must match metaTxNonces[_voter]).
     * @param _v            ECDSA signature component v.
     * @param _r            ECDSA signature component r.
     * @param _s            ECDSA signature component s.
     */
    function castGaslessVote(
        address _voter,
        uint256 _candidateId,
        uint256 _nonce,
        uint8   _v,
        bytes32 _r,
        bytes32 _s
    ) external electionActive {
        // 1. Verify nonce matches to prevent replay
        require(_nonce == metaTxNonces[_voter], "AV: invalid nonce");

        // 2. Reconstruct the EIP-712 digest
        bytes32 structHash = keccak256(abi.encode(
            VOTE_TYPEHASH,
            _voter,
            _candidateId,
            _nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            structHash
        ));

        // 3. Recover signer and verify it matches the claimed voter
        address recoveredSigner = ecrecover(digest, _v, _r, _s);
        require(recoveredSigner != address(0), "AV: invalid signature");
        require(recoveredSigner == _voter, "AV: signer mismatch");

        // 4. Verify the recovered signer is whitelisted
        require(validAnonymousWallets[_voter], "AV: wallet not authorized");

        // 5. Increment nonce (prevents replay of the same signature)
        metaTxNonces[_voter]++;

        // 6. Execute the vote with anti-coercion override logic
        _executeVote(_voter, _candidateId, true);
    }

    /**
     * @dev Internal shared vote execution logic used by both vote() and castGaslessVote().
     * @param _voter        Address of the actual voter.
     * @param _candidateId  Candidate index.
     * @param _isGasless    Whether this is a meta-transaction (for event differentiation).
     */
    function _executeVote(address _voter, uint256 _candidateId, bool _isGasless) internal {
        require(_candidateId < candidates.length,  "AV: invalid candidateId");
        require(candidates[_candidateId].isActive, "AV: candidate is inactive");

        bool wasOverride = false;

        // ── Override path ────────────────────────────────────────────────────
        if (voterRecords[electionId][_voter].hasVoted) {
            uint256 oldChoice = voterRecords[electionId][_voter].candidateId;
            if (candidates[oldChoice].voteCount > 0) {
                candidates[oldChoice].voteCount--;
            }
            wasOverride = true;
        }

        // ── Apply new vote ───────────────────────────────────────────────────
        voterRecords[electionId][_voter] = VoteRecord({
            candidateId: _candidateId,
            hasVoted:    true,
            votedAt:     block.timestamp
        });
        candidates[_candidateId].voteCount++;

        if (_isGasless) {
            emit GaslessVoteCast(_voter, _candidateId, msg.sender, wasOverride, block.timestamp);
        } else {
            emit VoteCast(_voter, _candidateId, wasOverride, block.timestamp);
        }
    }

    // ─────────────────────────────────────────── Read-Only / FR-04 Tallying ──
    /**
     * @notice FR-04  Returns the full candidate list with live tallies.
     */
    function getAllCandidates() external view returns (Candidate[] memory) {
        return candidates;
    }

    /**
     * @notice Returns total number of candidates.
     */
    function getCandidateCount() external view returns (uint256) {
        return candidates.length;
    }

    /**
     * @notice Returns the current winning candidateId (ties resolved by lowest id).
     */
    function getWinner() external view electionEnded returns (uint256 winnerId, string memory winnerName, uint256 winningVotes) {
        require(candidates.length > 0, "AV: no candidates");
        uint256 maxVotes = 0;
        bool foundActive = false;
        for (uint256 i = 0; i < candidates.length; i++) {
            if (candidates[i].isActive && (candidates[i].voteCount > maxVotes || !foundActive)) {
                maxVotes = candidates[i].voteCount;
                winnerId = i;
                foundActive = true;
            }
        }
        require(foundActive, "AV: no active candidates");
        winnerName   = candidates[winnerId].name;
        winningVotes = candidates[winnerId].voteCount;
    }

    /**
     * @notice Returns seconds remaining until election deadline (0 if elapsed).
     */
    function timeRemaining() external view returns (uint256) {
        if (block.timestamp >= electionDeadline) return 0;
        return electionDeadline - block.timestamp;
    }

    // ─────────────────────────────────────────────── Admin: Finalize ──────
    function finalizeElection() external onlyAdmin {
        require(block.timestamp >= electionDeadline, "AV: deadline not reached");
        require(!electionFinalized, "AV: already finalized");
        electionFinalized = true;

        uint256[] memory tallies = new uint256[](candidates.length);
        for (uint256 i = 0; i < candidates.length; i++) {
            tallies[i] = candidates[i].voteCount;
        }
        emit ElectionFinalized(block.timestamp, tallies);
    }

    // ─────────────────────────────────────────── Admin: Candidate & Lifecycle ──
    function removeCandidate(uint256 _candidateId) external onlyAdmin {
        require(_candidateId < candidates.length, "AV: invalid candidateId");
        require(candidates[_candidateId].isActive, "AV: already inactive");
        candidates[_candidateId].isActive = false;
        emit CandidateRemoved(_candidateId);
    }

    function updateElectionDeadline(uint256 _newDeadline) external onlyAdmin {
        require(_newDeadline > block.timestamp, "AV: deadline must be in future");
        electionDeadline = _newDeadline;
        emit ElectionDeadlineUpdated(_newDeadline);
    }

    function resetElection(uint256 _durationInMinutes) external onlyAdmin {
        require(_durationInMinutes > 0, "AV: duration must be > 0");
        electionId++;
        electionDeadline = block.timestamp + (_durationInMinutes * 1 minutes);
        electionFinalized = false;
        
        // Delete all old candidates to make way for new cohort
        delete candidates;
        
        emit ElectionReset(electionId, electionDeadline);
    }

    // ─────────────────────────────────────────────── Admin: Transfer ──────
    function transferAdmin(address _newAdmin) external onlyAdmin {
        require(_newAdmin != address(0), "AV: zero address");
        admin = _newAdmin;
    }

    // Prevent accidental ETH deposits
    receive() external payable { revert("AV: does not accept ETH"); }
}
```

## Tests: AdvancedVoting.test.js

```javascript
const { expect } = require("chai");
const hre = require("hardhat");

describe("AdvancedVoting", function () {
  let contract, admin, voter1, voter2, stranger;
  const DURATION = 60; // minutes

  beforeEach(async () => {
    [admin, voter1, voter2, stranger] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("AdvancedVoting");
    contract = await Factory.deploy(DURATION, admin.address);
    await contract.waitForDeployment();

    // Add two candidates
    await contract.addCandidate("Alice", "https://img/alice", "Vote Alice!");
    await contract.addCandidate("Bob",   "https://img/bob",   "Vote Bob!");
  });

  // ── Admin guards ──────────────────────────────────────────────────────────
  it("should set deployer as admin", async () => {
    expect(await contract.admin()).to.equal(admin.address);
  });

  it("rejects non-admin from whitelisting", async () => {
    await expect(
      contract.connect(stranger).whitelistAnonymousWallet(voter1.address)
    ).to.be.revertedWith("AV: caller is not admin");
  });

  // ── Whitelisting ──────────────────────────────────────────────────────────
  it("whitelists a wallet", async () => {
    await contract.whitelistAnonymousWallet(voter1.address);
    expect(await contract.validAnonymousWallets(voter1.address)).to.be.true;
  });

  it("batch whitelists wallets", async () => {
    await contract.batchWhitelistWallets([voter1.address, voter2.address]);
    expect(await contract.validAnonymousWallets(voter1.address)).to.be.true;
    expect(await contract.validAnonymousWallets(voter2.address)).to.be.true;
  });

  it("allows voter to register with a valid signature from campusAuthority", async () => {
    const messageHash = hre.ethers.solidityPackedKeccak256(["address"], [voter1.address]);
    const signature = await admin.signMessage(hre.ethers.getBytes(messageHash));
    
    await contract.connect(voter1).registerVoter(signature);
    expect(await contract.validAnonymousWallets(voter1.address)).to.be.true;
  });

  it("allows stranger (relayer) to register voter on behalf of them using registerVoterFor", async () => {
    const messageHash = hre.ethers.solidityPackedKeccak256(["address"], [voter1.address]);
    const signature = await admin.signMessage(hre.ethers.getBytes(messageHash));
    
    // Stranger (relayer) submits registration and pays gas!
    await contract.connect(stranger).registerVoterFor(voter1.address, signature);
    expect(await contract.validAnonymousWallets(voter1.address)).to.be.true;
  });

  it("rejects voter self-registration with an invalid signature", async () => {
    const messageHash = hre.ethers.solidityPackedKeccak256(["address"], [voter1.address]);
    const signature = await stranger.signMessage(hre.ethers.getBytes(messageHash));
    
    await expect(
      contract.connect(voter1).registerVoter(signature)
    ).to.be.revertedWith("AV: invalid campus authorization");
  });

  // ── Voting ────────────────────────────────────────────────────────────────
  it("allows whitelisted voter to cast a vote", async () => {
    await contract.whitelistAnonymousWallet(voter1.address);
    await contract.connect(voter1).vote(0);
    const candidates = await contract.getAllCandidates();
    expect(candidates[0].voteCount).to.equal(1n);
  });

  it("rejects non-whitelisted voter", async () => {
    await expect(contract.connect(stranger).vote(0)).to.be.revertedWith(
      "AV: wallet not authorized"
    );
  });

  // ── Anti-Coercion override ────────────────────────────────────────────────
  it("correctly overrides a previous vote", async () => {
    await contract.whitelistAnonymousWallet(voter1.address);

    // First vote: Alice (id=0)
    await contract.connect(voter1).vote(0);
    let c = await contract.getAllCandidates();
    expect(c[0].voteCount).to.equal(1n);
    expect(c[1].voteCount).to.equal(0n);

    // Override: Bob (id=1)
    await contract.connect(voter1).vote(1);
    c = await contract.getAllCandidates();
    expect(c[0].voteCount).to.equal(0n); // Alice's vote was removed
    expect(c[1].voteCount).to.equal(1n); // Bob now has it
  });

  it("records the correct override state in voterRecords", async () => {
    await contract.whitelistAnonymousWallet(voter1.address);
    await contract.connect(voter1).vote(0);
    await contract.connect(voter1).vote(1);
    const record = await contract.voterRecords(0, voter1.address);
    expect(record.candidateId).to.equal(1n);
    expect(record.hasVoted).to.be.true;
  });

  // ── Time lock ─────────────────────────────────────────────────────────────
  it("blocks voting after deadline", async () => {
    await contract.whitelistAnonymousWallet(voter1.address);

    // Fast-forward time past election deadline
    await hre.network.provider.send("evm_increaseTime", [DURATION * 60 + 1]);
    await hre.network.provider.send("evm_mine");

    await expect(contract.connect(voter1).vote(0)).to.be.revertedWith(
      "AV: election period has ended"
    );
  });

  // ── Winner ────────────────────────────────────────────────────────────────
  it("returns correct winner after deadline", async () => {
    await contract.whitelistAnonymousWallet(voter1.address);
    await contract.whitelistAnonymousWallet(voter2.address);
    await contract.connect(voter1).vote(0);
    await contract.connect(voter2).vote(0);

    await hre.network.provider.send("evm_increaseTime", [DURATION * 60 + 1]);
    await hre.network.provider.send("evm_mine");

    const [winnerId, winnerName, votes] = await contract.getWinner();
    expect(winnerId).to.equal(0n);
    expect(winnerName).to.equal("Alice");
    expect(votes).to.equal(2n);
  });

  // ── Admin: Dashboard Operations ──────────────────────────────────────────
  it("allows admin to remove a candidate and blocks votes for them", async () => {
    // Verify initial active state
    let c = await contract.getAllCandidates();
    expect(c[1].isActive).to.be.true; // "Bob" starts active
    
    // Remove "Bob"
    await contract.removeCandidate(1);
    
    c = await contract.getAllCandidates();
    expect(c[1].isActive).to.be.false; // Now inactive
    
    // Attempting to vote for deactivated "Bob" should revert
    await contract.whitelistAnonymousWallet(voter1.address);
    await expect(contract.connect(voter1).vote(1)).to.be.revertedWith(
      "AV: candidate is inactive"
    );
  });

  it("allows admin to update election deadline dynamically", async () => {
    const originalDeadline = await contract.electionDeadline();
    const newDeadline = Number(originalDeadline) + 3600; // extend by 1 hour
    
    await contract.updateElectionDeadline(newDeadline);
    const updatedDeadline = await contract.electionDeadline();
    expect(updatedDeadline).to.equal(BigInt(newDeadline));
  });

  it("allows admin to reset election to launch a new cohort", async () => {
    // Verify initial election ID is 0
    expect(await contract.electionId()).to.equal(0n);
    
    // Reset election
    await contract.resetElection(10); // duration 10 mins
    
    // Verify incremented election ID
    expect(await contract.electionId()).to.equal(1n);
    
    // Verify candidates are wiped out
    const candidatesCount = await contract.getCandidateCount();
    expect(candidatesCount).to.equal(0n);
  });

  // ── EIP-712 Gasless Meta-Transactions ─────────────────────────────────────
  describe("EIP-712 Gasless Voting", function () {
    it("should allow a voter to vote gaslessly via a signed EIP-712 message", async () => {
      // 1. Whitelist the voter address
      await contract.whitelistAnonymousWallet(voter1.address);

      // 2. Setup domain and type definitions matching contract
      const network = await hre.ethers.provider.getNetwork();
      const domain = {
        name: "CryptoVote Campus",
        version: "2",
        chainId: Number(network.chainId),
        verifyingContract: await contract.getAddress(),
      };

      const types = {
        Vote: [
          { name: "voter", type: "address" },
          { name: "candidateId", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      };

      const value = {
        voter: voter1.address,
        candidateId: 0n,
        nonce: 0n,
      };

      // 3. Sign the vote from voter1's private key (simulating MetaMask)
      const signature = await voter1.signTypedData(domain, types, value);
      const sig = hre.ethers.Signature.from(signature);

      // 4. Submit transaction from stranger (relayer pays gas!)
      await expect(
        contract.connect(stranger).castGaslessVote(
          voter1.address,
          0n,
          0n,
          sig.v,
          sig.r,
          sig.s
        )
      ).to.emit(contract, "GaslessVoteCast")
       .withArgs(voter1.address, 0n, stranger.address, false, anyValue => true);

      // 5. Verify the candidate's vote count increased
      const candidates = await contract.getAllCandidates();
      expect(candidates[0].voteCount).to.equal(1n);

      // 6. Verify voter's nonce has been incremented
      expect(await contract.metaTxNonces(voter1.address)).to.equal(1n);
    });

    it("should reject gasless vote if signature doesn't match voter", async () => {
      await contract.whitelistAnonymousWallet(voter1.address);
      const network = await hre.ethers.provider.getNetwork();
      const domain = {
        name: "CryptoVote Campus",
        version: "2",
        chainId: Number(network.chainId),
        verifyingContract: await contract.getAddress(),
      };

      const types = {
        Vote: [
          { name: "voter", type: "address" },
          { name: "candidateId", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      };

      // voter1 is the claimed voter, but stranger signs it!
      const value = {
        voter: voter1.address,
        candidateId: 0n,
        nonce: 0n,
      };

      const signature = await stranger.signTypedData(domain, types, value);
      const sig = hre.ethers.Signature.from(signature);

      await expect(
        contract.connect(stranger).castGaslessVote(
          voter1.address,
          0n,
          0n,
          sig.v,
          sig.r,
          sig.s
        )
      ).to.be.revertedWith("AV: signer mismatch");
    });

    it("should reject gasless vote with incorrect nonce to prevent replay", async () => {
      await contract.whitelistAnonymousWallet(voter1.address);
      const network = await hre.ethers.provider.getNetwork();
      const domain = {
        name: "CryptoVote Campus",
        version: "2",
        chainId: Number(network.chainId),
        verifyingContract: await contract.getAddress(),
      };

      const types = {
        Vote: [
          { name: "voter", type: "address" },
          { name: "candidateId", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      };

      // Expecting nonce = 0, but voter signs with 999
      const value = {
        voter: voter1.address,
        candidateId: 0n,
        nonce: 999n,
      };

      const signature = await voter1.signTypedData(domain, types, value);
      const sig = hre.ethers.Signature.from(signature);

      await expect(
        contract.connect(stranger).castGaslessVote(
          voter1.address,
          0n,
          999n,
          sig.v,
          sig.r,
          sig.s
        )
      ).to.be.revertedWith("AV: invalid nonce");
    });
  });
});
```
