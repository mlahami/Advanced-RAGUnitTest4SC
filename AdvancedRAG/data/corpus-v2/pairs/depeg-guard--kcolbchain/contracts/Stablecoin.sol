// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title Stablecoin
 * @notice Core stablecoin ERC-20 with mint/burn, pause, blacklist, and EIP-2612 permit.
 * @dev Part of kcolbchain/stablecoin-toolkit
 */
contract Stablecoin is ERC20, ERC20Burnable, ERC20Pausable, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");

    mapping(address => bool) private _blacklisted;

    event Blacklisted(address indexed account);
    event Unblacklisted(address indexed account);

    error AccountBlacklisted(address account);

    constructor(
        string memory name_,
        string memory symbol_,
        address admin
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(BLACKLISTER_ROLE, admin);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (_blacklisted[to]) revert AccountBlacklisted(to);
        _mint(to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function blacklist(address account) external onlyRole(BLACKLISTER_ROLE) {
        _blacklisted[account] = true;
        emit Blacklisted(account);
    }

    function unblacklist(address account) external onlyRole(BLACKLISTER_ROLE) {
        _blacklisted[account] = false;
        emit Unblacklisted(account);
    }

    function isBlacklisted(address account) external view returns (bool) {
        return _blacklisted[account];
    }

    function decimals() public pure override returns (uint8) {
        return 6; // USDC-style 6 decimals
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Pausable) {
        if (_blacklisted[from]) revert AccountBlacklisted(from);
        if (_blacklisted[to]) revert AccountBlacklisted(to);
        super._update(from, to, value);
    }
}
