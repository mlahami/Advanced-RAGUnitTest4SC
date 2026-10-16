// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title AccessNFT
/// @notice ERC-721 tokens representing file ownership in the decentralized storage system.
/// @dev Only the FileRegistry (set as owner) can mint and burn tokens.
contract AccessNFT is ERC721, Ownable {
    error NotTokenOwner();
    error TokenDoesNotExist();

    uint256 private _nextTokenId;
    mapping(uint256 => string) private _tokenCIDs;

    event FileMinted(uint256 indexed tokenId, address indexed owner, string cid);
    event FileBurned(uint256 indexed tokenId);

    /// @param registry The FileRegistry contract address, set as owner for mint/burn permissions.
    constructor(address registry) ERC721("ZKP Storage File", "ZKPF") Ownable(registry) {}

    /// @notice Mint a new file ownership NFT. Only callable by the FileRegistry.
    /// @param to The file owner's address.
    /// @param cid The IPFS CID associated with this file.
    /// @return tokenId The minted token ID.
    function mint(address to, string calldata cid) external onlyOwner returns (uint256 tokenId) {
        _nextTokenId++;
        tokenId = _nextTokenId;
        _safeMint(to, tokenId);
        _tokenCIDs[tokenId] = cid;
        emit FileMinted(tokenId, to, cid);
    }

    /// @notice Burn a file NFT. Only callable by the FileRegistry.
    function burn(uint256 tokenId) external onlyOwner {
        _requireOwned(tokenId);
        delete _tokenCIDs[tokenId];
        _burn(tokenId);
        emit FileBurned(tokenId);
    }

    /// @notice Returns the IPFS CID stored for the given token.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat("ipfs://", _tokenCIDs[tokenId]);
    }

    /// @notice Returns the raw CID for a token.
    function tokenCID(uint256 tokenId) external view returns (string memory) {
        _requireOwned(tokenId);
        return _tokenCIDs[tokenId];
    }
}
