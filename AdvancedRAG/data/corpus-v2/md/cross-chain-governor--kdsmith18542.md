# cross-chain-governor--kdsmith18542

- domain: relayer-meta-transactions (bridge)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/kdsmith18542/Resurgence-Protocol @ acec56d74ea79729807be0bdcb756cae778be3bf
- license: MIT
- targets: CrossChainGovernor.sol, ICrossChainBridge.sol, MockCrossChainBridge.sol, ResurgeBridgeToken.sol, LayerZeroBridge.sol, ERC20Mock.sol
- validation: 42 passing tests, 0 failing; statement coverage CrossChainGovernor.sol 71.67 %, ICrossChainBridge.sol 100.0 %, MockCrossChainBridge.sol 86.67 %, ResurgeBridgeToken.sol 91.67 %, LayerZeroBridge.sol 26.92 %, ERC20Mock.sol 50.0 %

## Contract: CrossChainGovernor.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ICrossChainBridge.sol";

error NotHub();
error NotSpoke();
error ProposalNotActive();
error VotingNotEnded();
error AlreadyVoted();
error AlreadyExecuted();
error VotesAlreadyRelayed();
error InvalidProposalState();
error NoSpokeConfigured();
error InvalidMessageId();
error TooManyOperations();
error TooManySpokes();

contract CrossChainGovernor is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    uint256 public constant MAX_OPERATIONS_PER_PROPOSAL = 50;
    uint256 public constant MAX_SPOKES_PER_RELAY = 50;

    ICrossChainBridge public immutable bridge;
    uint16 public immutable localChainId;
    bool public immutable isHub;
    uint16 public immutable hubChainId;

    mapping(uint16 => bytes) public spokeAddresses;
    uint16[] public spokeChainIds;

    struct CrossChainProposal {
        uint256 hubProposalId;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        string description;
        uint256 votingStart;
        uint256 votingEnd;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool executed;
        bool votesRelayed;
    }

    mapping(uint256 => CrossChainProposal) public proposals;
    uint256 public proposalCount;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalReceived(uint256 indexed hubProposalId, uint256 localProposalId, uint256 votingStart, uint256 votingEnd);
    event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 weight);
    event VotesRelayed(uint256 indexed hubProposalId, uint16 indexed dstChainId, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes);
    event ProposalExecuted(uint256 indexed proposalId);
    event SpokeRegistered(uint16 indexed chainId);

    function _sendMessageOrRevert(
        uint16 dstChainId,
        bytes memory payload,
        uint256 value,
        address refundAddress
    ) internal {
        bytes32 messageId = bridge.sendMessage{value: value}(dstChainId, payload, refundAddress);
        if (uint256(messageId) < 1) revert InvalidMessageId();
    }

    constructor(address _bridge, uint16 _localChainId, uint16 _hubChainId, bool _isHub) {
        bridge = ICrossChainBridge(_bridge);
        localChainId = _localChainId;
        hubChainId = _hubChainId;
        isHub = _isHub;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNOR_ROLE, msg.sender);
        _grantRole(EXECUTOR_ROLE, msg.sender);
    }

    function registerSpoke(uint16 chainId, bytes calldata spokeAddress) external onlyRole(GOVERNOR_ROLE) {
        spokeAddresses[chainId] = spokeAddress;
        spokeChainIds.push(chainId);
        emit SpokeRegistered(chainId);
    }

    function relayProposal(
        uint16 dstChainId,
        uint256 hubProposalId,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        string calldata description,
        uint256 votingPeriod
    ) external payable onlyRole(GOVERNOR_ROLE) nonReentrant {
        if (!isHub) revert NotHub();
        if (targets.length == 0 || targets.length != values.length || targets.length != calldatas.length) {
            revert InvalidProposalState();
        }
        if (targets.length > MAX_OPERATIONS_PER_PROPOSAL) revert TooManyOperations();

        bytes memory payload = abi.encode(
            hubProposalId,
            targets,
            values,
            calldatas,
            description,
            block.timestamp,
            block.timestamp + votingPeriod
        );
        _sendMessageOrRevert(dstChainId, payload, msg.value, msg.sender);
    }

    function relayProposalToAllSpokes(
        uint256 hubProposalId,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        string calldata description,
        uint256 votingPeriod
    ) external payable onlyRole(GOVERNOR_ROLE) nonReentrant {
        if (!isHub) revert NotHub();
        if (spokeChainIds.length == 0) revert NoSpokeConfigured();
        if (spokeChainIds.length > MAX_SPOKES_PER_RELAY) revert TooManySpokes();
        if (targets.length == 0 || targets.length != values.length || targets.length != calldatas.length) {
            revert InvalidProposalState();
        }
        if (targets.length > MAX_OPERATIONS_PER_PROPOSAL) revert TooManyOperations();

        uint256 feePerSpoke = msg.value / spokeChainIds.length;
        for (uint256 i = 0; i < spokeChainIds.length; i++) {
            bytes memory payload = abi.encode(
                hubProposalId,
                targets,
                values,
                calldatas,
                description,
                block.timestamp,
                block.timestamp + votingPeriod
            );
            _sendMessageOrRevert(spokeChainIds[i], payload, feePerSpoke, msg.sender);
        }
    }

    function lzReceive(uint16 srcChainId, bytes calldata, uint64, bytes calldata payload) external {
        if (msg.sender != address(bridge)) revert UnauthorizedRemote();
        if (!isHub && srcChainId != hubChainId) revert UnauthorizedRemote();

        if (isHub) {
            _receiveVotesFromSpoke(srcChainId, payload);
        } else {
            _receiveProposalFromHub(payload);
        }
    }

    function _receiveProposalFromHub(bytes calldata payload) internal {
        (
            uint256 hubProposalId,
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory calldatas,
            string memory description,
            uint256 votingStart,
            uint256 votingEnd
        ) = abi.decode(payload, (uint256, address[], uint256[], bytes[], string, uint256, uint256));

        proposalCount++;
        proposals[proposalCount] = CrossChainProposal({
            hubProposalId: hubProposalId,
            targets: targets,
            values: values,
            calldatas: calldatas,
            description: description,
            votingStart: votingStart,
            votingEnd: votingEnd,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            executed: false,
            votesRelayed: false
        });

        emit ProposalReceived(hubProposalId, proposalCount, votingStart, votingEnd);
    }

    function castVote(uint256 proposalId, uint8 support) external whenNotPaused {
        CrossChainProposal storage prop = proposals[proposalId];
        if (prop.votingStart == 0) revert ProposalNotActive();
        if (block.timestamp < prop.votingStart || block.timestamp > prop.votingEnd) revert ProposalNotActive();
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();

        hasVoted[proposalId][msg.sender] = true;

        if (support == 1) {
            prop.forVotes += 1;
        } else if (support == 0) {
            prop.againstVotes += 1;
        } else {
            prop.abstainVotes += 1;
        }

        emit VoteCast(proposalId, msg.sender, support, 1);
    }

    function relayVotesToHub(uint256 localProposalId) external payable whenNotPaused nonReentrant {
        if (isHub) revert NotSpoke();
        CrossChainProposal storage prop = proposals[localProposalId];
        if (prop.votingStart == 0) revert ProposalNotActive();
        if (block.timestamp <= prop.votingEnd) revert VotingNotEnded();
        if (prop.votesRelayed) revert VotesAlreadyRelayed();

        prop.votesRelayed = true;

        bytes memory payload = abi.encode(
            prop.hubProposalId,
            localChainId,
            prop.forVotes,
            prop.againstVotes,
            prop.abstainVotes
        );
        _sendMessageOrRevert(hubChainId, payload, msg.value, msg.sender);

        emit VotesRelayed(prop.hubProposalId, hubChainId, prop.forVotes, prop.againstVotes, prop.abstainVotes);
    }

    function _receiveVotesFromSpoke(uint16 /* srcChainId */, bytes calldata payload) internal {
        (
            uint256 hubProposalId,
            uint16 spokeChainId,
            uint256 forVotes,
            uint256 againstVotes,
            uint256 abstainVotes
        ) = abi.decode(payload, (uint256, uint16, uint256, uint256, uint256));

        emit VotesRelayed(hubProposalId, spokeChainId, forVotes, againstVotes, abstainVotes);
    }

    function execute(uint256 proposalId) external onlyRole(EXECUTOR_ROLE) nonReentrant whenNotPaused {
        CrossChainProposal storage prop = proposals[proposalId];
        if (prop.executed) revert AlreadyExecuted();
        if (prop.votingStart == 0) revert ProposalNotActive();
        if (block.timestamp <= prop.votingEnd) revert VotingNotEnded();
        if (prop.targets.length == 0 || prop.targets.length != prop.values.length || prop.targets.length != prop.calldatas.length) {
            revert InvalidProposalState();
        }
        if (prop.targets.length > MAX_OPERATIONS_PER_PROPOSAL) revert TooManyOperations();

        prop.executed = true;

        for (uint256 i = 0; i < prop.targets.length; i++) {
            (bool success, ) = prop.targets[i].call{value: prop.values[i]}(prop.calldatas[i]);
            if (!success) revert MessageDeliveryFailed();
        }

        emit ProposalExecuted(proposalId);
    }

    function getProposal(uint256 proposalId)
        external
        view
        returns (
            uint256 hubProposalId,
            uint256 votingStart,
            uint256 votingEnd,
            uint256 forVotes,
            uint256 againstVotes,
            uint256 abstainVotes,
            bool executed
        )
    {
        CrossChainProposal storage prop = proposals[proposalId];
        return (
            prop.hubProposalId,
            prop.votingStart,
            prop.votingEnd,
            prop.forVotes,
            prop.againstVotes,
            prop.abstainVotes,
            prop.executed
        );
    }

    function isVotingActive(uint256 proposalId) external view returns (bool) {
        CrossChainProposal storage prop = proposals[proposalId];
        return prop.votingStart > 0 &&
               block.timestamp >= prop.votingStart &&
               block.timestamp <= prop.votingEnd;
    }

    function getSpokeCount() external view returns (uint256) {
        return spokeChainIds.length;
    }
}
```

## Contract: ERC20Mock.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    constructor(string memory tokenName, string memory tokenSymbol, uint256 initialSupply)
        ERC20(tokenName, tokenSymbol)
    {
        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
```

## Contract: ICrossChainBridge.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

error UnauthorizedRemote();
error InvalidChainId();
error InvalidPayload();
error MessageAlreadyProcessed();
error MessageDeliveryFailed();

interface ICrossChainBridge {
    event MessageSent(uint16 indexed dstChainId, bytes32 indexed messageId, bytes payload);
    event MessageReceived(uint16 indexed srcChainId, bytes32 indexed messageId, bytes payload);
    event TrustedRemoteSet(uint16 indexed chainId, bytes remoteAddress);

    function sendMessage(uint16 dstChainId, bytes calldata payload, address refundAddress) external payable returns (bytes32 messageId);

    function estimateFees(uint16 dstChainId, bytes calldata payload) external view returns (uint256 nativeFee);

    function setTrustedRemote(uint16 chainId, bytes calldata remoteAddress) external;

    function getTrustedRemote(uint16 chainId) external view returns (bytes memory);

    function lzEndpoint() external view returns (address);
}
```

## Contract: LayerZeroBridge.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ICrossChainBridge.sol";

contract LayerZeroBridge is ICrossChainBridge, Ownable, ReentrancyGuard {
    address public immutable override lzEndpoint;
    uint16 public immutable localChainId;

    mapping(uint16 => bytes) public trustedRemotes;
    mapping(bytes32 => bool) public processedMessages;
    uint256 private _nonce;

    uint256 public minGasLimit = 200000;

    event GasLimitUpdated(uint256 newGasLimit);

    constructor(address _lzEndpoint, uint16 _localChainId) Ownable(msg.sender) {
        require(_lzEndpoint != address(0), "Invalid endpoint");
        require(_localChainId != 0, "Invalid chain ID");
        lzEndpoint = _lzEndpoint;
        localChainId = _localChainId;
    }

    function sendMessage(uint16 dstChainId, bytes calldata payload, address refundAddress)
        external
        payable
        override
        nonReentrant
        returns (bytes32 messageId)
    {
        if (dstChainId == 0) revert InvalidChainId();
        if (trustedRemotes[dstChainId].length == 0) revert UnauthorizedRemote();
        require(refundAddress != address(0), "Invalid refund address");

        messageId = keccak256(abi.encodePacked(localChainId, dstChainId, _nonce++, payload));

        bytes memory lzPacket = abi.encodePacked(
            trustedRemotes[dstChainId],
            uint64(_nonce),
            uint8(1),
            uint16(payload.length),
            payload
        );

        (bool success, ) = lzEndpoint.call{value: msg.value}(
            abi.encodeWithSignature(
                "send(uint16,bytes,uint256,address,bytes,uint256)",
                dstChainId,
                trustedRemotes[dstChainId],
                minGasLimit,
                refundAddress,
                lzPacket,
                msg.value
            )
        );
        if (!success) revert MessageDeliveryFailed();

        emit MessageSent(dstChainId, messageId, payload);
        return messageId;
    }

    function lzReceive(uint16 srcChainId, bytes calldata srcAddress, uint64, bytes calldata payload) external {
        if (msg.sender != lzEndpoint) revert UnauthorizedRemote();

        bytes memory expectedAddress = trustedRemotes[srcChainId];
        if (expectedAddress.length == 0 || keccak256(expectedAddress) != keccak256(srcAddress)) {
            revert UnauthorizedRemote();
        }

        bytes32 messageId = keccak256(abi.encodePacked(srcChainId, localChainId, payload));
        if (processedMessages[messageId]) revert MessageAlreadyProcessed();
        processedMessages[messageId] = true;

        emit MessageReceived(srcChainId, messageId, payload);
    }

    function estimateFees(uint16 /* dstChainId */, bytes calldata payload) external view override returns (uint256) {
        uint256 baseGas = 21000;
        uint256 payloadGas = payload.length * 16;
        uint256 totalGas = baseGas + payloadGas + minGasLimit;
        return totalGas * tx.gasprice;
    }

    function setTrustedRemote(uint16 chainId, bytes calldata remoteAddress) external override onlyOwner {
        trustedRemotes[chainId] = remoteAddress;
        emit TrustedRemoteSet(chainId, remoteAddress);
    }

    function getTrustedRemote(uint16 chainId) external view override returns (bytes memory) {
        return trustedRemotes[chainId];
    }

    function setMinGasLimit(uint256 _minGasLimit) external onlyOwner {
        minGasLimit = _minGasLimit;
        emit GasLimitUpdated(_minGasLimit);
    }

    function withdrawNative(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid recipient");
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert MessageDeliveryFailed();
    }
}
```

## Contract: MockCrossChainBridge.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ICrossChainBridge.sol";

contract MockCrossChainBridge is ICrossChainBridge, AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    mapping(uint16 => bytes) public trustedRemotes;
    mapping(bytes32 => bool) public processedMessages;
    uint256 private _messageCounter;

    uint16 public immutable localChainId;
    address public immutable override lzEndpoint;
    address public immutable admin;

    receive() external payable {}

    constructor(uint16 _localChainId) {
        localChainId = _localChainId;
        lzEndpoint = address(this);
        admin = msg.sender;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    function sendMessage(uint16 dstChainId, bytes calldata payload, address) external payable override returns (bytes32 messageId) {
        if (dstChainId == 0) revert InvalidChainId();
        messageId = keccak256(abi.encodePacked(block.chainid, _messageCounter++, payload));
        emit MessageSent(dstChainId, messageId, payload);
        return messageId;
    }

    function deliverMessage(address target, uint16 srcChainId, bytes32 messageId, bytes calldata payload) external {
        require(target != address(0), "Invalid target");
        if (processedMessages[messageId]) revert MessageAlreadyProcessed();
        processedMessages[messageId] = true;
        emit MessageReceived(srcChainId, messageId, payload);
        (bool success, ) = target.call(abi.encodeWithSignature("lzReceive(uint16,bytes,uint64,bytes)", srcChainId, abi.encodePacked(address(this)), 0, payload));
        if (!success) revert MessageDeliveryFailed();
    }

    function estimateFees(uint16, bytes calldata) external pure override returns (uint256) {
        return 0;
    }

    function setTrustedRemote(uint16 chainId, bytes calldata remoteAddress) external override onlyRole(ADMIN_ROLE) {
        trustedRemotes[chainId] = remoteAddress;
        emit TrustedRemoteSet(chainId, remoteAddress);
    }

    function getTrustedRemote(uint16 chainId) external view override returns (bytes memory) {
        return trustedRemotes[chainId];
    }

    function withdrawNative(uint256 amount) external onlyRole(ADMIN_ROLE) {
        (bool success, ) = payable(admin).call{value: amount}("");
        if (!success) revert MessageDeliveryFailed();
    }
}
```

## Contract: ResurgeBridgeToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ICrossChainBridge.sol";

error InsufficientBridgeReserve();
error InsufficientAmount();
error TokenTransferFailed();
error BridgeNotAuthorized();
error WithdrawalAlreadyProcessed();
error InvalidMessageId();

contract ResurgeBridgeToken is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant BRIDGE_MANAGER_ROLE = keccak256("BRIDGE_MANAGER_ROLE");

    ICrossChainBridge public immutable bridge;
    IERC20 public immutable resurgeToken;
    uint16 public immutable localChainId;

    uint256 public totalLocked;
    uint256 public totalUnlocked;

    mapping(bytes32 => bool) public processedWithdrawals;
    mapping(address => uint256) public lockedBalances;

    event TokensLocked(address indexed from, uint256 amount, uint16 indexed dstChainId, bytes32 indexed transferId);
    event TokensUnlocked(address indexed to, uint256 amount, bytes32 indexed transferId);
    event TokensBridgedIn(address indexed to, uint256 amount, uint16 indexed srcChainId, bytes32 indexed transferId);

    constructor(address _bridge, address _resurgeToken, uint16 _localChainId) {
        bridge = ICrossChainBridge(_bridge);
        resurgeToken = IERC20(_resurgeToken);
        localChainId = _localChainId;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(BRIDGE_MANAGER_ROLE, msg.sender);
    }

    function bridgeTokensTo(uint16 dstChainId, uint256 amount, address recipient) external payable whenNotPaused nonReentrant {
        if (amount == 0) revert InsufficientAmount();
        if (recipient == address(0)) revert InsufficientAmount();

        bytes32 transferId = keccak256(abi.encodePacked(block.chainid, msg.sender, amount, dstChainId, block.timestamp, block.number));

        lockedBalances[msg.sender] += amount;
        totalLocked += amount;
        if (!resurgeToken.transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();

        emit TokensLocked(msg.sender, amount, dstChainId, transferId);

        bytes memory payload = abi.encode(transferId, amount, recipient);
        bytes32 messageId = bridge.sendMessage{value: msg.value}(dstChainId, payload, msg.sender);
        if (uint256(messageId) < 1) revert InvalidMessageId();
    }

    function bridgeTokensFrom(uint16 srcChainId, bytes32 transferId, uint256 amount, address recipient) public nonReentrant {
        if (msg.sender != address(bridge)) revert BridgeNotAuthorized();
        if (processedWithdrawals[transferId]) revert WithdrawalAlreadyProcessed();

        processedWithdrawals[transferId] = true;

        if (lockedBalances[address(this)] >= amount) {
            lockedBalances[address(this)] -= amount;
            totalLocked -= amount;
        }

        totalUnlocked += amount;
        if (!resurgeToken.transfer(recipient, amount)) revert TokenTransferFailed();

        emit TokensBridgedIn(recipient, amount, srcChainId, transferId);
    }

    function lzReceive(uint16 srcChainId, bytes calldata, uint64, bytes calldata payload) external {
        if (msg.sender != address(bridge)) revert UnauthorizedRemote();

        (bytes32 transferId, uint256 amount, address recipient) = abi.decode(payload, (bytes32, uint256, address));
        bridgeTokensFrom(srcChainId, transferId, amount, recipient);
    }

    function depositReserve(uint256 amount) external onlyRole(BRIDGE_MANAGER_ROLE) nonReentrant {
        lockedBalances[address(this)] += amount;
        totalLocked += amount;
        if (!resurgeToken.transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();
    }

    function withdrawReserve(uint256 amount) external onlyRole(BRIDGE_MANAGER_ROLE) nonReentrant {
        if (lockedBalances[address(this)] < amount) revert InsufficientBridgeReserve();
        lockedBalances[address(this)] -= amount;
        totalLocked -= amount;
        if (!resurgeToken.transfer(msg.sender, amount)) revert TokenTransferFailed();
    }

    function getBridgeReserve() external view returns (uint256) {
        return lockedBalances[address(this)];
    }

    function estimateBridgeFee(uint16 dstChainId, uint256 amount, address recipient) external view returns (uint256) {
        bytes memory payload = abi.encode(bytes32(0), amount, recipient);
        return bridge.estimateFees(dstChainId, payload);
    }
}
```

## Tests: CrossChain.test.js

```javascript
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
```
