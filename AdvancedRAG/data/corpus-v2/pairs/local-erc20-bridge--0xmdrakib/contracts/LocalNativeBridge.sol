// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract LocalNativeBridge {
    uint32 public immutable localDomain;
    uint32 public immutable remoteDomain;
    address public owner;
    bool public paused;
    uint256 public outboundNonce;
    uint256 public inboundNonce;
    mapping(bytes32 => bool) public processedMessages;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event Funded(address indexed account, uint256 amount);
    event EmergencyWithdrawal(address indexed to, uint256 amount);
    event TransferRemote(
        bytes32 indexed messageId,
        uint256 indexed nonce,
        uint32 indexed destinationDomain,
        address sender,
        bytes32 recipient,
        uint256 amount
    );
    event ReceivedRemote(
        bytes32 indexed messageId,
        uint256 nonce,
        uint32 indexed originDomain,
        bytes32 indexed remoteSender,
        address recipient,
        uint256 amount
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "LocalNativeBridge: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "LocalNativeBridge: paused");
        _;
    }

    constructor(uint32 localDomain_, uint32 remoteDomain_, address owner_) payable {
        require(owner_ != address(0), "LocalNativeBridge: zero owner");
        localDomain = localDomain_;
        remoteDomain = remoteDomain_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
        if (msg.value > 0) emit Funded(msg.sender, msg.value);
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function fund() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "LocalNativeBridge: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function emergencyWithdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "LocalNativeBridge: zero recipient");
        require(address(this).balance >= amount, "LocalNativeBridge: insufficient liquidity");
        (bool ok, ) = to.call{ value: amount }("");
        require(ok, "LocalNativeBridge: withdraw failed");
        emit EmergencyWithdrawal(to, amount);
    }

    function quoteGasPayment(uint32 destinationDomain) external view returns (uint256) {
        require(destinationDomain == remoteDomain, "LocalNativeBridge: bad domain");
        return 0;
    }

    function transferRemote(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 amount
    ) external payable whenNotPaused returns (bytes32 messageId) {
        require(destinationDomain == remoteDomain, "LocalNativeBridge: bad domain");
        require(amount > 0, "LocalNativeBridge: zero amount");
        require(msg.value == amount, "LocalNativeBridge: amount/value mismatch");
        require(recipient != bytes32(0), "LocalNativeBridge: zero recipient");

        outboundNonce += 1;
        messageId = keccak256(
            abi.encodePacked(
                address(this),
                block.chainid,
                localDomain,
                destinationDomain,
                msg.sender,
                recipient,
                amount,
                outboundNonce
            )
        );
        emit TransferRemote(messageId, outboundNonce, destinationDomain, msg.sender, recipient, amount);
    }

    function receiveRemote(
        bytes32 messageId,
        bytes32 remoteSender,
        address payable recipient,
        uint256 amount
    ) external onlyOwner whenNotPaused {
        require(!processedMessages[messageId], "LocalNativeBridge: already processed");
        require(recipient != address(0), "LocalNativeBridge: zero recipient");
        require(amount > 0, "LocalNativeBridge: zero amount");
        require(address(this).balance >= amount, "LocalNativeBridge: insufficient liquidity");
        processedMessages[messageId] = true;

        (bool ok, ) = recipient.call{ value: amount }("");
        require(ok, "LocalNativeBridge: release failed");

        inboundNonce += 1;
        emit ReceivedRemote(messageId, inboundNonce, remoteDomain, remoteSender, recipient, amount);
    }
}
