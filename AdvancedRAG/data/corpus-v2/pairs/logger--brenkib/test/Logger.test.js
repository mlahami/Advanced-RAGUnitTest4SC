const { expect } = require("chai");
const {ethers} = require("hardhat");

describe("Demo7", function() {
    let owner, demoWithLogger;
    beforeEach(async function() {
        [owner] = await ethers.getSigners();

        const Logger = await ethers.getContractFactory("Logger", owner);
        const logger = await Logger.deploy();
        await logger.waitForDeployment();

        const DemoWithLogger = await ethers.getContractFactory("DemoWithLogger", owner);
        demoWithLogger = await DemoWithLogger.deploy(logger.target);
        await demoWithLogger.waitForDeployment();

    })

    it("should allow to pay and get payment info", async () => {
        const SUM = 100;

        const txData = {
            value: SUM,
            to: demoWithLogger.target,
        }

        const tx = await owner.sendTransaction(txData);
        await tx.wait();
        expect(tx).to.changeEtherBalance(demoWithLogger, SUM);

        const amount = await demoWithLogger.payment(owner, 0);

        expect(amount).to.eq(SUM);
    });

})