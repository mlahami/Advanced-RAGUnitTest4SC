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
