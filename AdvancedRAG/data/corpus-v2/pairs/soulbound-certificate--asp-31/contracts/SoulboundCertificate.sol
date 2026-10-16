// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SoulboundCertificate
 * @notice Soulbound (non-transferable) ERC-721 certificate contract.
 */
contract SoulboundCertificate is ERC721, ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    mapping(address => bool) public issuers;
    mapping(uint256 => bool) public revoked;
    mapping(uint256 => address) public issuerOf;
    mapping(address => uint256[]) private _certificatesOf;

    // Custom errors
    error SoulboundNonTransferable();
    error NotIssuer();
    error NotTokenIssuerOrOwner();
    error AlreadyRevoked();
    error InvalidRecipient();
    error InvalidAddress();

    // Events
    event CertificateIssued(uint256 tokenId, address indexed to, address indexed issuer);
    event CertificateRevoked(uint256 tokenId);
    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);

    modifier onlyIssuer() {
        if (!issuers[msg.sender] && msg.sender != owner()) {
            revert NotIssuer();
        }
        _;
    }

    constructor() ERC721("SoulboundCertificate", "SBC") Ownable(msg.sender) {}

    function addIssuer(address issuer) external onlyOwner {
        if (issuer == address(0)) {
            revert InvalidAddress();
        }
        issuers[issuer] = true;
        emit IssuerAdded(issuer);
    }

    function removeIssuer(address issuer) external onlyOwner {
        if (issuer == address(0)) {
            revert InvalidAddress();
        }
        issuers[issuer] = false;
        emit IssuerRemoved(issuer);
    }

    function issueCertificate(address to, string calldata uri)
        external
        onlyIssuer
        returns (uint256)
    {
        if (to == address(0)) {
            revert InvalidRecipient();
        }
        _nextTokenId++;
        uint256 tokenId = _nextTokenId;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        issuerOf[tokenId] = msg.sender;
        _certificatesOf[to].push(tokenId);

        emit CertificateIssued(tokenId, to, msg.sender);
        return tokenId;
    }

    function revoke(uint256 tokenId) external onlyIssuer {
        _requireOwned(tokenId);
        if (revoked[tokenId]) {
            revert AlreadyRevoked();
        }
        if (msg.sender != issuerOf[tokenId] && msg.sender != owner()) {
            revert NotTokenIssuerOrOwner();
        }

        revoked[tokenId] = true;
        emit CertificateRevoked(tokenId);
    }

    function certificatesOf(address holder) external view returns (uint256[] memory) {
        return _certificatesOf[holder];
    }

    function isValid(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0) && !revoked[tokenId];
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721)
        returns (address)
    {
        if (_ownerOf(tokenId) != address(0)) {
            revert SoulboundNonTransferable();
        }
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
