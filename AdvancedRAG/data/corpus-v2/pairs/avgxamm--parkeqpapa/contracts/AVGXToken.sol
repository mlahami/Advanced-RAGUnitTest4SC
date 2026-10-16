
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit, Nonces, IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAVGXToken} from "./IAVGXToken.sol";
import {Roles} from "./Roles.sol";

/**
 * @title AVGXToken
 * @dev AVGX ERC20 token with governance, permits, and access control
 * @notice The native token of the AVGX protocol representing the synthetic index
 */
contract AVGXToken is ERC20, ERC20Permit, ERC20Votes, ERC20Burnable, ERC20Pausable, AccessControl, IAVGXToken {
    using Roles for address;

    uint256 private _maxSupplyAVGX;
    bool private _maxSupplySet;

    /**
     * @dev Constructor initializes the token
     * @param accessController Address of the access controller
     */
    constructor(address accessController) 
        ERC20("AVGX", "AVGX") 
        ERC20Permit("AVGX") 
    {
        accessController.validateAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, accessController);
    }

    /**
     * @dev Mints tokens to specified address
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyRole(Roles.MINTER_ROLE) {
        to.validateAddress();
        
        if (_maxSupplySet && totalSupply() + amount > _maxSupplyAVGX) {
            revert MaxSupplyExceeded();
        }
        
        _mint(to, amount);
        emit Minted(to, amount);
    }

    /**
     * @dev Burns tokens from specified address with allowance check
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burnFrom(address from, uint256 amount) public override(ERC20Burnable, IAVGXToken) {
        if (!hasRole(Roles.MINTER_ROLE, _msgSender())) {
            _spendAllowance(from, _msgSender(), amount);
        }
        _burn(from, amount);
        emit Burned(from, amount);
    }

    /**
     * @dev Sets maximum supply (can only be called once)
     * @param maxSupply_ Maximum supply limit
     */
    function setMaxSupply(uint256 maxSupply_) external onlyRole(Roles.GOVERNOR_ROLE) {
        if (_maxSupplySet) revert MaxSupplyAlreadySet();
        _maxSupplyAVGX = maxSupply_;
        _maxSupplySet = true;
        emit MaxSupplySet(maxSupply_);
    }

    /**
     * @dev Returns the maximum supply
     * @return Maximum supply limit
     */
    function maxSupplyAVGX() external view returns (uint256) {
        return _maxSupplyAVGX;
    }

    /**
     * @dev Pauses all token transfers
     */
    function pause() external onlyRole(Roles.PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses all token transfers
     */
    function unpause() external onlyRole(Roles.PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Returns the number of decimals
     * @return Number of decimals (18)
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    // Required overrides for multiple inheritance
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces, IERC20Permit)
        returns (uint256)
    {
        return super.nonces(owner);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function MINTER_ROLE() public pure returns (bytes32) {
        return Roles.MINTER_ROLE;
    }

    function GOVERNOR_ROLE() public pure returns (bytes32) {
        return Roles.GOVERNOR_ROLE;
    }

    function PAUSER_ROLE() public pure returns (bytes32) {
        return Roles.PAUSER_ROLE;
    }
}
