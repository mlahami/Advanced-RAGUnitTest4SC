# sbtchain--sergio11

- domain: nft-marketplace (soulbound-nft)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/sergio11/sbtchain_blockchain @ c54fa5bb11a841e9bf18c6c7051f15d8cf75156f
- license: MIT
- targets: SBTChain.sol, ISBTChain.sol
- validation: 13 passing tests, 0 failing; statement coverage SBTChain.sol 85.71 %, ISBTChain.sol 100.0 %

## Contract: ISBTChain.sol (dependency)

```solidity
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
```

## Contract: SBTChain.sol (primary target)

```solidity
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
```

## Tests: SBTChain.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SBTChain Contract", function () {
  let SBTChain, sbtChain, owner, approvedRecipient, revoker, anotherAccount;
  let tokenId;

  beforeEach(async function () {
    // Get accounts from Hardhat
    [owner, approvedRecipient, revoker, anotherAccount] = await ethers.getSigners();

    // Deploy the contract
    SBTChain = await ethers.getContractFactory("SBTChain");
    sbtChain = await SBTChain.deploy(owner.address);  // Initialize contract with the owner address
    // Set revoker address
    await sbtChain.setRevoker(revoker.address);
  });

  describe("Approve Recipient", function () {
    it("should approve a recipient", async function () {
        // Approve the recipient
        await sbtChain.approveRecipient(approvedRecipient.address);
      
        // Check if the recipient's address is approved using the isRecipientApproved method
        expect(await sbtChain.isRecipientApproved(approvedRecipient.address)).to.be.true;
    });
      

    it("should not approve a non-owner", async function () {
      // Only the owner can approve recipients
      await expect(
        sbtChain.connect(anotherAccount).approveRecipient(approvedRecipient.address)
      ).to.be.reverted;
    });
  });

  describe("Minting SBTs", function () {
    beforeEach(async function () {
      // Approve the recipient before minting
      await sbtChain.approveRecipient(approvedRecipient.address);
    });

    it("should mint an SBT to an approved recipient", async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;  // Assuming ActionType is an enum where 1 represents a donation
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Mint the SBT
      await sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash);

      tokenId = 1;  // First token ID minted
      const tokenOwner = await sbtChain.ownerOf(tokenId);
      const tokenURI = await sbtChain.tokenURI(tokenId);
      const sbtData = await sbtChain.getSBTData(tokenId);

      // Check if the SBT was minted correctly
      expect(tokenOwner).to.equal(approvedRecipient.address);
      expect(tokenURI).to.equal(uri);
      expect(sbtData.actionType).to.equal(actionType);
      expect(sbtData.description).to.equal(description);
      expect(sbtData.revoked).to.be.false;
    });

    it("should revert when minting an SBT for a non-approved recipient", async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Revert if the recipient is not approved
      await expect(
        sbtChain.connect(owner).mintSBT(anotherAccount.address, uri, actionType, description, proofHash)
      ).to.be.revertedWith("Recipient not approved");
    });

    it("should revert if the recipient has already received the same action type", async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Mint an SBT first
      await sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash);

      // Revert if the recipient has already received this action type
      await expect(
        sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash)
      ).to.be.revertedWith("Already received this action type");
    });
  });

  describe("Revoking SBTs", function () {
    beforeEach(async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await sbtChain.approveRecipient(approvedRecipient.address);
      // Mint an SBT to the approved recipient
      await sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash);
      tokenId = 1;  // First token ID minted
    });

    it("should revoke an SBT by revoker", async function () {
      // Revoker should be able to revoke the SBT
      await sbtChain.connect(revoker).revokeSBT(tokenId);

      const sbtData = await sbtChain.getSBTData(tokenId);
      expect(sbtData.revoked).to.be.true;
    });

    it("should not allow revocation by non-revoker", async function () {
      // Only the designated revoker can revoke the SBT
      await expect(
        sbtChain.connect(anotherAccount).revokeSBT(tokenId)
      ).to.be.revertedWith("Not authorized to revoke");
    });

    it("should revert if SBT is already revoked", async function () {
      // Revoke the SBT once and try again
      await sbtChain.connect(revoker).revokeSBT(tokenId);
      await expect(
        sbtChain.connect(revoker).revokeSBT(tokenId)
      ).to.be.revertedWith("SBT already revoked");
    });
  });

  describe("Non-transferability of SBTs", function () {
    beforeEach(async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await sbtChain.approveRecipient(approvedRecipient.address);
      // Mint an SBT to the approved recipient
      await sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash);
      tokenId = 1;
    });

    it("should prevent transfer of an SBT", async function () {
      // Revert if trying to transfer the SBT
      await expect(
        sbtChain.connect(approvedRecipient).transferFrom(approvedRecipient.address, anotherAccount.address, tokenId)
      ).to.be.revertedWith("SBTs are non-transferable");
    });

    it("should prevent safe transfer of an SBT", async function () {
        // Revert if trying to safe transfer the SBT
        await expect(
          sbtChain.connect(approvedRecipient).safeTransferFrom(approvedRecipient.address, anotherAccount.address, tokenId)
        ).to.be.revertedWith("SBTs are non-transferable");
    });
  });

  describe("Burning an SBT", function () {
    beforeEach(async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await sbtChain.approveRecipient(approvedRecipient.address);
      // Mint an SBT to the approved recipient
      await sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash);
      tokenId = 1;
    });

    it("should allow the owner to burn the SBT", async function () {
      // The recipient should be able to burn their own SBT
      await sbtChain.connect(approvedRecipient).burn(tokenId);
      await expect(sbtChain.ownerOf(tokenId)).to.be.reverted;
    });

    it("should allow the contract owner to burn the SBT", async function () {
      // The contract owner should also be able to burn the SBT
      await sbtChain.connect(owner).burn(tokenId);
      await expect(sbtChain.ownerOf(tokenId)).to.be.reverted;
    });

    it("should not allow others to burn the SBT", async function () {
      // Others should not be allowed to burn the SBT
      await expect(
        sbtChain.connect(anotherAccount).burn(tokenId)
      ).to.be.reverted;
    });
  });
});
```
