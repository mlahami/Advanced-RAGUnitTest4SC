// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MultiSigWallet {
    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public immutable required;

    struct Transaction {
        address payable to;
        uint256 value;
        bool executed;
        uint256 confirmations;
    }

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmed;

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length >= _required && _required > 0, "bad threshold");
        for (uint256 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0) && !isOwner[_owners[i]], "bad owner");
            isOwner[_owners[i]] = true;
            owners.push(_owners[i]);
        }
        required = _required;
    }

    receive() external payable {}

    modifier onlyOwner() {
        require(isOwner[msg.sender], "not owner");
        _;
    }

    function submit(address payable to, uint256 value) external onlyOwner returns (uint256) {
        transactions.push(Transaction(to, value, false, 0));
        return transactions.length - 1;
    }

    function confirm(uint256 id) external onlyOwner {
        require(!confirmed[id][msg.sender], "already confirmed");
        require(!transactions[id].executed, "executed");
        confirmed[id][msg.sender] = true;
        transactions[id].confirmations += 1;
    }

    function execute(uint256 id) external onlyOwner {
        Transaction storage txn = transactions[id];
        require(!txn.executed, "executed");
        require(txn.confirmations >= required, "not enough confirmations");
        txn.executed = true;
        (bool ok,) = txn.to.call{value: txn.value}("");
        require(ok, "transfer failed");
    }
}

