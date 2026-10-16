// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

struct IdentityWithAddress {
    address account;
    string name;
    string role;
}

struct Identity {
    string name;
    string role;
}

contract Entity {
    using EnumerableSet for EnumerableSet.AddressSet;

    error __ENTITY_INVALID_PARAMETER_ERROR(string parameter, string reason);
    error __ENTITY_INVALID_ADDRESS_PARAMETER_ERROR(address parameter, string reason);

    EnumerableSet.AddressSet private _accounts;
    mapping(address => Identity) private _identities;
    address private _authorizedCaller;
    string private _entityName;

    event ENTITY_IdentityAdded(address indexed account, string name, string role);
    event ENTITY_IdentityUpdated(address indexed account, string name, string role);
    event ENTITY_IdentityRemoved(address indexed account);
    event ENTITY_EntityNameUpdated(string oldName, string newName);

    constructor(address authorizedCaller, string memory entityName) {
        if (authorizedCaller == address(0))
            revert __ENTITY_INVALID_ADDRESS_PARAMETER_ERROR(authorizedCaller, "Invalid authorized caller address");
        if (bytes(entityName).length == 0) revert __ENTITY_INVALID_PARAMETER_ERROR("entityName", "Invalid entity name");
        _authorizedCaller = authorizedCaller;
        _entityName = entityName;
    }

    modifier onlyAuthorizedCaller() {
        if (msg.sender != _authorizedCaller)
            revert __ENTITY_INVALID_ADDRESS_PARAMETER_ERROR(msg.sender, "Caller is not authorized");
        _;
    }

    function updateEntityName(string calldata newName) external onlyAuthorizedCaller {
        if (bytes(newName).length == 0) revert __ENTITY_INVALID_PARAMETER_ERROR("entityName", "Invalid entity name");
        string memory old = _entityName;
        _entityName = newName;
        emit ENTITY_EntityNameUpdated(old, newName);
    }

    function addIdentity(address account, string calldata name, string calldata role) external onlyAuthorizedCaller {
        if (account == address(0)) revert __ENTITY_INVALID_ADDRESS_PARAMETER_ERROR(account, "Invalid person address");
        if (_accounts.contains(account)) revert __ENTITY_INVALID_PARAMETER_ERROR("person", "Person already exists");
        _accounts.add(account);
        _identities[account] = Identity(name, role);
        emit ENTITY_IdentityAdded(account, name, role);
    }

    function updateIdentity(address account, string calldata name, string calldata role) external onlyAuthorizedCaller {
        if (!_accounts.contains(account)) revert __ENTITY_INVALID_ADDRESS_PARAMETER_ERROR(account, "Person not found");
        _identities[account] = Identity(name, role);
        emit ENTITY_IdentityUpdated(account, name, role);
    }

    function removeIdentity(address account) external onlyAuthorizedCaller {
        if (!_accounts.contains(account)) revert __ENTITY_INVALID_ADDRESS_PARAMETER_ERROR(account, "Person not found");
        _accounts.remove(account);
        delete _identities[account];
        emit ENTITY_IdentityRemoved(account);
    }

    function getIdentity(address account) external view returns (string memory name, string memory role) {
        if (!_accounts.contains(account)) revert __ENTITY_INVALID_ADDRESS_PARAMETER_ERROR(account, "Person not found");
        Identity storage p = _identities[account];
        return (p.name, p.role);
    }

    function listAccounts() external view returns (address[] memory) {
        return _accounts.values();
    }
    function getEntityName() external view returns (string memory) {
        return _entityName;
    }

    function listIdentitiesWithAddress() external view returns (IdentityWithAddress[] memory) {
        address[] memory accounts = _accounts.values();
        IdentityWithAddress[] memory identitiesWithAddress = new IdentityWithAddress[](accounts.length);

        for (uint256 i = 0; i < accounts.length; i++) {
            Identity storage p = _identities[accounts[i]];
            identitiesWithAddress[i] = IdentityWithAddress(accounts[i], p.name, p.role);
        }

        return identitiesWithAddress;
    }
}
