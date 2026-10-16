// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./ISBTChain.sol";

/**
 * @title SBTChain
 * @dev This contract allows the minting, revocation, and management of Soulbound Tokens (SBTs),
 * which are non-transferable tokens that represent altruistic actions such as donations and activism.
 * The contract implements the ISBTChain interface.
 */
contract SBTChain is ERC721URIStorage, Ownable, ISBTChain {
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 private _tokenIdCounter;   // Counter for generating new token IDs
    address private revoker;           // Address authorized to revoke SBTs

    // Mapping to store SBT data for each token ID
    mapping(uint256 => SBTData) private _sbtData;
    
    // Mapping to track if a recipient has received a specific action type (prevents multiple actions of the same type)
    mapping(address => mapping(ActionType => bool)) private _hasReceivedActionType;
    
    // Mapping of approved recipients who are eligible to receive SBTs
    mapping(address => bool) private _approvedRecipients;

    // Mapping to track the reputation score of each recipient
    mapping(address => uint256) private _reputationScore;

    /**
     * @dev Constructor for the contract. The initial address is set as the owner.
     * @param initialAddress Address to transfer ownership of the contract to.
     */
    constructor(address initialAddress) Ownable(initialAddress) ERC721("SBTChain", "SBTC") {
        transferOwnership(initialAddress); // Transfer ownership to the initial address
    }

    /**
     * @dev Modifier to check if the caller is authorized to revoke SBTs (only the revoker address).
     */
    modifier onlyRevoker() {
        require(msg.sender == revoker, "Not authorized to revoke");
        _;
    }

    /**
     * @dev Function to approve a recipient to receive SBTs. Only the contract owner can approve recipients.
     * @param recipient Address of the recipient to approve.
     */
    function approveRecipient(address recipient) external override onlyOwner {
        _approvedRecipients[recipient] = true;
    }

    /**
     * @dev Function to check if a recipient is approved to receive an SBT.
     * @param recipient Address to check for approval.
     * @return bool Returns true if the recipient is approved, false otherwise.
     */
    function isRecipientApproved(address recipient) external view override returns (bool) {
        return _approvedRecipients[recipient];
    }

    /**
     * @dev Function to set the address that is allowed to revoke SBTs. Only the contract owner can set the revoker.
     * @param _revoker Address of the revoker.
     */
    function setRevoker(address _revoker) external override onlyOwner {
        revoker = _revoker;
    }

    /**
     * @dev Function to mint an SBT for a recipient. The SBT is minted only if the recipient is approved,
     * and they haven't received an SBT for the specific action type.
     * @param to Address of the recipient of the SBT.
     * @param uri URI to associate with the minted token (metadata).
     * @param actionType Type of altruistic action (e.g., donation, activism, etc.).
     * @param description A brief description of the altruistic action performed.
     * @param proofHash An optional hash representing the proof of the action (e.g., proof of donation).
     */
    function mintSBT(
        address to,
        string calldata uri,
        ActionType actionType,
        string calldata description,
        bytes32 proofHash
    ) external override onlyOwner {
        require(_approvedRecipients[to], "Recipient not approved");
        require(!_hasReceivedActionType[to][actionType], "Already received this action type");

        uint256 tokenId = ++_tokenIdCounter;  // Increment token counter and assign new token ID
        _mint(to, tokenId);                   // Mint the SBT token to the recipient
        _setTokenURI(tokenId, uri);           // Set the metadata URI for the token

        // Store SBT data in the mapping
        _sbtData[tokenId] = SBTData({
            actionType: actionType,
            description: description,
            proofHash: proofHash,
            revoked: false
        });

        // Mark that the recipient has received the action type
        _hasReceivedActionType[to][actionType] = true;
        
        // Increase the recipient's reputation score
        _reputationScore[to] += 10;

        // Emit an event to signal that a new SBT has been minted
        emit SoulboundMinted(to, tokenId, actionType, description, proofHash);
    }

    /**
     * @dev Function to revoke an SBT by the revoker. The revoker can only revoke a token that exists and is not already revoked.
     * @param tokenId ID of the token to be revoked.
     */
    function revokeSBT(uint256 tokenId) external override onlyRevoker {
        require(ownerOf(tokenId) != address(0), "Token does not exist");  // Ensure the token exists
        require(!_sbtData[tokenId].revoked, "SBT already revoked");         // Ensure the token is not already revoked

        // Mark the SBT as revoked
        _sbtData[tokenId].revoked = true;

        // Decrease the reputation score of the token owner
        _reputationScore[ownerOf(tokenId)] -= 10;

        // Emit an event to signal that the SBT has been revoked
        emit SBTRevoked(ownerOf(tokenId), tokenId);
    }

    /**
     * @dev Function to retrieve data for a specific SBT.
     * @param tokenId The ID of the token.
     * @return actionType The action type associated with the SBT.
     * @return description The description of the action.
     * @return proofHash The proof hash for the action.
     * @return revoked Whether the SBT has been revoked.
     */
    function getSBTData(uint256 tokenId) external view override returns (
        ActionType actionType,
        string memory description,
        bytes32 proofHash,
        bool revoked
    ) {
        SBTData memory data = _sbtData[tokenId];  // Retrieve SBT data
        return (data.actionType, data.description, data.proofHash, data.revoked);
    }

    /**
     * @dev Function to check if a recipient has received a specific type of action.
     * @param recipient Address of the recipient.
     * @param actionType The type of action to check for.
     * @return bool Returns true if the recipient has received the action type, false otherwise.
     */
    function hasReceivedActionType(address recipient, ActionType actionType) external view override returns (bool) {
        return _hasReceivedActionType[recipient][actionType];
    }

    /**
     * @dev Override the transferFrom function to prevent transfers of SBTs.
     * @param from Address of the sender.
     * @param to Address of the recipient.
     * @param tokenId ID of the token being transferred.
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public override(ERC721, IERC721) {
        // Prevent transfer of SBTs
        require(ownerOf(tokenId) != from, "SBTs are non-transferable");
        super.transferFrom(from, to, tokenId);
    }

    /**
     * @dev Override the safeTransferFrom function to prevent safe transfers of SBTs.
     * @param from Address of the sender.
     * @param to Address of the recipient.
     * @param tokenId ID of the token being transferred.
     * @param data Additional data to pass to the recipient.
     */
    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public override(ERC721, IERC721) {
        // Prevent safe transfer of SBTs
        require(ownerOf(tokenId) != from, "SBTs are non-transferable");
        super.safeTransferFrom(from, to, tokenId, data);
    }

    /**
     * @dev Function to burn an SBT. The owner or the contract owner can burn an SBT.
     * @param tokenId The ID of the token to burn.
     */
    function burn(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender || msg.sender == owner(), "Not authorized");  // Ensure caller is authorized
        _burn(tokenId);  // Burn the token
    }
}