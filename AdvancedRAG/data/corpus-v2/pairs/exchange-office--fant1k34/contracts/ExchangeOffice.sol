// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

contract ExchangeOffice {
    address owner;

    uint public const = 1 ether;
    uint public currencyBuyPrice = 1;
    uint public currencySellPrice = 1;

    mapping (address => uint256) tokenBalances;

    uint minimumAmountPerTransaction = 5;

    constructor() {
        owner = msg.sender;
    }

    // Only owner can get put any amount of ETH into Exchange Office
    function _fillMoney() public payable {
        require(msg.sender == owner, "Only the owner can sent money to Contract");
    }

    // Only owner can get put any amount of Tokens into Exchange Office
    function _fillToken(uint amount) public {
        require(msg.sender == owner, "Only the owner can refill Tokens");
        tokenBalances[address(this)] += amount;
    }

    // Only owner can get ALL ETH from Exchange Office
    function _getMoney() public {
        require(msg.sender == owner, "Only the owner can get money from Contract");

        address payable _to = payable (owner);
        _to.transfer(address(this).balance);
    }

    // Only owner can update currency rate at Exchange Office
    function _updateCurrency(uint buyPrice, uint sellPrice) public {
        require(msg.sender == owner, "Only the owner can update Currency Change");
        require(buyPrice >= sellPrice, "SellPrice can not be more than BuyPrice");

        currencyBuyPrice = buyPrice;
        currencySellPrice = sellPrice;
    }

    function buyTokens() public payable {
        uint amount = msg.value / currencyBuyPrice / const;

        require(amount >= minimumAmountPerTransaction, "Minimum value per transaction is not followed");
        require(tokenBalances[address(this)] >= amount, "Not enough tokens in stock to complete this purchase");


        tokenBalances[address(this)] -= amount;
        tokenBalances[msg.sender] += amount;
    }

    function sellTokens(uint256 amount) public {
        require(amount >= minimumAmountPerTransaction, "Minimum value per transaction is not followed");
        require(tokenBalances[msg.sender] >= amount, "Not enough tokens to sell");

        address payable _to = payable (msg.sender);
        _to.transfer(amount * currencySellPrice * const);

        tokenBalances[address(this)] += amount;
        tokenBalances[msg.sender] -= amount;
    }

    function getInStock() public view returns (uint) {
        return tokenBalances[address(this)];
    }

    function getYoursTokenBalance() public view returns (uint) {
        return tokenBalances[msg.sender];
    }
}
