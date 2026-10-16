// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "./VoucherLib.sol";

/**
 * @title PolyMirrorChannel
 * @author PolyMirror.AI
 * @notice This contract manages user funds in the native currency (POL) for paying for services.
 * It uses EIP-712 for secure, off-chain voucher signing.
 */
contract PolyMirrorChannel is Ownable, EIP712 {
    /// @notice A mapping to track used nonces for each channel to prevent replay attacks.
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    /// @notice A mapping from a user's address to their POL balance.
    mapping(address => uint256) public channel;

    /// @notice Emitted when a user tops up their channel with POL.
    event ChannelToppedUp(address indexed user, uint256 amount, uint256 newBal);
    /// @notice Emitted when a voucher is successfully redeemed.
    event VoucherRedeemed(address indexed user, uint256 nonce, string model, uint256 inputTokenAmount, uint256 maxOutputTokenAmount, uint256 amountDebited);
    /// @notice Emitted when a user closes their channel.
    event ChannelClosed(address indexed user);

    // The EIP-712 type hash for the Voucher struct.
    bytes32 private constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(address channel,uint256 nonce,uint256 deadline,string model,uint256 inputTokenAmount,uint256 maxOutputTokenAmount)"
    );

    /**
     * @notice Initializes the contract, setting the EIP-712 domain and owner.
     */
    constructor() Ownable(msg.sender) EIP712("PolyMirrorChannel", "1") {}

    /**
     * @notice Tops up the user's channel with a direct payment of POL.
     * The amount of POL sent with the transaction is added to the user's channel.
     */
    function topUpChannel() public payable {
        require(msg.value > 0, "Must send POL to top up");
        channel[msg.sender] += msg.value;
        emit ChannelToppedUp(msg.sender, msg.value, channel[msg.sender]);
    }

    /**
     * @notice Opens a channel for a user. This is an alias for topUpChannel.
     * The amount of POL sent with the transaction is the initial channel balance.
     */
    function openChannel() public payable {
        topUpChannel();
    }

    /**
     * @notice Redeems a signed voucher to debit a user's channel.
     * The debited amount is transferred directly to the contract owner.
     * @param v The voucher containing the payment details.
     * @param amount The actual amount to be debited from the channel.
     * @param sig The EIP-712 signature of the voucher.
     */
    function redeem(Voucher calldata v, uint256 amount, bytes calldata sig) external onlyOwner {
        require(block.timestamp <= v.deadline, "Voucher expired");
        require(!nonceUsed[v.channel][v.nonce], "Nonce used");
        require(channel[v.channel] >= amount, "Insufficient funds");

        bytes32 digest = _hashVoucher(v);
        address signer = ECDSA.recover(digest, sig);
        require(signer == v.channel, "Invalid signature");

        nonceUsed[v.channel][v.nonce] = true;
        channel[v.channel] -= amount;

        // Immediately transfer the POL funds to the contract owner
        (bool sent, ) = owner().call{value: amount}("");
        require(sent, "Failed to send POL to owner");

        emit VoucherRedeemed(v.channel, v.nonce, v.model, v.inputTokenAmount, v.maxOutputTokenAmount, amount);
    }

    /**
     * @notice Calculates the EIP-712 digest for a given voucher.
     * @param v The voucher for which to calculate the hash.
     * @return The EIP-712 digest.
     */
    function _hashVoucher(Voucher calldata v) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            v.channel,
            v.nonce,
            v.deadline,
            keccak256(bytes(v.model)),
            v.inputTokenAmount,
            v.maxOutputTokenAmount
        ));
        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Allows a user to close their channel and withdraw their remaining funds.
     */
    function closeChannel() external {
        uint256 remainingBalance = channel[msg.sender];
        require(remainingBalance > 0, "No balance to withdraw");

        // Reset balance before transfer to prevent re-entrancy attacks
        channel[msg.sender] = 0;

        // Transfer the remaining POL balance to the user
        (bool sent, ) = msg.sender.call{value: remainingBalance}("");
        require(sent, "Failed to send POL to user");

        emit ChannelClosed(msg.sender);
    }

    /**
     * @notice Returns the current balance of the user's channel.
     * @return The balance of the user's channel in POL (wei).
     */
    function getBalance(address user) external view returns (uint256) {
        return channel[user];
    }
}
