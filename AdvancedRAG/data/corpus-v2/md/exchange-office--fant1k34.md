# exchange-office--fant1k34

- domain: amm-dex (amm-dex)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Fant1k34/Smart-contract @ 159b45b4133aa906b913f369218a47a71e8ab5d3
- license: MIT
- targets: ExchangeOffice.sol
- validation: 8 passing tests, 0 failing; statement coverage ExchangeOffice.sol 93.75 %

## Contract: ExchangeOffice.sol (primary target)

```solidity
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
```

## Tests: exchangeOffice.js

```javascript
const {expect} = require('chai')

describe("Exchange Office contract", function () {
    it("Deployment should assign tokens in stock as 0, owner balance as 0, currencyBuyPrice and currencySellPrice as 1",
        async function () {
            const contract = await ethers.deployContract("ExchangeOffice")

            const amountOfTokens = await contract.getInStock()
            const balance = await contract.getYoursTokenBalance()
            const currencyBuyPrice = await contract.currencyBuyPrice()
            const currencySellPrice = await contract.currencySellPrice()

            expect(await amountOfTokens).to.equal(0)
            expect(await balance).to.equal(0)
            expect(await currencyBuyPrice).to.equal(1)
            expect(await currencySellPrice).to.equal(1)
        })

    it("Owner should assign currency rate with condition of Buy Price >= Sell Price", async function () {
        const pairsToCheck = [[3, 2], [4, 4], [4, 5]]

        for ([buyPr, sellPr] of pairsToCheck) {
            const contract = await ethers.deployContract("ExchangeOffice")

            try {
                await contract._updateCurrency(buyPr, sellPr)
            } catch (e) {
            }


            const currencyBuyPrice = await contract.currencyBuyPrice()
            const currencySellPrice = await contract.currencySellPrice()

            if (buyPr >= sellPr) {
                expect(await currencyBuyPrice).to.equal(buyPr)
                expect(await currencySellPrice).to.equal(sellPr)
            } else {
                expect(await currencyBuyPrice).not.to.equal(buyPr)
                expect(await currencySellPrice).not.to.equal(sellPr)
            }
        }
    })

    it("User should buy tokens and increase amount of tokens in their wallet", async function () {
        const contract = await ethers.deployContract("ExchangeOffice")
        const money = BigInt(15.0)

        await contract._fillToken(10000)
        await contract._updateCurrency(3, 2)

        const amountOfTokens0 = await contract.getInStock()
        const balance0 = await contract.getYoursTokenBalance()
        const currencyBuyPrice = await contract.currencyBuyPrice()

        const options = { value: money * BigInt(1000000000000000000) }
        await contract.buyTokens(options)

        const amountOfTokens1 = await contract.getInStock()
        const balance1 = await contract.getYoursTokenBalance()

        expect(await balance1).to.equal(await balance0 + (money / currencyBuyPrice))
        expect(await amountOfTokens1).to.equal(await amountOfTokens0 - (money / currencyBuyPrice))
    })

    it("User should not buy tokens less than 5 per transaction", async function () {
        const contract = await ethers.deployContract("ExchangeOffice")
        const money = BigInt(10.0)

        await contract._fillToken(10000)
        await contract._updateCurrency(3, 2)

        const amountOfTokens0 = await contract.getInStock()
        const balance0 = await contract.getYoursTokenBalance()
        const currencyBuyPrice = await contract.currencyBuyPrice()

        try {
            const options = {value: money * BigInt(1000000000000000000)}
            await contract.buyTokens(options)
        } catch (e) {
            expect(e.message).to.contains("Minimum value per transaction is not followed")
        }

        const amountOfTokens1 = await contract.getInStock()
        const balance1 = await contract.getYoursTokenBalance()

        expect(await balance1).not.to.equal(await balance0 + (money / currencyBuyPrice))
        expect(await amountOfTokens1).not.to.equal(await amountOfTokens0 - (money / currencyBuyPrice))
    })

    it("User should not buy more tokens than there are in stock", async function () {
        const contract = await ethers.deployContract("ExchangeOffice")
        const money = BigInt(150.0)

        await contract._fillToken(10)
        await contract._updateCurrency(3, 2)

        const amountOfTokens0 = await contract.getInStock()
        const balance0 = await contract.getYoursTokenBalance()
        const currencyBuyPrice = await contract.currencyBuyPrice()

        try {
            const options = {value: money * BigInt(1000000000000000000)}
            await contract.buyTokens(options)
        } catch (e) {
            expect(e.message).to.contains("Not enough tokens in stock to complete this purchase")
        }

        const amountOfTokens1 = await contract.getInStock()
        const balance1 = await contract.getYoursTokenBalance()

        expect(await balance1).not.to.equal(await balance0 + (money / currencyBuyPrice))
        expect(await amountOfTokens1).not.to.equal(await amountOfTokens0 - (money / currencyBuyPrice))
    })

    it("User should sell tokens and decrease amount of tokens in their wallet", async function () {
        const contract = await ethers.deployContract("ExchangeOffice")

        await contract._fillToken(10000)
        await contract._updateCurrency(3, 2)

        const options = { value: BigInt(150) * BigInt(1000000000000000000) }
        await contract.buyTokens(options)

        await contract.sellTokens(20)

        const amountOfTokens1 = await contract.getInStock()
        const balance1 = await contract.getYoursTokenBalance()

        expect(await balance1).to.equal(30)
        expect(await amountOfTokens1).to.equal(9970)
    })

    it("User should not sell tokens more than in their wallet", async function () {
        const contract = await ethers.deployContract("ExchangeOffice")

        await contract._fillToken(10000)
        await contract._updateCurrency(3, 2)

        const options = { value: BigInt(150) * BigInt(1000000000000000000) }
        await contract.buyTokens(options)

        try {
            await contract.sellTokens(70)
        } catch (e) {
            expect(e.message).to.contains("Not enough tokens to sell")
        }

        const amountOfTokens1 = await contract.getInStock()
        const balance1 = await contract.getYoursTokenBalance()

        expect(await balance1).not.to.equal(80)
        expect(await amountOfTokens1).not.to.equal(9920)
    })

    it("User should not sell tokens if there are not enough ETH in Exchanger", async function () {
        const contract = await ethers.deployContract("ExchangeOffice")

        await contract._fillToken(10000)
        await contract._updateCurrency(3, 2)

        const options1 = { value: BigInt(15) * BigInt(1000000000000000000) }
        await contract.buyTokens(options1)

        await contract._getMoney()

        await contract.buyTokens(options1)

        try {
            await contract.sellTokens(10)
        } catch (e) {
            expect(e).not.to.equal(null)
        }

        const amountOfTokens1 = await contract.getInStock()
        const balance1 = await contract.getYoursTokenBalance()

        expect(await balance1).not.to.equal(0)
        expect(await amountOfTokens1).not.to.equal(10000)
    })
})
```
