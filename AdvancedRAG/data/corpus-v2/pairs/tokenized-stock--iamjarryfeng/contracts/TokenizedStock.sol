// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract TokenizedStock is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    uint256 public totalAuthorizedSupply;
    mapping(address => bool) public whitelist;

    event WhitelistUpdated(address indexed account, bool status);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory,
        uint256 authorizedSupply_
    ) ERC20(name_, symbol_) {
        totalAuthorizedSupply = authorizedSupply_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(COMPLIANCE_ROLE, msg.sender);
        whitelist[msg.sender] = true;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(
            totalSupply() + amount <= totalAuthorizedSupply,
            "TokenizedStock: Exceeds authorized supply"
        );
        _mint(to, amount);
    }

    function updateWhitelist(address account, bool status) external onlyRole(COMPLIANCE_ROLE) {
        whitelist[account] = status;
        emit WhitelistUpdated(account, status);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            require(
                whitelist[from] && whitelist[to],
                "TokenizedStock: Transfer not allowed - compliance check failed"
            );
        }
        super._update(from, to, amount);
    }
}
