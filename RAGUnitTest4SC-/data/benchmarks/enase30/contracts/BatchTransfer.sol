// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BatchTransfer
 * @notice Gas-efficient batch distribution of ETH or ERC20 tokens
 *         to multiple recipients in one transaction.
 * Complexity: Moderate
 */
interface IERC20Transfer {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract BatchTransfer {
    event ETHBatchSent(uint256 totalRecipients, uint256 totalAmount);
    event ERC20BatchSent(address indexed token, uint256 totalRecipients, uint256 totalAmount);

    // â”€â”€â”€ ETH batch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * @notice Send equal ETH amounts to all recipients.
     *         msg.value must equal amountEach * recipients.length.
     */
    function batchSendEqual(address[] calldata recipients, uint256 amountEach) external payable {
        uint256 len = recipients.length;
        require(len > 0, "No recipients");
        require(msg.value == amountEach * len, "Wrong ETH");

        for (uint256 i = 0; i < len; ) {
            (bool ok,) = recipients[i].call{value: amountEach}("");
            require(ok, "ETH send failed");
            unchecked { i++; }
        }
        emit ETHBatchSent(len, msg.value);
    }

    /**
     * @notice Send variable ETH amounts to recipients.
     *         msg.value must equal sum of amounts[].
     */
    function batchSendVariable(address[] calldata recipients, uint256[] calldata amounts) external payable {
        uint256 len = recipients.length;
        require(len == amounts.length, "Length mismatch");
        uint256 total;
        for (uint256 i = 0; i < len; ) {
            total += amounts[i];
            unchecked { i++; }
        }
        require(msg.value == total, "Wrong ETH");

        for (uint256 i = 0; i < len; ) {
            (bool ok,) = recipients[i].call{value: amounts[i]}("");
            require(ok, "ETH send failed");
            unchecked { i++; }
        }
        emit ETHBatchSent(len, total);
    }

    // â”€â”€â”€ ERC20 batch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * @notice Batch-transfer equal ERC20 amounts.
     *         Caller must have approved this contract for total amount.
     */
    function batchSendERC20Equal(
        address token,
        address[] calldata recipients,
        uint256 amountEach
    ) external {
        uint256 len = recipients.length;
        require(len > 0, "No recipients");
        IERC20Transfer t = IERC20Transfer(token);
        for (uint256 i = 0; i < len; ) {
            require(t.transferFrom(msg.sender, recipients[i], amountEach), "Transfer failed");
            unchecked { i++; }
        }
        emit ERC20BatchSent(token, len, amountEach * len);
    }

    /**
     * @notice Batch-transfer variable ERC20 amounts.
     */
    function batchSendERC20Variable(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        uint256 len = recipients.length;
        require(len == amounts.length, "Length mismatch");
        IERC20Transfer t = IERC20Transfer(token);
        uint256 total;
        for (uint256 i = 0; i < len; ) {
            require(t.transferFrom(msg.sender, recipients[i], amounts[i]), "Transfer failed");
            total += amounts[i];
            unchecked { i++; }
        }
        emit ERC20BatchSent(token, len, total);
    }

    // Refuse accidental ETH sent without calling a function
    receive() external payable { revert("Use batchSend functions"); }
}

