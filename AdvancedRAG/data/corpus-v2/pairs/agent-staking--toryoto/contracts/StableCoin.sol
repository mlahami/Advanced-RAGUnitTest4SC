// SPDX-License-Identifier: MIT 
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract Stablecoin is ERC20, ERC20Burnable, Ownable, EIP712 {
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    
    bytes32 private constant CANCEL_AUTHORIZATION_TYPEHASH = keccak256(
        "CancelAuthorization(address authorizer,bytes32 nonce)"
    );

    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;
    
    uint8 private _decimals;

    constructor(
        string memory name_, 
        string memory symbol_, 
        uint256 initialSupply,
        uint8 decimals_
    ) 
        ERC20(name_, symbol_)
        EIP712(name_, "2")
        Ownable(msg.sender)
    {
        _decimals = decimals_;
        _mint(msg.sender, initialSupply);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) public onlyOwner {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Amount must be positive");
        _mint(to, amount);
    }

    function authorizationState(address authorizer, bytes32 nonce) 
        external view returns (bool) 
    {
        return _authorizationStates[authorizer][nonce];
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
    ) external {
        require(block.timestamp > validAfter, "Authorization not yet valid");
        require(block.timestamp < validBefore, "Authorization expired");
        require(!_authorizationStates[from][nonce], "Authorization already used");

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == from, "Invalid signature");

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        
        _transfer(from, to, value);
    }

    function cancelAuthorization(
        address authorizer,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(!_authorizationStates[authorizer][nonce], "Authorization already used");

        bytes32 structHash = keccak256(
            abi.encode(
                CANCEL_AUTHORIZATION_TYPEHASH,
                authorizer,
                nonce
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == authorizer, "Invalid signature");

        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
    
    function getTransferWithAuthorizationTypeHash() external pure returns (bytes32) {
        return TRANSFER_WITH_AUTHORIZATION_TYPEHASH;
    }
    
    function getCancelAuthorizationTypeHash() external pure returns (bytes32) {
        return CANCEL_AUTHORIZATION_TYPEHASH;
    }
}