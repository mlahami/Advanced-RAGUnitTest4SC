# actor--captainunknown

- domain: supply-chain (supply-chain)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/CaptainUnknown/dnft-supply-chain @ a8d7bf422e62cbb90e03ec99161f72b235640083
- license: MIT
- targets: Actor.sol, AccessManager.sol, Errors.sol
- validation: 12 passing tests, 0 failing; statement coverage Actor.sol 92.31 %, AccessManager.sol 11.9 %, Errors.sol 100.0 %

## Contract: AccessManager.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { AccessControlEnumerable } from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import { Errors } from "./Errors.sol";

/// @custom:security-contact @captainunknown7@gmail.com
contract AccessManager is AccessControl, AccessControlEnumerable {
    bytes32 public constant AUTHORIZED_CONTRACT_ROLE = keccak256("AUTHORIZED_CONTRACT_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant COMPANY_USER_ROLE = keccak256("COMPANY_USER_ROLE");
    bytes32 public constant CONSUMER_ROLE = keccak256("CONSUMER_ROLE");

    event DefaultAdminRoleTransferred(address indexed defaultAdmin, address previousDefaultAdmin, uint256 timestamp);
    event AuthorizedContractRoleGranted(address indexed contractAddress, uint256 timestamp);
    event AuthorizedContractRoleRevoked(address indexed contractAddress, uint256 timestamp);
    event AdminRoleGranted(address indexed admin, uint256 timestamp);
    event AdminRoleRevoked(address indexed admin, uint256 timestamp);
    event CompanyUserRoleGranted(address indexed companyUser, uint256 timestamp);
    event CompanyUserRoleRevoked(address indexed companyUser, uint256 timestamp);

    /**
    * @dev Throws `UnAuthorized` if called by any account other than the Admin or Default (Super) Admin.
    */
    modifier onlyClearanceLevelA() {
        if (!(hasRole(ADMIN_ROLE, msg.sender) || hasRole(DEFAULT_ADMIN_ROLE, msg.sender)))
            revert Errors.UnAuthorized("ADMIN_ROLE");
        _;
    }

    /**
    * @dev Throws `UnAuthorized` if called by any account other than company user, Admin or Default (Super) Admin.
    */
    modifier onlyClearanceLevelB() {
        if (!(hasRole(COMPANY_USER_ROLE, msg.sender) || hasRole(ADMIN_ROLE, msg.sender) || hasRole(DEFAULT_ADMIN_ROLE, msg.sender)))
            revert Errors.UnAuthorized("COMPANY_USER_ROLE");
        _;
    }

    /**
    * @dev Sets the Default (Super) Admin.
    */
    constructor(address defaultAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
    }

    /// Authorized Contract Role
    /**
    * @dev grants the AUTHORIZED_CONTRACT_ROLE to the provided address.
    * Necessary for all guarded external calls in between contracts.
    */
    function grantAuthorizedContractRole(address contractAddress) public onlyClearanceLevelA {
        _grantRole(AUTHORIZED_CONTRACT_ROLE, contractAddress);
        emit AuthorizedContractRoleGranted(contractAddress, block.timestamp);
    }

    /**
    * @dev revokes the AUTHORIZED_CONTRACT_ROLE from the provided address.
    */
    function revokeAuthorizedContractRole(address contractAddress) public onlyClearanceLevelA {
        _revokeRole(AUTHORIZED_CONTRACT_ROLE, contractAddress);
        emit AuthorizedContractRoleRevoked(contractAddress, block.timestamp);
    }

    /// Admin Role
    /**
    * @dev grants the ADMIN_ROLE to the provided address.
    * Admins can only be appointed by the Default (Super) Admin.
    */
    function grantAdminRole(address account) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(ADMIN_ROLE, account);
        emit AdminRoleGranted(account, block.timestamp);
    }

    /**
    * @dev revokes the ADMIN_ROLE from the provided address.
    */
    function revokeAdminRole(address account) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(ADMIN_ROLE, account);
        emit AdminRoleRevoked(account, block.timestamp);
    }

    /// Company User Role
    /**
    * @dev grants the COMPANY_USER_ROLE to the provided address.
    * Company User can only be appointed by the by actors of clearance level A.
    * Company User can perform management ops ('with write access' as specified in the specs).
    */
    function grantCompanyUserRole(address account) public onlyClearanceLevelA {
        _grantRole(COMPANY_USER_ROLE, account);
        emit CompanyUserRoleGranted(account, block.timestamp);
    }

    /**
    * @dev revokes the COMPANY_USER_ROLE from the provided address.
    */
    function revokeCompanyUserRole(address account) public onlyClearanceLevelA {
        _revokeRole(COMPANY_USER_ROLE, account);
        emit CompanyUserRoleRevoked(account, block.timestamp);
    }

    /// Consumer Role
    /**
    * @dev grants the CONSUMER_ROLE to the provided address.
    * Consumers gain read-only access, this role can be utilized in a permissioned chain.
    */
    function grantConsumerRole(address account) public onlyClearanceLevelB {
        _grantRole(CONSUMER_ROLE, account);
    }

    /**
    * @dev revokes the CONSUMER_ROLE from the provided address.
    */
    function revokeConsumerRole(address account) public onlyClearanceLevelB {
        _revokeRole(CONSUMER_ROLE, account);
    }

    /// Super User | Default Admin role
    /**
    * @dev grants the DEFAULT_ADMIN_ROLE to the provided account.
    * This is an irreversible step unless the given account agrees to transfer back the role.
    */
    function transferDefaultAdminRole(address account) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DEFAULT_ADMIN_ROLE, account);
        emit DefaultAdminRoleTransferred(account, msg.sender, block.timestamp);
    }

    /**
    * @dev To retrieve the current Default (Super) Admin.
    * @return The address with the DEFAULT_ADMIN_ROLE.
    */
    function getCurrentDefaultAdmin() public view returns (address) {
        return getRoleMember(DEFAULT_ADMIN_ROLE, 0);
    }

    /**
    * @dev To get All Authorized Contracts.
    * @return The addresses with the AUTHORIZED_CONTRACT_ROLE.
    */
    function getCurrentContracts() public view returns (address[] memory) {
        uint256 roleMemberCount = getRoleMemberCount(AUTHORIZED_CONTRACT_ROLE);
        address[] memory contracts = new address[](roleMemberCount);
        for (uint256 i = 0; i < roleMemberCount; ) {
            contracts[i] = getRoleMember(AUTHORIZED_CONTRACT_ROLE, i);
            unchecked { ++i; }
        }
        return contracts;
    }

    /**
    * @dev To get All Admins.
    * @return The addresses with the ADMIN_ROLE.
    */
    function getCurrentAdmins() public view returns (address[] memory) {
        uint256 roleMemberCount = getRoleMemberCount(ADMIN_ROLE);
        address[] memory admins = new address[](roleMemberCount);
        for (uint256 i = 0; i < roleMemberCount; ) {
            admins[i] = getRoleMember(ADMIN_ROLE, i);
            unchecked { ++i; }
        }
        return admins;
    }

    /**
    * @dev To get All Company Users.
    * @return The addresses with the COMPANY_USER_ROLE.
    */
    function getCurrentCompanyUsers(uint256 query) public view returns (address[] memory) {
        uint256 roleMemberCount = getRoleMemberCount(COMPANY_USER_ROLE);
        if (roleMemberCount < query) query = roleMemberCount;
        address[] memory companyUsers = new address[](roleMemberCount);
        for (uint256 i = 0; i < query; ) {
            companyUsers[i] = getRoleMember(COMPANY_USER_ROLE, i);
            unchecked { ++i; }
        }
        return companyUsers;
    }

    /**
    * @dev To get All Consumers.
    * @return The addresses with the CONSUMER_ROLE.
    */
    function getCurrentConsumers(uint256 query) public view returns (address[] memory) {
        uint256 roleMemberCount = getRoleMemberCount(CONSUMER_ROLE);
        if (roleMemberCount < query) query = roleMemberCount;
        address[] memory consumers = new address[](roleMemberCount);
        for (uint256 i = 0; i < query; ) {
            consumers[i] = getRoleMember(CONSUMER_ROLE, i);
            unchecked { ++i; }
        }
        return consumers;
    }

    /// Necessary Overrides:
    /**
    * @dev To grant a custom role.
    * @return success status.
    */
    function _grantRole(bytes32 role, address account)
    internal
    override(AccessControl, AccessControlEnumerable)
    returns (bool)
    {
        return super._grantRole(role, account);
    }

    /**
    * @dev To revoke a custom role.
    * @return success status.
    */
    function _revokeRole(bytes32 role, address account)
    internal
    override(AccessControl, AccessControlEnumerable)
    returns (bool)
    {
        return super._revokeRole(role, account);
    }

    function supportsInterface(bytes4 interfaceId)
    public
    view
    virtual
    override(AccessControl, AccessControlEnumerable)
    returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

## Contract: Actor.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ERC721Enumerable } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import { ERC721URIStorage } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import { AccessManager } from "./AccessManager.sol";
import { Errors } from "./Errors.sol";

/**
* @title An ERC721 collection of actors.
* @dev A soul-bound NFT for identity management.
* @custom:security-contact @captainunknown7@gmail.com
*/
contract Actor is ERC721, ERC721Enumerable, ERC721URIStorage {
    uint256 private _nextActorId;
    AccessManager public acl;
    bytes32 immutable AUTHORIZED_CONTRACT_ROLE;

    modifier onlyAuthorizedContract() {
        if (!acl.hasRole(AUTHORIZED_CONTRACT_ROLE, msg.sender))
            revert Errors.UnAuthorized("AUTHORIZED_CONTRACT_ROLE");
        _;
    }

    /**
    * @dev Sets the ACL and determines the hash AUTHORIZED_CONTRACT_ROLE.
    */
    constructor(address aclAddress, string memory actorType, string memory prefix) ERC721(actorType, prefix) {
        acl = AccessManager(aclAddress);
        AUTHORIZED_CONTRACT_ROLE = acl.AUTHORIZED_CONTRACT_ROLE();
    }

    function _baseURI() internal pure override returns (string memory) {
        return "ipfs://";
    }

    /**
    * @dev To register a new actor of any kind.
    * Can only by called an external contract which would be `ActorsManager`.
    * @param account - The receiver of the ID.
    * @param hash - The hash of the ID.
    * @return The registered Actor ID.
    */
    function registerActor(address account, string calldata hash)
    external
    onlyAuthorizedContract
    returns (uint256)
    {
        if (balanceOf(account) != 0) revert Errors.DoubleRegistrationNotAllowed();
        uint256 actorId = _nextActorId++;
        _safeMint(account, actorId);
        _setTokenURI(actorId, hash);
        return actorId;
    }

    /**
    * @dev To update an actor of any kind.
    * Can only by called an external contract which would be `ActorsManager`.
    * @param actorId - Actor ID to update.
    * @param newHash - The new hash.
    */
    function updateActor(uint256 actorId, string memory newHash)
    external
    onlyAuthorizedContract
    {
        _setTokenURI(actorId, newHash);
    }

    /**
    * @dev Reverts with `SoulBoundTransferNotAllowed`.
    */
    function transferFrom(address /*from*/, address /*to*/, uint256 /*tokenId*/) public pure override(IERC721, ERC721) {
        revert Errors.SoulBoundTransferNotAllowed();
    }

    /**
    * @dev Reverts with `SoulBoundTransferNotAllowed`.
    */
    function safeTransferFrom(address /*from*/, address /*to*/, uint256 /*tokenId*/, bytes memory /*data*/) public pure override(IERC721, ERC721) {
        revert Errors.SoulBoundTransferNotAllowed();
    }

    /**
    * @return Whether the id has been issued or not.
    */
    function idExists(uint256 id) public view returns(bool) {
        return id < totalSupply();
    }

    // Necessary Overrides
    function _update(address to, uint256 tokenId, address auth)
    internal
    override(ERC721, ERC721Enumerable)
    returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
    internal
    override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
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
    virtual
    override(ERC721, ERC721Enumerable, ERC721URIStorage)
    returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

## Contract: Errors.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @custom:security-contact @captainunknown7@gmail.com
library Errors {
    error InvalidActorType(uint8 given, uint8 max);
    error InvalidBatchStatus(uint8 given, uint8 max);
    error OutOfBounds(uint256 given, uint256 max);
    error UnAuthorized(string expectedRole);
    error DoubleRegistrationNotAllowed();
    error SoulBoundTransferNotAllowed();
    error UnexpectedRequestID();
    error UnexpectedAgent(address calledBy, address expected);
    error FulfillmentFailed();
    error InvalidTokenId();
}
```

## Tests: Actor.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Actor", function () {
    let Actor, actor, owner, account1, account2, authorizedContract;
    let AccessManager, accessManager;
    const hash = "QmX...TESTHASH";
    const newHash = "QmX...NEWTESTHASH";

    beforeEach(async function () {
        [owner, account1, account2, authorizedContract] = await ethers.getSigners();

        AccessManager = await ethers.getContractFactory("AccessManager");
        accessManager = await AccessManager.deploy(owner.address);
        await accessManager.grantAuthorizedContractRole(authorizedContract.address);

        Actor = await ethers.getContractFactory("Actor");
        actor = await Actor.deploy(accessManager.target, "TestActor", "TA");
        return actor;
    });

    describe("Deployment", function () {
        it("Should set the correct name and symbol", async function () {
            expect(await actor.name()).to.equal("TestActor");
            expect(await actor.symbol()).to.equal("TA");
        });
    });

    describe("Register Actor", function () {
        it("Should registerActor(), set token URI & return the Id", async function () {
            await actor.connect(authorizedContract).registerActor(account1.address, hash);
            const actorId = 0;
            expect(await actor.ownerOf(actorId)).to.equal(account1.address);
            expect(await actor.tokenURI(actorId)).to.equal(`ipfs://${hash}`);
        });

        it("Should revert when registering an already registered actor", async function () {
            await actor.connect(authorizedContract).registerActor(account1.address, hash);
            await expect(actor.connect(authorizedContract).registerActor(account1.address, hash))
                .to.be.revertedWithCustomError(actor, "DoubleRegistrationNotAllowed");
        });

        it("Should increment the actor Id correctly", async function () {
            await actor.connect(authorizedContract).registerActor(account1.address, "hash1");
            await actor.connect(authorizedContract).registerActor(account2.address, "hash2");
            expect(await actor.ownerOf(0)).to.equal(account1.address);
            expect(await actor.ownerOf(1)).to.equal(account2.address);
        });

        it("Should return true if idExists()", async function () {
            expect(await actor.idExists(0)).to.be.false;
            await actor.connect(authorizedContract).registerActor(account1.address, hash);
            expect(await actor.idExists(0)).to.be.true;
        });

        it("Should return false if idExists()", async function () {
            const exists = await actor.idExists(await actor.totalSupply());
            expect(exists).to.be.false;
        });
    });

    describe("Update Actor", function () {
        it("Should update the actor's token URI", async function () {
            await actor.connect(authorizedContract).registerActor(account1.address, hash);
            const tokenId = 0;
            await actor.connect(authorizedContract).updateActor(tokenId, newHash);
            expect(await actor.tokenURI(tokenId)).to.equal(`ipfs://${newHash}`);
        });
    });

    describe("ERC721 Overrides", function () {
        it("Should support the necessary interfaces", async function () {
            expect(await actor.supportsInterface("0x80ac58cd")).to.be.true; // ERC721
            expect(await actor.supportsInterface("0x5b5e139f")).to.be.true; // ERC721Metadata
            expect(await actor.supportsInterface("0x780e9d63")).to.be.true; // ERC721Enumerable
        });

        it("Should return the correct tokenURI", async function () {
            await actor.connect(authorizedContract).registerActor(account1.address, hash);
            const tokenId = 0;
            expect(await actor.tokenURI(tokenId)).to.equal(`ipfs://${hash}`);
        });
    });

    describe("Soulbound Tokens", function () {
        it("Should revert on transferFrom()", async function () {
            await actor.connect(authorizedContract).registerActor(account1.address, "hash1");
            const tokenId = 0;
            await expect(actor.connect(account1).transferFrom(account1.address, account2.address, tokenId))
                .to.be.revertedWithCustomError(actor, "SoulBoundTransferNotAllowed");
        });

        it("Should revert on safeTransferFrom()", async function () {
            await actor.connect(authorizedContract).registerActor(account1.address, "hash1");
            const tokenId = 0;
            await expect(actor.connect(account1)["safeTransferFrom(address,address,uint256)"](account1.address, account2.address, tokenId))
                .to.be.revertedWithCustomError(actor, "SoulBoundTransferNotAllowed");
        });

        it("Should revert on safeTransferFrom(data)", async function () {
            await actor.connect(authorizedContract).registerActor(account1.address, "hash1");
            const tokenId = 0;
            await expect(actor.connect(account1)["safeTransferFrom(address,address,uint256,bytes)"](account1.address, account2.address, tokenId, "0x"))
                .to.be.revertedWithCustomError(actor, "SoulBoundTransferNotAllowed");
        });
    });
});
```
