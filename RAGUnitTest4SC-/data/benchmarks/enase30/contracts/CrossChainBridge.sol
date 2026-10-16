// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CrossChainBridge
 * @notice Lock-and-mint bridge skeleton.
 *         - Source chain: lock ERC20, emit Locked event (relayer picks it up)
 *         - Destination chain: relayer calls mint() with signature from M-of-N validators
 *         Both sides are in this single contract for benchmarking purposes.
 * Complexity: Complex
 */
interface IMintable {
    function mint(address to, uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
}

contract CrossChainBridge {
    struct BridgeRequest {
        address sender;
        address recipient;
        uint256 amount;
        uint256 targetChainId;
        bool    processed;
    }

    address public owner;
    IMintable public token;

    uint256 public requiredSignatures;
    mapping(address => bool) public isValidator;
    address[] public validators;

    uint256 public nonce;
    mapping(bytes32 => BridgeRequest) public requests;
    mapping(bytes32 => mapping(address => bool)) public hasValidated;
    mapping(bytes32 => uint256) public validationCount;

    uint256 public bridgeFee; // wei
    uint256 public collectedFees;

    event Locked(bytes32 indexed requestId, address indexed sender, address recipient, uint256 amount, uint256 targetChainId);
    event Minted(bytes32 indexed requestId, address indexed recipient, uint256 amount);
    event ValidatorAdded(address validator);
    event ValidatorRemoved(address validator);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyValidator() { require(isValidator[msg.sender], "Not validator"); _; }

    constructor(address _token, uint256 _requiredSignatures, uint256 _bridgeFee) {
        owner              = msg.sender;
        token              = IMintable(_token);
        requiredSignatures = _requiredSignatures;
        bridgeFee          = _bridgeFee;
    }

    // â”€â”€â”€ Source chain: lock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function lock(address recipient, uint256 amount, uint256 targetChainId) external payable returns (bytes32 requestId) {
        require(msg.value >= bridgeFee, "Insufficient fee");
        require(amount > 0, "Zero amount");
        require(recipient != address(0), "Zero recipient");

        collectedFees += msg.value;
        token.burnFrom(msg.sender, amount); // burn on source = lock

        requestId = keccak256(abi.encodePacked(msg.sender, recipient, amount, targetChainId, nonce++));
        requests[requestId] = BridgeRequest({
            sender:        msg.sender,
            recipient:     recipient,
            amount:        amount,
            targetChainId: targetChainId,
            processed:     false
        });

        emit Locked(requestId, msg.sender, recipient, amount, targetChainId);
    }

    // â”€â”€â”€ Destination chain: validate + mint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function validate(bytes32 requestId) external onlyValidator {
        BridgeRequest storage req = requests[requestId];
        require(!req.processed, "Already processed");
        require(!hasValidated[requestId][msg.sender], "Already validated");

        hasValidated[requestId][msg.sender] = true;
        validationCount[requestId]++;

        if (validationCount[requestId] >= requiredSignatures) {
            req.processed = true;
            token.mint(req.recipient, req.amount);
            emit Minted(requestId, req.recipient, req.amount);
        }
    }

    // â”€â”€â”€ Admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function addValidator(address v) external onlyOwner {
        require(!isValidator[v], "Already validator");
        isValidator[v] = true;
        validators.push(v);
        emit ValidatorAdded(v);
    }

    function removeValidator(address v) external onlyOwner {
        require(isValidator[v], "Not validator");
        isValidator[v] = false;
        emit ValidatorRemoved(v);
    }

    function setRequiredSignatures(uint256 n) external onlyOwner {
        require(n > 0 && n <= validators.length, "Invalid threshold");
        requiredSignatures = n;
    }

    function withdrawFees() external onlyOwner {
        uint256 amount = collectedFees;
        collectedFees = 0;
        (bool ok,) = owner.call{value: amount}("");
        require(ok, "Transfer failed");
    }

    function validatorCount() external view returns (uint256) { return validators.length; }
}

