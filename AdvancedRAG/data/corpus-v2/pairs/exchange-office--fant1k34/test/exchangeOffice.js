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
