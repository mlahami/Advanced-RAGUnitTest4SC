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

