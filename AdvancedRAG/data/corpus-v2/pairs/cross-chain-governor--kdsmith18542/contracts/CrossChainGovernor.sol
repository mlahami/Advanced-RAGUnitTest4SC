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
