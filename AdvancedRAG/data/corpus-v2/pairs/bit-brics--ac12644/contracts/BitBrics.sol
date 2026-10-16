// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BitBrics Real Estate Income Token (ERC1155, KYC, Pausable, Admin Transfer)
/// @author BitBrics
/// @notice Fractional real estate income token with max supply, KYC, pause, backend controls, and admin recovery

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract BitBricsERC1155 is ERC1155Supply, Ownable, Pausable {
    address public backendOperator;
    mapping(address => bool) public isKYCApproved;
    mapping(uint256 => uint256) public maxSupply;
    mapping(uint256 => bool) public isMaxSupplySet;

    event BackendOperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event KYCStatusUpdated(address indexed user, bool approved);
    event MaxSupplySet(uint256 indexed propertyId, uint256 maxSupply);
    event AdminForceTransfer(address indexed from, address indexed to, uint256 indexed tokenId, uint256 amount, string reason);

    /// @dev Only backend operator or owner
    modifier onlyBackendOrOwner() {
        require(
            msg.sender == backendOperator || msg.sender == owner(),
            "Not backend or owner"
        );
        _;
    }
    modifier supplySet(uint256 id) {
        require(isMaxSupplySet[id], "Max supply not set");
        _;
    }

    constructor(string memory uri_, address initialOwner) ERC1155(uri_) Ownable(initialOwner) {
        backendOperator = msg.sender;
    }

    /// @notice Owner: update metadata base URI (applies to all tokens)
    function setURI(string memory newuri) external onlyOwner {
        _setURI(newuri);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function setBackendOperator(address newOperator) external onlyOwner {
        emit BackendOperatorUpdated(backendOperator, newOperator);
        backendOperator = newOperator;
    }
    /// @notice Backend or Owner: set KYC status for an address
    function setKYC(address user, bool approved) external onlyBackendOrOwner {
        isKYCApproved[user] = approved;
        emit KYCStatusUpdated(user, approved);
    }
    function setMaxSupply(uint256 id, uint256 _maxSupply) external onlyOwner {
        require(!isMaxSupplySet[id], "Max supply already set");
        require(_maxSupply > 0, "Supply must be positive");
        maxSupply[id] = _maxSupply;
        isMaxSupplySet[id] = true;
        emit MaxSupplySet(id, _maxSupply);
    }
    /// @notice Backend or Owner: mint tokens to KYC’d user (respects max supply)
    function mint(address to, uint256 id, uint256 amount, bytes memory data)
        external onlyBackendOrOwner whenNotPaused supplySet(id)
    {
        require(isKYCApproved[to], "KYC required");
        require(totalSupply(id) + amount <= maxSupply[id], "Exceeds property supply");
        _mint(to, id, amount, data);
    }
    /// @notice Backend or Owner: batch mint
    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        external onlyBackendOrOwner whenNotPaused
    {
        require(isKYCApproved[to], "KYC required");
        for (uint256 i = 0; i < ids.length; ++i) {
            require(isMaxSupplySet[ids[i]], "Supply not set");
            require(totalSupply(ids[i]) + amounts[i] <= maxSupply[ids[i]], "Exceeds property supply");
        }
        _mintBatch(to, ids, amounts, data);
    }
    /// @notice Backend or Owner: platform transfer (resale, exit, etc.)
    function platformTransfer(address from, address to, uint256 id, uint256 amount, bytes memory data)
        external onlyBackendOrOwner whenNotPaused supplySet(id)
    {
        require(isKYCApproved[from] && isKYCApproved[to], "KYC required");
        _safeTransferFrom(from, to, id, amount, data);
    }
    /// @notice Backend or Owner: batch platform transfer
    function platformBatchTransfer(address from, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        external onlyBackendOrOwner whenNotPaused
    {
        require(isKYCApproved[from] && isKYCApproved[to], "KYC required");
        for (uint256 i = 0; i < ids.length; ++i) require(isMaxSupplySet[ids[i]], "Supply not set");
        _safeBatchTransferFrom(from, to, ids, amounts, data);
    }
    function adminForceTransfer(address from, address to, uint256 id, uint256 amount, string calldata reason)
        external onlyOwner whenNotPaused supplySet(id)
    {
        _safeTransferFrom(from, to, id, amount, "");
        emit AdminForceTransfer(from, to, id, amount, reason);
    }
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        if (from != address(0) && to != address(0)) {
            require(
                msg.sender == backendOperator || msg.sender == owner(),
                "Only backend/operator can transfer"
            );
            require(isKYCApproved[from] && isKYCApproved[to], "KYC required");
        }
        super._update(from, to, ids, values);
    }
    function setApprovalForAll(address, bool) public pure override { revert("Approvals disabled"); }
    function isApprovedForAll(address, address) public pure override returns (bool) { return false; }
}
