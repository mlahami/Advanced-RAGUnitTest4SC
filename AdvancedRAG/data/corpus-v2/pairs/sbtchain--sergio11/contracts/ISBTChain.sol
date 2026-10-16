// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title Interface for the SBTChain contract
/// @notice This interface defines the core functionality for managing Soulbound Tokens (SBTs) in the SBTChain contract.
/// @dev This contract is used for issuing non-transferable Soulbound Tokens (SBTs) for altruistic actions.
///       Only authorized accounts can mint SBTs and revoke them if needed.

interface ISBTChain {

    /// @notice Enum representing the action type categories for SBTs.
    enum ActionType { Undefined, Environment, Education, Health, HumanRights }

    /// @notice Struct for storing information about each minted SBT.
    struct SBTData {
        ActionType actionType; // Type of altruistic action (e.g., Environment, Education)
        string description;    // Description of the altruistic action
        bytes32 proofHash;     // Optional proof hash for off-chain verification (e.g., PDF signature)
        bool revoked;          // Whether the SBT has been revoked
    }

    /// @notice Event emitted when a Soulbound Token (SBT) is minted.
    event SoulboundMinted(
        address indexed to,
        uint256 indexed tokenId,
        ActionType actionType,
        string description,
        bytes32 proofHash
    );

    /// @notice Event emitted when a Soulbound Token (SBT) is revoked.
    event SBTRevoked(address indexed to, uint256 indexed tokenId);

    /// @notice Mint a new SBT for a recipient.
    /// @param to The address receiving the SBT.
    /// @param uri The URI containing metadata for the SBT.
    /// @param actionType The action type (e.g., Environment, Education).
    /// @param description A brief description of the altruistic action.
    /// @param proofHash A hash of the proof of the action (optional).
    function mintSBT(
        address to,
        string calldata uri,
        ActionType actionType,
        string calldata description,
        bytes32 proofHash
    ) external;

    /// @notice Revoke a Soulbound Token (SBT) by the revoker.
    /// @param tokenId The ID of the token to be revoked.
    function revokeSBT(uint256 tokenId) external;

    /// @notice Get the metadata for a specific token.
    /// @param tokenId The token ID of the SBT.
    /// @return actionType The action type associated with the token.
    /// @return description The description of the action.
    /// @return proofHash The proof hash for off-chain verification.
    /// @return revoked Whether the token has been revoked.
    function getSBTData(uint256 tokenId) external view returns (
        ActionType actionType,
        string memory description,
        bytes32 proofHash,
        bool revoked
    );

    /// @notice Check if the recipient has received a specific action type.
    /// @param recipient The address to check.
    /// @param actionType The action type to check (e.g., Environment, Education).
    /// @return bool True if the recipient has received the action type, false otherwise.
    function hasReceivedActionType(address recipient, ActionType actionType) external view returns (bool);

    /// @notice Check if a recipient is approved to receive an SBT.
    /// @param recipient The address to check.
    /// @return bool True if the recipient is approved, false otherwise.
    function isRecipientApproved(address recipient) external view returns (bool);

    /// @notice Approve a recipient to receive SBTs. Only the contract owner can call this.
    /// @param recipient The address to approve.
    function approveRecipient(address recipient) external;

    /// @notice Set the address authorized to revoke SBTs. Only the contract owner can call this.
    /// @param _revoker The address to set as the revoker.
    function setRevoker(address _revoker) external;
}