
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAVGXAMM
 * @dev Interface for the AVGX AMM contract
 */
interface IAVGXAMM {
    struct AMMParams {
        uint256 feeBps;
        uint256 spreadBps;
        address feeRecipient;
        address treasury;
    }

    event MintedWithBase(address indexed user, uint256 baseIn, uint256 avgxOut, uint256 fee);
    event RedeemedForBase(address indexed user, uint256 avgxIn, uint256 baseOut, uint256 fee);
    event ParamsUpdated(AMMParams params);

    error SlippageExceeded();
    error InsufficientLiquidity();
    error InvalidAmount();

    /**
     * @dev Mints AVGX tokens with base asset
     * @param baseIn Amount of base asset to deposit
     * @param minAvgxOut Minimum AVGX tokens to receive
     * @param to Address to receive AVGX tokens
     * @return avgxOut Amount of AVGX tokens minted
     */
    function mintWithBase(uint256 baseIn, uint256 minAvgxOut, address to) external returns (uint256 avgxOut);

    /**
     * @dev Redeems AVGX tokens for base asset
     * @param avgxIn Amount of AVGX tokens to redeem
     * @param minBaseOut Minimum base asset to receive
     * @param to Address to receive base asset
     * @return baseOut Amount of base asset received
     */
    function redeemForBase(uint256 avgxIn, uint256 minBaseOut, address to) external returns (uint256 baseOut);

    /**
     * @dev Gets quote for minting AVGX with base asset
     * @param baseIn Amount of base asset
     * @return avgxOut Amount of AVGX tokens to receive
     * @return fee Fee amount in base asset
     */
    function getQuoteMint(uint256 baseIn) external view returns (uint256 avgxOut, uint256 fee);

    /**
     * @dev Gets quote for redeeming AVGX for base asset
     * @param avgxIn Amount of AVGX tokens
     * @return baseOut Amount of base asset to receive
     * @return fee Fee amount in base asset
     */
    function getQuoteRedeem(uint256 avgxIn) external view returns (uint256 baseOut, uint256 fee);

    /**
     * @dev Updates AMM parameters
     * @param params New AMM parameters
     */
    function updateParams(AMMParams memory params) external;

    /**
     * @dev Pauses the AMM
     */
    function pause() external;

    /**
     * @dev Unpauses the AMM
     */
    function unpause() external;
}
