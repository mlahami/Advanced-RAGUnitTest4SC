# soulbound-certificate--asp-31

- domain: nft-marketplace (soulbound-certificate)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ASP-31/Soulbound @ 01fcb14fd42fc12408f4da0f8af4f47cbe616111
- license: MIT
- targets: SoulboundCertificate.sol
- validation: 14 passing tests, 0 failing; statement coverage SoulboundCertificate.sol 95.45 %

## Contract: SoulboundCertificate.sol (primary target)

```solidity
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
```

## Tests: SoulboundCertificate.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SoulboundCertificate", function () {
  let certificate;
  let owner;
  let issuer;
  let issuer2;
  let recipient;
  let recipient2;
  let nonIssuer;

  const sampleUri1 = "ipfs://QmTestHash1/certificate1.json";
  const sampleUri2 = "ipfs://QmTestHash2/certificate2.json";

  beforeEach(async function () {
    [owner, issuer, issuer2, recipient, recipient2, nonIssuer] =
      await ethers.getSigners();

    const SoulboundCertificateFactory =
      await ethers.getContractFactory("SoulboundCertificate");
    certificate = await SoulboundCertificateFactory.deploy();
    await certificate.waitForDeployment();
  });

  describe("1. Whitelisted issuer minting", function () {
    it("whitelisted issuer can mint; token owner is recipient", async function () {
      // Owner adds issuer to whitelist
      await expect(certificate.connect(owner).addIssuer(issuer.address))
        .to.emit(certificate, "IssuerAdded")
        .withArgs(issuer.address);

      expect(await certificate.issuers(issuer.address)).to.be.true;

      // Whitelisted issuer mints certificate
      const tx = await certificate
        .connect(issuer)
        .issueCertificate(recipient.address, sampleUri1);

      await expect(tx)
        .to.emit(certificate, "CertificateIssued")
        .withArgs(1n, recipient.address, issuer.address);

      // Verify token state
      expect(await certificate.ownerOf(1n)).to.equal(recipient.address);
      expect(await certificate.tokenURI(1n)).to.equal(sampleUri1);
      expect(await certificate.issuerOf(1n)).to.equal(issuer.address);
      expect(await certificate.isValid(1n)).to.be.true;
    });
  });

  describe("2. Non-issuer minting restriction", function () {
    it("non-issuer minting reverts", async function () {
      expect(await certificate.issuers(nonIssuer.address)).to.be.false;

      await expect(
        certificate
          .connect(nonIssuer)
          .issueCertificate(recipient.address, sampleUri1)
      ).to.be.revertedWithCustomError(certificate, "NotIssuer");
    });
  });

  describe("3. Soulbound transfer restriction (transferFrom)", function () {
    beforeEach(async function () {
      await certificate.connect(owner).addIssuer(issuer.address);
      await certificate
        .connect(issuer)
        .issueCertificate(recipient.address, sampleUri1);
    });

    it("transferFrom by holder reverts with SoulboundNonTransferable", async function () {
      await expect(
        certificate
          .connect(recipient)
          .transferFrom(recipient.address, recipient2.address, 1n)
      ).to.be.revertedWithCustomError(certificate, "SoulboundNonTransferable");
    });

    it("transferFrom by approved operator also reverts with SoulboundNonTransferable", async function () {
      await certificate.connect(recipient).approve(recipient2.address, 1n);

      await expect(
        certificate
          .connect(recipient2)
          .transferFrom(recipient.address, recipient2.address, 1n)
      ).to.be.revertedWithCustomError(certificate, "SoulboundNonTransferable");
    });
  });

  describe("4. Soulbound safe transfer restriction (safeTransferFrom)", function () {
    beforeEach(async function () {
      await certificate.connect(owner).addIssuer(issuer.address);
      await certificate
        .connect(issuer)
        .issueCertificate(recipient.address, sampleUri1);
    });

    it("safeTransferFrom also reverts", async function () {
      // Test 3-argument overload
      await expect(
        certificate
          .connect(recipient)
          ["safeTransferFrom(address,address,uint256)"](
            recipient.address,
            recipient2.address,
            1n
          )
      ).to.be.revertedWithCustomError(certificate, "SoulboundNonTransferable");

      // Test 4-argument overload
      await expect(
        certificate
          .connect(recipient)
          ["safeTransferFrom(address,address,uint256,bytes)"](
            recipient.address,
            recipient2.address,
            1n,
            "0x"
          )
      ).to.be.revertedWithCustomError(certificate, "SoulboundNonTransferable");
    });
  });

  describe("5. Revocation and validity", function () {
    beforeEach(async function () {
      await certificate.connect(owner).addIssuer(issuer.address);
      await certificate.connect(owner).addIssuer(issuer2.address);
      await certificate
        .connect(issuer)
        .issueCertificate(recipient.address, sampleUri1);
    });

    it("revoke flips isValid to false; non-issuer revoke reverts", async function () {
      // Non-issuer revoke reverts with NotIssuer
      await expect(
        certificate.connect(nonIssuer).revoke(1n)
      ).to.be.revertedWithCustomError(certificate, "NotIssuer");

      // Before revoke, token is valid
      expect(await certificate.isValid(1n)).to.be.true;
      expect(await certificate.revoked(1n)).to.be.false;

      // Original issuer revokes
      const tx = await certificate.connect(issuer).revoke(1n);
      await expect(tx)
        .to.emit(certificate, "CertificateRevoked")
        .withArgs(1n);

      // isValid is flipped to false
      expect(await certificate.isValid(1n)).to.be.false;
      expect(await certificate.revoked(1n)).to.be.true;

      // Attempting to revoke already revoked certificate reverts
      await expect(
        certificate.connect(issuer).revoke(1n)
      ).to.be.revertedWithCustomError(certificate, "AlreadyRevoked");
    });

    it("another issuer cannot revoke a certificate they did not issue", async function () {
      await expect(
        certificate.connect(issuer2).revoke(1n)
      ).to.be.revertedWithCustomError(certificate, "NotTokenIssuerOrOwner");
    });

    it("contract owner can revoke any certificate", async function () {
      await expect(certificate.connect(owner).revoke(1n))
        .to.emit(certificate, "CertificateRevoked")
        .withArgs(1n);

      expect(await certificate.isValid(1n)).to.be.false;
    });
  });

  describe("6. certificatesOf holder tracking", function () {
    it("certificatesOf returns all ids for a holder with 2 certificates", async function () {
      await certificate.connect(owner).addIssuer(issuer.address);

      // Initially empty
      expect(await certificate.certificatesOf(recipient.address)).to.deep.equal(
        []
      );

      // Issue first certificate (id 1)
      await certificate
        .connect(issuer)
        .issueCertificate(recipient.address, sampleUri1);

      // Issue second certificate (id 2)
      await certificate
        .connect(issuer)
        .issueCertificate(recipient.address, sampleUri2);

      const recipientCertificates = await certificate.certificatesOf(
        recipient.address
      );
      expect(recipientCertificates).to.deep.equal([1n, 2n]);

      // Non-holder has empty array
      expect(
        await certificate.certificatesOf(recipient2.address)
      ).to.deep.equal([]);
    });
  });

  describe("Issuer Management & Edge cases", function () {
    it("only owner can add or remove issuers", async function () {
      await expect(
        certificate.connect(nonIssuer).addIssuer(issuer.address)
      ).to.be.revertedWithCustomError(certificate, "OwnableUnauthorizedAccount");

      await expect(
        certificate.connect(nonIssuer).removeIssuer(issuer.address)
      ).to.be.revertedWithCustomError(certificate, "OwnableUnauthorizedAccount");
    });

    it("cannot add or remove address(0) as issuer", async function () {
      await expect(
        certificate.connect(owner).addIssuer(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(certificate, "InvalidAddress");

      await expect(
        certificate.connect(owner).removeIssuer(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(certificate, "InvalidAddress");
    });

    it("cannot issue to address(0)", async function () {
      await certificate.connect(owner).addIssuer(issuer.address);
      await expect(
        certificate
          .connect(issuer)
          .issueCertificate(ethers.ZeroAddress, sampleUri1)
      ).to.be.revertedWithCustomError(certificate, "InvalidRecipient");
    });

    it("isValid returns false for non-existent tokens", async function () {
      expect(await certificate.isValid(999n)).to.be.false;
    });

    it("supportsInterface supports ERC721, ERC721Metadata, and ERC4906", async function () {
      // ERC721 interface id: 0x80ac58cd
      expect(await certificate.supportsInterface("0x80ac58cd")).to.be.true;
      // ERC721Metadata interface id: 0x5b5e139f
      expect(await certificate.supportsInterface("0x5b5e139f")).to.be.true;
      // ERC4906 interface id: 0x49064906
      expect(await certificate.supportsInterface("0x49064906")).to.be.true;
    });
  });
});
```
