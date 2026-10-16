// SPDX-License-Identifier: MIT
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./IWhiteList.sol";
import "./EIP3009.sol";

pragma solidity ^0.8.20;

contract ReitToken is ERC2771Context, ERC20Pausable, EIP3009, AccessControl {

    IWhiteList private _whiteList;
    bool private _activatedTransferWhitelisting;

    //--------------------------ROLES-----------------------------------
    bytes32 public constant MANAGER = keccak256("MANAGER");
    bytes32 public constant MASTER_ROLE = keccak256("MASTER_ROLE");
    //-------------------------------------------------------------------

    constructor(
        string memory reitName_,
        string memory reitSymbol_,
        IWhiteList whiteList_,
        address trustedForwarder_,
        bool activatedTransferWhitelisting_
    ) ERC2771Context(trustedForwarder_) ERC20(reitName_, reitSymbol_) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(MANAGER, _msgSender());
        _grantRole(MASTER_ROLE, _msgSender());
        _whiteList = whiteList_;
        DOMAIN_SEPARATOR = EIP712.makeDomainSeparator(reitName_, "1");
        _activatedTransferWhitelisting = activatedTransferWhitelisting_;
    }

    function activatedTransferWhitelisting() external view returns (bool) {
        return _activatedTransferWhitelisting;
    }

    function setActivationOfWhitelist(bool value) external onlyRole(MASTER_ROLE) {
        _activatedTransferWhitelisting = value;
    }

    function pause() external virtual onlyRole(MASTER_ROLE) {
        super._pause();
    }

    function whiteList() external view returns (IWhiteList) {
        return _whiteList;
    }

    function unpause() external virtual onlyRole(MASTER_ROLE) {
        super._unpause();
    }

    function mint(address account, uint256 value) external onlyRole(MANAGER) {
        _mint(account, value);
    }

    function burn(address account, uint256 value) external onlyRole(MANAGER) {
        _burn(account, value);
    }

    function _update(
        address from,
        address to,
        uint256 amount
    )
    internal
    virtual
    override(ERC20, ERC20Pausable)
    whenNotPaused
    {
        if (_activatedTransferWhitelisting) {
            if (from == address(0)) {
                require(
                    _whiteList.isAddressWhiteListed(to),
                    "The 'to' address should be white listed"
                );
            } else if (to == address(0)) {
                require(
                    _whiteList.isAddressWhiteListed(from),
                    "The 'from' address should be white listed"
                );
            } else {
                require(
                    _whiteList.isAddressWhiteListed(from),
                    "The 'from' address should be white listed"
                );
                require(
                    _whiteList.isAddressWhiteListed(to),
                    "The 'to' address should be white listed"
                );
            }
        }
        super._update(from, to, amount);
    }


    function _msgSender() internal view virtual override(Context, ERC2771Context)
        returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view virtual override(Context, ERC2771Context)
        returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view virtual override(Context, ERC2771Context) 
        returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused {
        _transferWithAuthorization(
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused {
        _receiveWithAuthorization(
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
    }

    function cancelAuthorization(
        address authorizer,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused {
        _cancelAuthorization(authorizer, nonce, v, r, s);
    }


}