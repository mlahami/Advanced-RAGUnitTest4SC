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
