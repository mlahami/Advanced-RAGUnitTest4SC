// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract Lottery {
    address public manager;
    address[] public players;
    address public lastWinner; // Variable to store the address of the last winner
    
    constructor() {
        manager = msg.sender;
    }
    
    function enter() public payable {
        require(msg.value >= 0.001 ether, "Minimum ether not met");
        players.push(msg.sender);
    }
    
    function random() private view returns (uint) {
        return uint(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, players)));
    }

     function pickWinner() public restricted {
        uint index = random() % players.length;
        lastWinner = players[index]; // Set the last winner
        payable(players[index]).transfer(address(this).balance);
        players = new address[](0) ;
    }
    
    modifier restricted() {
        require(msg.sender == manager, "Only manager can call this function");
        _;
    }

    function getPlayers() public view returns (address[] memory) {
        return players;
    }

    function getLastWinner() public view returns (address) {
        return lastWinner; // Return the address of the last winner
    }
}
