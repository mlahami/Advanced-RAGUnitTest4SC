// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract TextStorage is ERC2771Context {
    mapping(address => string[]) public texts;

    event TextStored(address indexed writer, string text);

    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {}

    // 메타 트랜잭션을 지원하는 함수
    function storeText(string calldata text) public {
        address sender = _msgSender();
        texts[sender].push(text);
        emit TextStored(sender, text);
    }
}
