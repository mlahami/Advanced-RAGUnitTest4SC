# logger--brenkib

- domain: escrow-conditional-payments (payments)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/brenkib/solidity-playground @ 95b096f8d99e114b263b94357d32347ec45d2c6f
- license: MIT
- targets: Logger.sol
- validation: 1 passing tests, 0 failing; statement coverage Logger.sol 100.0 %

## Contract: ILogger.sol (dependency)

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface ILogger {
    function log(address _from, uint _amount) external;

    function getEntry(address _from, uint _index) external view returns(uint);
}
```

## Contract: Logger.sol (primary target)

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./ILogger.sol";

contract Logger is ILogger{
    mapping(address => uint[]) private payments;

    function log(address _from, uint _amount) public {
        require(_from != address(0), "Zero address!");

        payments[_from].push(_amount);
    }


    function getEntry(address _from, uint _index) public view returns(uint)  {
        return payments[_from][_index];
    }
    constructor(){

    }
}


contract DemoWithLogger {

    receive() external payable {
        logger.log(msg.sender, msg.value);
    }

    ILogger internal logger;

    constructor(address _logger) {
        logger = ILogger(_logger);
    }

    function payment(address _from, uint _number) public view returns(uint)  {
        return logger.getEntry(_from, _number);
    }
}
```

## Tests: Logger.test.js

```javascript
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
```
