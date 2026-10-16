// SPDX-License-Identifier: LaProp proprietary license

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

import "./IWhiteList.sol";
import "./IERC3009Partial.sol";

contract FiduciaryDuty is ERC2771Context, ERC20, Ownable {

    error SenderNotWhitelisted(address sender);
    error BeneficiaryNotWhitelisted(address beneficiary);
    error RaiseCanceled();
    error InvalidValue(uint256 provided, uint256 expected);
    error InsufficientBalance(address account, uint256 available, uint256 required);
    error InvalidTransferDestination();
    error InvalidUnitAmount();
    error ExceedsAvailableSupply();
    error ViablePointNotReached();
    error ViablePointAlreadyReached();
    error NoRefundAvailable();
    error UnauthorizedAccess(address caller);
    error ContractPaused();
    error InvalidSignature();
    error TransferAuthorizationExpired();
    error TransferAuthorizationNotYetValid();
    error NonceAlreadyUsed();

    modifier onlyWhiteListed(address beneficiary) {
        IWhiteList whiteList = IWhiteList(_whiteListContract);
        if (!whiteList.isAddressWhiteListed(_msgSender())) {
            revert SenderNotWhitelisted(_msgSender());
        }
        if (beneficiary != _msgSender()) {
            if (!whiteList.isAddressWhiteListed(beneficiary)) {
                revert BeneficiaryNotWhitelisted(beneficiary);
            }
        }
        _;
    }

    struct Permission {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    address private _tokenStorageAddress;
    address private _managerAddress;
    address private _whiteListContract;
    uint private _sold = 0;
    bool private _viablePoint = false;
    bool private _canceledRaise = false;
    uint256 private _minimal;
    uint256 private _unit;

    event PaymentReceived(address indexed from, uint256 amount, uint256 tokens);
    event PaymentReturned(address indexed to, uint256 amount);
    event DutyWithdrawn(address indexed to, uint256 amount);
    event RaiseEnded(bool canceled);

    constructor(
        address storageCrowdToken,
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address initialManager,
        address whiteListAddress,
        address trustedForwarder,
        uint256 initialMinimal,
        uint256 initialUnit
    ) ERC2771Context(trustedForwarder) ERC20(name, symbol) Ownable(msg.sender) {
        _tokenStorageAddress = storageCrowdToken;
        _mint(address(this), initialSupply);
        _managerAddress = initialManager;
        _whiteListContract = whiteListAddress;
        _minimal = initialMinimal;
        _unit = initialUnit;
    }

    function unit() public view returns (uint){
        return _unit;
    }

    function toRaise() public view returns (uint){
        return super.totalSupply() * _unit;
    }

    function raised() public view returns (uint){
        return _sold * _unit;
    }

    function viablePoint() public view returns (bool){
        return _viablePoint;
    }

    function minimal() public view returns (uint){
        return _minimal;
    }

    function canceledRaise() public view returns (bool){
        return _canceledRaise;
    }

    function managerAddress() public view returns (address){
        return _managerAddress;
    }

    function whiteListContract() public view returns (address){
        return _whiteListContract;
    }

    function sold() public view returns (uint){
        return _sold;
    }

    function tokenStorage() public view returns (address){
        return _tokenStorageAddress;
    }

    function addForPayment(
        Permission calldata permission,
        address beneficiary
    ) external onlyWhiteListed(beneficiary) {
        require(!_canceledRaise, "The raise was canceled. No more payments allowed");
        require(permission.value > 0, "Value should be greater than 0");
        require(
            permission.value <= ERC20(_tokenStorageAddress).balanceOf(permission.from),
            "Insufficient balance for transfer"
        );
        if (permission.to != address(this))
            revert InvalidTransferDestination();
        
        if (block.timestamp < permission.validAfter) 
            revert TransferAuthorizationNotYetValid();
        if (block.timestamp > permission.validBefore) 
            revert TransferAuthorizationExpired();

        if (
            permission.value %
            (10 ** ERC20(_tokenStorageAddress).decimals()) !=
            0
        ) revert InvalidUnitAmount();

        uint unitTransfer = permission.value / (10 ** ERC20(_tokenStorageAddress).decimals());
        if (unitTransfer % _unit != 0) revert InvalidUnitAmount();
        
        uint transferAmount = unitTransfer / _unit;
        if (_sold + transferAmount > super.totalSupply())
            revert ExceedsAvailableSupply();

        _sold = _sold + transferAmount;

        try IERC3009Partial(_tokenStorageAddress).transferWithAuthorization(
            permission.from,
            permission.to,
            permission.value,
            permission.validAfter,
            permission.validBefore,
            permission.nonce,
            permission.v,
            permission.r,
            permission.s
        ) {
            _transfer(address(this), beneficiary, transferAmount);

            if (_sold >= ((super.totalSupply() * _minimal) / 100)) {
                _viablePoint = true;
            }

            emit PaymentReceived(beneficiary, permission.value, transferAmount);
        } catch Error(string memory reason) {
            revert(reason);
        } catch {
            revert InvalidSignature();
        }
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function cancelRaise() external onlyOwner {
        _canceledRaise = true;
        _viablePoint = false;
        emit RaiseEnded(true);
    }

    function withdrawForDuty() external onlyOwner {
        if (_canceledRaise) revert RaiseCanceled();
        if (!_viablePoint) revert ViablePointNotReached();
        
        uint wholeAmount = ERC20(_tokenStorageAddress).balanceOf(address(this));
        ERC20(_tokenStorageAddress).transfer(_managerAddress, wholeAmount);
        emit DutyWithdrawn(_managerAddress, wholeAmount);
    }

    function withdrawPayment() external onlyWhiteListed(_msgSender()) {
        if (!_canceledRaise && _viablePoint) revert ViablePointAlreadyReached();
        
        uint refund = balanceOf(_msgSender());
        if (refund == 0) revert NoRefundAvailable();
        
        _sold = _sold - refund;
        _burn(_msgSender(), refund);
        _mint(address(this), refund);
        uint256 refundAmount = refund * _unit * 10 ** ERC20(_tokenStorageAddress).decimals();
        ERC20(_tokenStorageAddress).transfer(_msgSender(), refundAmount);
        emit PaymentReturned(_msgSender(), refundAmount);
    }

    function _msgSender() internal view virtual override(Context, ERC2771Context)
        returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view virtual override(Context, ERC2771Context)
        returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view virtual override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}