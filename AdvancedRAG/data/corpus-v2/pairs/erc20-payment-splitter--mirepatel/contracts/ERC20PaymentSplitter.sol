// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ERC20PaymentSplitter
 * @dev This contract allows to split ERC20 token payments among a group of accounts.
 * The sender does not need to be aware that the tokens will be split in this way, since
 * it is handled transparently by the contract.
 */
contract ERC20PaymentSplitter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event PayeeAdded(address account, uint256 shares);
    event PaymentReleased(address token, address to, uint256 amount);
    event PaymentReceived(address token, address from, uint256 amount);
    event PayeesReset();

    uint256 private _totalShares;
    uint256 private _totalReleased;

    mapping(address => uint256) private _shares;
    mapping(address => mapping(address => uint256)) private _released;
    address[] private _payees;

    /**
     * @dev Creates an instance of `ERC20PaymentSplitter` where each account in `payees` is assigned the number of shares at
     * the matching position in the `shares` array.
     *
     * All addresses in `payees` must be non-zero. Both arrays must have the same non-zero length, and there must be no
     * duplicates in `payees`.
     */
    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @dev Add a new payee to the contract.
     * @param account The address of the payee to add.
     * @param shares_ The number of shares owned by the payee.
     */
    function addPayee(address account, uint256 shares_) external onlyOwner {
        require(account != address(0), "PaymentSplitter: account is the zero address");
        require(shares_ > 0, "PaymentSplitter: shares are 0");
        require(_shares[account] == 0, "PaymentSplitter: account already has shares");

        _payees.push(account);
        _shares[account] = shares_;
        _totalShares += shares_;
        emit PayeeAdded(account, shares_);
    }

    /**
     * @dev Reset all payees. This will remove all current payees.
     */
    function resetPayees() external onlyOwner {
        for (uint256 i = 0; i < _payees.length; i++) {
            _shares[_payees[i]] = 0;
        }
        delete _payees;
        _totalShares = 0;
        emit PayeesReset();
    }

    /**
     * @dev The Ether received will be logged with {PaymentReceived} events. Note that these events are not fully
     * reliable: it's possible for a contract to receive Ether without triggering this function. This only affects the
     * reliability of the events, and not the actual splitting of Ether.
     */
    receive() external payable {
        revert("PaymentSplitter: ETH payments not supported");
    }

    /**
     * @dev Distributes an ERC20 token to all payees according to their shares.
     * @param token The ERC20 token to distribute.
     */
    function distribute(IERC20 token) external nonReentrant {
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "PaymentSplitter: no tokens to distribute");

        for (uint256 i = 0; i < _payees.length; i++) {
            address payeeAddress = _payees[i];
            uint256 payment = (balance * _shares[payeeAddress]) / _totalShares;

            if (payment > 0) {
                _released[address(token)][payeeAddress] += payment;
                emit PaymentReleased(address(token), payeeAddress, payment);
                token.safeTransfer(payeeAddress, payment);
            }
        }

        emit PaymentReceived(address(token), msg.sender, balance);
    }

    /**
     * @dev Deposit ERC20 tokens to the contract and distribute them immediately.
     * @param token The ERC20 token to deposit and distribute.
     * @param amount The amount of tokens to deposit.
     */
    function depositAndDistribute(IERC20 token, uint256 amount) external nonReentrant {
        require(amount > 0, "PaymentSplitter: amount must be greater than 0");
        require(_payees.length > 0, "PaymentSplitter: no payees");

        // Transfer tokens from sender to this contract
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit PaymentReceived(address(token), msg.sender, amount);

        // Distribute tokens to payees
        for (uint256 i = 0; i < _payees.length; i++) {
            address payeeAddress = _payees[i];
            uint256 payment = (amount * _shares[payeeAddress]) / _totalShares;

            if (payment > 0) {
                _released[address(token)][payeeAddress] += payment;
                emit PaymentReleased(address(token), payeeAddress, payment);
                token.safeTransfer(payeeAddress, payment);
            }
        }
    }

    /**
     * @dev Getter for the total shares held by payees.
     */
    function totalShares() external view returns (uint256) {
        return _totalShares;
    }

    /**
     * @dev Getter for the total amount of `token` already released.
     */
    function totalReleased(IERC20 token) external view returns (uint256) {
        return _released[address(token)][address(0)];
    }

    /**
     * @dev Getter for the amount of shares held by an account.
     */
    function shares(address account) external view returns (uint256) {
        return _shares[account];
    }

    /**
     * @dev Getter for the amount of `token` tokens already released to a payee.
     */
    function released(IERC20 token, address account) external view returns (uint256) {
        return _released[address(token)][account];
    }

    /**
     * @dev Getter for the address of the payee number `index`.
     */
    function payee(uint256 index) external view returns (address) {
        return _payees[index];
    }

    /**
     * @dev Getter for the list of payees.
     */
    function getPayees() external view returns (address[] memory) {
        return _payees;
    }
}