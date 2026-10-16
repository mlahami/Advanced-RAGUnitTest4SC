const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const CHAIN_ID_POLYGON = 137;
const CHAIN_ID_ARBITRUM = 42161;
const CHAIN_ID_OPTIMISM = 10;

describe("CrossChainBridge", function () {
  async function deployBridgeFixture() {
    const [owner, user1, user2] = await ethers.getSigners();
    const MockBridge = await ethers.getContractFactory("MockCrossChainBridge");
    const bridge = await MockBridge.deploy(CHAIN_ID_POLYGON);
    return { bridge, owner, user1, user2 };
  }

  describe("MockCrossChainBridge", function () {
    it("should deploy with correct chain ID", async function () {
      const { bridge } = await loadFixture(deployBridgeFixture);
      expect(await bridge.localChainId()).to.equal(CHAIN_ID_POLYGON);
    });

    it("should send a message and emit event", async function () {
      const { bridge } = await loadFixture(deployBridgeFixture);
      const payload = ethers.toUtf8Bytes("hello cross-chain");
      await expect(bridge.sendMessage(CHAIN_ID_ARBITRUM, payload, ethers.ZeroAddress))
        .to.emit(bridge, "MessageSent")
        .withArgs(CHAIN_ID_ARBITRUM, ethers.keccak256(ethers.solidityPacked(["uint256", "uint256", "bytes"], [31337n, 0n, payload])), payload);
    });

    it("should set and get trusted remote", async function () {
      const { bridge } = await loadFixture(deployBridgeFixture);
      const remoteAddr = ethers.toUtf8Bytes("0x1234567890abcdef1234567890abcdef12345678");
      await bridge.setTrustedRemote(CHAIN_ID_ARBITRUM, remoteAddr);
      expect(await bridge.getTrustedRemote(CHAIN_ID_ARBITRUM)).to.equal(ethers.hexlify(remoteAddr));
    });

    it("should deliver a message to a target contract", async function () {
      const { bridge, user1 } = await loadFixture(deployBridgeFixture);

      const payload = ethers.toUtf8Bytes("test-payload");
      const messageId = ethers.keccak256(ethers.solidityPacked(["uint256", "uint256", "bytes"], [31337n, 0n, payload]));

      await bridge.sendMessage(CHAIN_ID_ARBITRUM, payload, ethers.ZeroAddress);

      await expect(bridge.deliverMessage(user1.address, CHAIN_ID_ARBITRUM, messageId, payload))
        .to.emit(bridge, "MessageReceived");
    });

    it("should prevent duplicate message delivery", async function () {
      const { bridge, user1 } = await loadFixture(deployBridgeFixture);

      const payload = ethers.toUtf8Bytes("duplicate-test");
      const messageId = ethers.keccak256(ethers.solidityPacked(["uint256", "uint256", "bytes"], [31337n, 0n, payload]));

      await bridge.sendMessage(CHAIN_ID_ARBITRUM, payload, ethers.ZeroAddress);
      await bridge.deliverMessage(user1.address, CHAIN_ID_ARBITRUM, messageId, payload);

      await expect(
        bridge.deliverMessage(user1.address, CHAIN_ID_ARBITRUM, messageId, payload)
      ).to.be.revertedWithCustomError(bridge, "MessageAlreadyProcessed");
    });

    it("should revert on invalid chain ID zero", async function () {
      const { bridge } = await loadFixture(deployBridgeFixture);
      await expect(bridge.sendMessage(0, ethers.toUtf8Bytes("bad"), ethers.ZeroAddress))
        .to.be.revertedWithCustomError(bridge, "InvalidChainId");
    });

    it("should return zero fee from estimate", async function () {
      const { bridge } = await loadFixture(deployBridgeFixture);
      const fee = await bridge.estimateFees(CHAIN_ID_ARBITRUM, ethers.toUtf8Bytes("test"));
      expect(fee).to.equal(0n);
    });
  });
});

describe("CrossChainGovernor", function () {
  const VOTING_PERIOD = 3600;

  async function deployGovernorFixture() {
    const [owner, user1, user2] = await ethers.getSigners();
    const MockBridge = await ethers.getContractFactory("MockCrossChainBridge");
    const Governor = await ethers.getContractFactory("CrossChainGovernor");

    const sharedBridge = await MockBridge.deploy(CHAIN_ID_POLYGON);

    const hubGovernor = await Governor.deploy(
      await sharedBridge.getAddress(),
      CHAIN_ID_POLYGON,
      CHAIN_ID_POLYGON,
      true
    );

    const spokeGovernor = await Governor.deploy(
      await sharedBridge.getAddress(),
      CHAIN_ID_ARBITRUM,
      CHAIN_ID_POLYGON,
      false
    );

    return { bridge: sharedBridge, hubGovernor, spokeGovernor, owner, user1, user2 };
  }

  describe("Deployment", function () {
    it("should deploy hub with correct chain ID and isHub=true", async function () {
      const { hubGovernor } = await loadFixture(deployGovernorFixture);
      expect(await hubGovernor.localChainId()).to.equal(CHAIN_ID_POLYGON);
      expect(await hubGovernor.isHub()).to.equal(true);
    });

    it("should deploy spoke with correct chain ID and isHub=false", async function () {
      const { spokeGovernor } = await loadFixture(deployGovernorFixture);
      expect(await spokeGovernor.localChainId()).to.equal(CHAIN_ID_ARBITRUM);
      expect(await spokeGovernor.isHub()).to.equal(false);
    });

    it("should set correct hub chain ID on spoke", async function () {
      const { spokeGovernor } = await loadFixture(deployGovernorFixture);
      expect(await spokeGovernor.hubChainId()).to.equal(CHAIN_ID_POLYGON);
    });
  });

  describe("Spoke Registration", function () {
    it("should register a spoke chain on hub", async function () {
      const { hubGovernor } = await loadFixture(deployGovernorFixture);
      const spokeAddr = ethers.toUtf8Bytes("0x1111111111111111111111111111111111111111");
      await expect(hubGovernor.registerSpoke(CHAIN_ID_ARBITRUM, spokeAddr))
        .to.emit(hubGovernor, "SpokeRegistered")
        .withArgs(CHAIN_ID_ARBITRUM);
      expect(await hubGovernor.getSpokeCount()).to.equal(1);
    });

    it("should allow registering multiple spokes", async function () {
      const { hubGovernor } = await loadFixture(deployGovernorFixture);
      const addr1 = ethers.toUtf8Bytes("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      const addr2 = ethers.toUtf8Bytes("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await hubGovernor.registerSpoke(CHAIN_ID_ARBITRUM, addr1);
      await hubGovernor.registerSpoke(CHAIN_ID_OPTIMISM, addr2);

      expect(await hubGovernor.getSpokeCount()).to.equal(2);
    });
  });

  describe("Proposal Flow", function () {
    async function fullSetupFixture() {
      const base = await deployGovernorFixture();
      const spokeAddr = ethers.toUtf8Bytes(await base.spokeGovernor.getAddress());
      await base.hubGovernor.registerSpoke(CHAIN_ID_ARBITRUM, spokeAddr);

      const target = ethers.Wallet.createRandom().address;
      return { ...base, target, spokeAddr };
    }

    it("should relay a proposal from hub to spoke via bridge", async function () {
      const { hubGovernor, bridge, spokeGovernor, target } = await loadFixture(fullSetupFixture);

      const targets = [target];
      const values = [0n];
      const calldatas = [ethers.toUtf8Bytes("0x1234")];
      const description = "Test cross-chain proposal";

      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address[]", "uint256[]", "bytes[]", "string", "uint256", "uint256"],
        [1n, targets, values, calldatas, description, 0n, 0n]
      );

      const messageId = ethers.keccak256(ethers.solidityPacked(
        ["uint256", "uint256", "bytes"],
        [31337n, 0n, Buffer.from(payload.slice(2), "hex")]
      ));

      await hubGovernor.relayProposal(CHAIN_ID_ARBITRUM, 1, targets, values, calldatas, description, VOTING_PERIOD);

      const spokeAddr = await spokeGovernor.getAddress();
      await bridge.deliverMessage(spokeAddr, CHAIN_ID_POLYGON, messageId, payload);

      const prop = await spokeGovernor.getProposal(1);
      expect(prop.hubProposalId).to.equal(1);
    });

    it("should relay proposal to all spokes", async function () {
      const { hubGovernor, bridge, spokeGovernor } = await loadFixture(fullSetupFixture);

      const spokeAddr = ethers.toUtf8Bytes(await spokeGovernor.getAddress());
      await hubGovernor.registerSpoke(CHAIN_ID_OPTIMISM, spokeAddr);

      const targets = [spokeGovernor.target];
      const values = [0n];
      const calldatas = [ethers.toUtf8Bytes("0x")];
      const description = "All-spoke proposal";

      await hubGovernor.relayProposalToAllSpokes(1, targets, values, calldatas, description, VOTING_PERIOD);
      expect(await hubGovernor.getSpokeCount()).to.equal(2);
    });

    it("should revert relayProposalToAllSpokes if no spokes configured", async function () {
      const { owner } = await deployGovernorFixture();
      const MockBridge = await ethers.getContractFactory("MockCrossChainBridge");
      const Governor = await ethers.getContractFactory("CrossChainGovernor");

      const bridge = await MockBridge.deploy(CHAIN_ID_POLYGON);
      const governor = await Governor.deploy(await bridge.getAddress(), CHAIN_ID_POLYGON, CHAIN_ID_POLYGON, true);

      await expect(
        governor.relayProposalToAllSpokes(1, [], [], [], "", 0)
      ).to.be.revertedWithCustomError(governor, "NoSpokeConfigured");
    });

    it("should not allow non-hub to relay proposals", async function () {
      const { spokeGovernor } = await loadFixture(deployGovernorFixture);
      await expect(
        spokeGovernor.relayProposal(CHAIN_ID_POLYGON, 1, [], [], [], "", 0)
      ).to.be.revertedWithCustomError(spokeGovernor, "NotHub");
    });
  });

  describe("Vote Casting", function () {
    async function spokeWithProposalFixture() {
      const base = await deployGovernorFixture();
      const spokeAddr = ethers.toUtf8Bytes(await base.spokeGovernor.getAddress());
      await base.hubGovernor.registerSpoke(CHAIN_ID_ARBITRUM, spokeAddr);

      const targets = [base.user1.address];
      const values = [0n];
      const calldatas = [ethers.toUtf8Bytes("0x")];
      const description = "Vote test proposal";

      const timestamp = await ethers.provider.getBlock("latest").then(b => b.timestamp);
      const votingStart = timestamp;
      const votingEnd = timestamp + VOTING_PERIOD;

      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address[]", "uint256[]", "bytes[]", "string", "uint256", "uint256"],
        [1n, targets, values, calldatas, description, votingStart, votingEnd]
      );

      const messageId = ethers.keccak256(ethers.solidityPacked(
        ["uint256", "uint256", "bytes"],
        [31337n, 0n, Buffer.from(payload.slice(2), "hex")]
      ));

      await base.bridge.deliverMessage(await base.spokeGovernor.getAddress(), CHAIN_ID_POLYGON, messageId, payload);

      return { ...base, votingStart, votingEnd };
    }

    it("should receive a proposal on spoke chain", async function () {
      const { spokeGovernor } = await loadFixture(spokeWithProposalFixture);
      const prop = await spokeGovernor.getProposal(1);
      expect(prop.hubProposalId).to.equal(1);
      expect(prop.executed).to.equal(false);
    });

    it("should allow voting on received proposal", async function () {
      const { spokeGovernor, user1 } = await loadFixture(spokeWithProposalFixture);

      await expect(spokeGovernor.connect(user1).castVote(1, 1))
        .to.emit(spokeGovernor, "VoteCast")
        .withArgs(1, user1.address, 1, 1);

      const prop = await spokeGovernor.getProposal(1);
      expect(prop.forVotes).to.equal(1);
    });

    it("should prevent double voting", async function () {
      const { spokeGovernor, user1 } = await loadFixture(spokeWithProposalFixture);

      await spokeGovernor.connect(user1).castVote(1, 1);
      await expect(spokeGovernor.connect(user1).castVote(1, 0))
        .to.be.revertedWithCustomError(spokeGovernor, "AlreadyVoted");
    });

    it("should track against and abstain votes", async function () {
      const { spokeGovernor, user1, user2 } = await loadFixture(spokeWithProposalFixture);

      await spokeGovernor.connect(user1).castVote(1, 0);
      await spokeGovernor.connect(user2).castVote(1, 2);

      const prop = await spokeGovernor.getProposal(1);
      expect(prop.againstVotes).to.equal(1);
      expect(prop.abstainVotes).to.equal(1);
    });

    it("should revert vote on non-existent proposal", async function () {
      const { spokeGovernor, user1 } = await loadFixture(deployGovernorFixture);
      await expect(spokeGovernor.connect(user1).castVote(999, 1))
        .to.be.revertedWithCustomError(spokeGovernor, "ProposalNotActive");
    });
  });

  describe("Vote Relay", function () {
    it("should prevent vote relay before voting ends", async function () {
      const { spokeGovernor } = await loadFixture(deployGovernorFixture);
      await expect(spokeGovernor.relayVotesToHub(1))
        .to.be.revertedWithCustomError(spokeGovernor, "ProposalNotActive");
    });
  });

  describe("Execution", function () {
    it("should prevent execution of non-existent proposal", async function () {
      const { spokeGovernor } = await loadFixture(deployGovernorFixture);
      await expect(spokeGovernor.execute(999))
        .to.be.revertedWithCustomError(spokeGovernor, "ProposalNotActive");
    });
  });
});

describe("ResurgeBridgeToken", function () {
  async function deployBridgeTokenFixture() {
    const [owner, user1, user2] = await ethers.getSigners();

    const MockBridge = await ethers.getContractFactory("MockCrossChainBridge");
    const bridge = await MockBridge.deploy(CHAIN_ID_POLYGON);

    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    const token = await ERC20Mock.deploy("Resurge Token", "RESURGE", ethers.parseEther("1000000"));

    const BridgeToken = await ethers.getContractFactory("ResurgeBridgeToken");
    const bridgeToken = await BridgeToken.deploy(
      await bridge.getAddress(),
      await token.getAddress(),
      CHAIN_ID_POLYGON
    );

    await token.transfer(user1.address, ethers.parseEther("10000"));
    await token.transfer(user2.address, ethers.parseEther("10000"));
    await token.transfer(owner.address, ethers.parseEther("10000"));

    return { bridge, token, bridgeToken, owner, user1, user2 };
  }

  describe("Deployment", function () {
    it("should deploy with correct parameters", async function () {
      const { bridgeToken, bridge, token } = await loadFixture(deployBridgeTokenFixture);
      expect(await bridgeToken.localChainId()).to.equal(CHAIN_ID_POLYGON);
      expect(await bridgeToken.bridge()).to.equal(await bridge.getAddress());
      expect(await bridgeToken.resurgeToken()).to.equal(await token.getAddress());
    });

    it("should have zero locked initially", async function () {
      const { bridgeToken } = await loadFixture(deployBridgeTokenFixture);
      expect(await bridgeToken.totalLocked()).to.equal(0);
    });
  });

  describe("Token Bridging", function () {
    it("should lock tokens for bridging", async function () {
      const { bridgeToken, token, user1 } = await loadFixture(deployBridgeTokenFixture);
      const amount = ethers.parseEther("100");

      await token.connect(user1).approve(await bridgeToken.getAddress(), amount);

      await expect(bridgeToken.connect(user1).bridgeTokensTo(CHAIN_ID_ARBITRUM, amount, user1.address))
        .to.emit(bridgeToken, "TokensLocked");

      expect(await bridgeToken.totalLocked()).to.equal(amount);
      expect(await token.balanceOf(await bridgeToken.getAddress())).to.equal(amount);
    });

    it("should revert bridging with zero amount", async function () {
      const { bridgeToken, user1 } = await loadFixture(deployBridgeTokenFixture);
      await expect(
        bridgeToken.connect(user1).bridgeTokensTo(CHAIN_ID_ARBITRUM, 0, user1.address)
      ).to.be.revertedWithCustomError(bridgeToken, "InsufficientAmount");
    });

    it("should revert bridging to zero address", async function () {
      const { bridgeToken, token, user1 } = await loadFixture(deployBridgeTokenFixture);
      const amount = ethers.parseEther("100");
      await token.connect(user1).approve(await bridgeToken.getAddress(), amount);

      await expect(
        bridgeToken.connect(user1).bridgeTokensTo(CHAIN_ID_ARBITRUM, amount, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(bridgeToken, "InsufficientAmount");
    });

    it("should revert bridging without approval", async function () {
      const { bridgeToken, user1 } = await loadFixture(deployBridgeTokenFixture);
      const amount = ethers.parseEther("100");

      await expect(
        bridgeToken.connect(user1).bridgeTokensTo(CHAIN_ID_ARBITRUM, amount, user1.address)
      ).to.be.reverted;
    });

    it("should track locked balances per user", async function () {
      const { bridgeToken, token, user1 } = await loadFixture(deployBridgeTokenFixture);
      const amount = ethers.parseEther("100");
      await token.connect(user1).approve(await bridgeToken.getAddress(), amount);
      await bridgeToken.connect(user1).bridgeTokensTo(CHAIN_ID_ARBITRUM, amount, user1.address);

      expect(await bridgeToken.lockedBalances(user1.address)).to.equal(amount);
    });
  });

  describe("Bridge Reserve Management", function () {
    it("should allow bridge manager to deposit reserve", async function () {
      const { bridgeToken, token, owner } = await loadFixture(deployBridgeTokenFixture);
      const amount = ethers.parseEther("5000");

      await token.approve(await bridgeToken.getAddress(), amount);
      await bridgeToken.depositReserve(amount);

      expect(await bridgeToken.getBridgeReserve()).to.equal(amount);
    });

    it("should allow bridge manager to withdraw reserve", async function () {
      const { bridgeToken, token, owner } = await loadFixture(deployBridgeTokenFixture);
      const amount = ethers.parseEther("5000");

      await token.approve(await bridgeToken.getAddress(), amount);
      await bridgeToken.depositReserve(amount);
      await bridgeToken.withdrawReserve(amount);

      expect(await bridgeToken.getBridgeReserve()).to.equal(0);
    });

    it("should revert withdrawal exceeding reserve", async function () {
      const { bridgeToken } = await loadFixture(deployBridgeTokenFixture);
      await expect(bridgeToken.withdrawReserve(ethers.parseEther("1")))
        .to.be.revertedWithCustomError(bridgeToken, "InsufficientBridgeReserve");
    });
  });

  describe("Message Processing", function () {
    it("should process bridged-in tokens via lzReceive from bridge", async function () {
      const { bridge, bridgeToken, token, user2 } = await loadFixture(deployBridgeTokenFixture);
      const amount = ethers.parseEther("200");

      await token.transfer(await bridgeToken.getAddress(), amount);

      const transferId = ethers.keccak256(ethers.solidityPacked(
        ["uint256", "address", "uint256", "uint16", "uint256", "uint256"],
        [31337n, user2.address, amount, CHAIN_ID_ARBITRUM, 0n, 0n]
      ));

      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256", "address"],
        [transferId, amount, user2.address]
      );

      await bridge.deliverMessage(
        await bridgeToken.getAddress(),
        CHAIN_ID_ARBITRUM,
        transferId,
        payload
      );

      expect(await token.balanceOf(user2.address)).to.be.gt(ethers.parseEther("10000"));
    });

    it("should prevent duplicate withdrawal processing", async function () {
      const { bridge, bridgeToken, token, user2 } = await loadFixture(deployBridgeTokenFixture);
      const amount = ethers.parseEther("50");

      await token.transfer(await bridgeToken.getAddress(), amount);

      const transferId = ethers.keccak256(ethers.solidityPacked(
        ["uint256", "address", "uint256", "uint16", "uint256", "uint256"],
        [31337n, user2.address, amount, CHAIN_ID_ARBITRUM, 0n, 0n]
      ));

      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256", "address"],
        [transferId, amount, user2.address]
      );

      await bridge.deliverMessage(await bridgeToken.getAddress(), CHAIN_ID_ARBITRUM, transferId, payload);

      const secondMessageId = ethers.keccak256(ethers.toUtf8Bytes("second-message"));

      await expect(
        bridge.deliverMessage(await bridgeToken.getAddress(), CHAIN_ID_ARBITRUM, secondMessageId, payload)
      ).to.be.reverted;
    });
  });
});

describe("LayerZeroBridge", function () {
  async function deployLzBridgeFixture() {
    const [owner, user1] = await ethers.getSigners();
    const LzBridge = await ethers.getContractFactory("LayerZeroBridge");
    const lzBridge = await LzBridge.deploy(owner.address, CHAIN_ID_POLYGON);
    return { lzBridge, owner, user1 };
  }

  describe("Deployment", function () {
    it("should deploy with correct parameters", async function () {
      const { lzBridge, owner } = await loadFixture(deployLzBridgeFixture);
      expect(await lzBridge.localChainId()).to.equal(CHAIN_ID_POLYGON);
      expect(await lzBridge.lzEndpoint()).to.equal(owner.address);
    });
  });

  describe("Trusted Remotes", function () {
    it("should set and get trusted remote", async function () {
      const { lzBridge } = await loadFixture(deployLzBridgeFixture);
      const remote = ethers.toUtf8Bytes("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
      await lzBridge.setTrustedRemote(CHAIN_ID_ARBITRUM, remote);
      expect(await lzBridge.getTrustedRemote(CHAIN_ID_ARBITRUM)).to.equal(ethers.hexlify(remote));
    });

    it("should emit event on set", async function () {
      const { lzBridge } = await loadFixture(deployLzBridgeFixture);
      const remote = ethers.toUtf8Bytes("0xcafebabecafebabecafebabecafebabecafebabe");
      await expect(lzBridge.setTrustedRemote(CHAIN_ID_OPTIMISM, remote))
        .to.emit(lzBridge, "TrustedRemoteSet")
        .withArgs(CHAIN_ID_OPTIMISM, remote);
    });
  });

  describe("Message Sending", function () {
    it("should revert on invalid chain ID", async function () {
      const { lzBridge } = await loadFixture(deployLzBridgeFixture);
      await expect(
        lzBridge.sendMessage(0, ethers.toUtf8Bytes("test"), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(lzBridge, "InvalidChainId");
    });

    it("should revert without trusted remote set", async function () {
      const { lzBridge } = await loadFixture(deployLzBridgeFixture);
      await expect(
        lzBridge.sendMessage(CHAIN_ID_ARBITRUM, ethers.toUtf8Bytes("test"), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(lzBridge, "UnauthorizedRemote");
    });
  });

  describe("Gas Limit", function () {
    it("should have default min gas limit", async function () {
      const { lzBridge } = await loadFixture(deployLzBridgeFixture);
      expect(await lzBridge.minGasLimit()).to.equal(200000);
    });

    it("should allow owner to update gas limit", async function () {
      const { lzBridge } = await loadFixture(deployLzBridgeFixture);
      await expect(lzBridge.setMinGasLimit(100000))
        .to.emit(lzBridge, "GasLimitUpdated")
        .withArgs(100000);
      expect(await lzBridge.minGasLimit()).to.equal(100000);
    });
  });
});
