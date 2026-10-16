// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILocalBridgeToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

contract LocalERC20Bridge {
    enum Mode {
        LockRelease,
        BurnMint
    }

    address public immutable token;
    uint32 public immutable localDomain;
    uint32 public immutable remoteDomain;
    Mode public immutable mode;
    address public owner;
    bool public paused;
    uint256 public outboundNonce;
    uint256 public inboundNonce;
    mapping(bytes32 => bool) public processedMessages;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
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
        require(msg.sender == owner, "LocalERC20Bridge: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "LocalERC20Bridge: paused");
        _;
    }

    constructor(address token_, uint32 localDomain_, uint32 remoteDomain_, Mode mode_, address owner_) {
        require(token_ != address(0), "LocalERC20Bridge: zero token");
        require(owner_ != address(0), "LocalERC20Bridge: zero owner");
        token = token_;
        localDomain = localDomain_;
        remoteDomain = remoteDomain_;
        mode = mode_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "LocalERC20Bridge: zero owner");
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

    function quoteGasPayment(uint32 destinationDomain) external view returns (uint256) {
        require(destinationDomain == remoteDomain, "LocalERC20Bridge: bad domain");
        return 0;
    }

    function transferRemote(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 amount
    ) external payable whenNotPaused returns (bytes32 messageId) {
        require(destinationDomain == remoteDomain, "LocalERC20Bridge: bad domain");
        require(amount > 0, "LocalERC20Bridge: zero amount");
        require(recipient != bytes32(0), "LocalERC20Bridge: zero recipient");

        if (mode == Mode.LockRelease) {
            require(
                ILocalBridgeToken(token).transferFrom(msg.sender, address(this), amount),
                "LocalERC20Bridge: lock failed"
            );
        } else {
            ILocalBridgeToken(token).burn(msg.sender, amount);
        }

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
        address recipient,
        uint256 amount
    ) external onlyOwner whenNotPaused {
        require(!processedMessages[messageId], "LocalERC20Bridge: already processed");
        require(recipient != address(0), "LocalERC20Bridge: zero recipient");
        require(amount > 0, "LocalERC20Bridge: zero amount");
        processedMessages[messageId] = true;

        if (mode == Mode.LockRelease) {
            require(ILocalBridgeToken(token).transfer(recipient, amount), "LocalERC20Bridge: release failed");
        } else {
            ILocalBridgeToken(token).mint(recipient, amount);
        }

        inboundNonce += 1;
        emit ReceivedRemote(messageId, inboundNonce, remoteDomain, remoteSender, recipient, amount);
    }
}
