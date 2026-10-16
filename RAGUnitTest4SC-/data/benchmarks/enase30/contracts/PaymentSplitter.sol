// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PaymentSplitter {
    address payable[] public payees;
    mapping(address => uint256) public shares;
    uint256 public totalShares;

    constructor(address payable[] memory _payees, uint256[] memory _shares) {
        require(_payees.length == _shares.length && _payees.length > 0, "bad input");
        for (uint256 i = 0; i < _payees.length; i++) {
            require(_payees[i] != address(0) && _shares[i] > 0, "bad payee");
            payees.push(_payees[i]);
            shares[_payees[i]] = _shares[i];
            totalShares += _shares[i];
        }
    }

    receive() external payable {}

    function distribute() external {
        uint256 balance = address(this).balance;
        require(balance > 0, "no funds");
        for (uint256 i = 0; i < payees.length; i++) {
            uint256 amount = balance * shares[payees[i]] / totalShares;
            payees[i].transfer(amount);
        }
    }
}

