// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title L1GasPriceOracle
 * @author TeQoin
 * @notice Tracks L1 gas prices and calculates L1 data fees for L2 transactions.
 *         Updated by the sequencer every L1 block (~12 seconds) via system transaction.
 *
 * @dev This contract is the economic engine of TeQoin L2. Every transaction's L1 data
 *      fee is calculated by reading from this Oracle. The hot path (getL1Fee) is
 *      Yul-optimized to minimize gas overhead per transaction.
 *
 *      Fee Formula:
 *        L1_Fee = getL1Fee(txData)
 *               = txDataCost(txData) × l1BaseFee × scalar / PRECISION
 *
 *        Where:
 *          txDataCost = (zeroBytes × 4 + nonZeroBytes × 16) × compressionRatio / PRECISION
 *          scalar     = PID-controlled dynamic multiplier (1.02x to 1.80x)
 *
 *      Storage Layout (fixed slots for future upgradeability):
 *        slot 0: l1BaseFee
 *        slot 1: l1BlobBaseFee
 *        slot 2: scalar (stored as X * 1e6, e.g., 1050000 = 1.05x)
 *        slot 3: compressionRatio (stored as X * 1e6, e.g., 450000 = 0.45)
 *        slot 4: lastUpdateBlock (L2 block number of last update)
 *        slot 5: sequencer (address — only caller allowed to update)
 *        slot 6: owner (address — can change sequencer)
 *        slot 7: l1BaseFeeScalar (for future use — per-byte L1 calldata cost weight)
 *        slot 8: l1BlobBaseFeeScalar (for future use — per-byte blob cost weight)
 *        slot 9: useBlobPricing (bool — whether to use blob or calldata pricing)
 *
 *      Upgrade Path:
 *        Stage 1 (now):     Sequencer updates via regular tx (or system tx)
 *        Stage 2 (geth fork): geth reads this contract on eth_estimateGas
 *        Stage 3 (embedded):  Contract becomes thin wrapper over geth internals
 */
contract L1GasPriceOracle {
    // ═══════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════

    /// @notice Precision for scalar and compression ratio (1e6 = 6 decimal places)
    uint256 public constant PRECISION = 1_000_000;

    /// @notice Minimum scalar (1.01x)
    uint256 public constant SCALAR_MIN = 1_010_000;

    /// @notice Maximum scalar (2.00x)
    uint256 public constant SCALAR_MAX = 2_000_000;

    /// @notice Minimum compression ratio (0.1 = 10%)
    uint256 public constant COMPRESSION_MIN = 100_000;

    /// @notice Maximum compression ratio (1.0 = 100% = no compression)
    uint256 public constant COMPRESSION_MAX = 1_000_000;

    /// @notice Gas cost per zero byte of calldata (EIP-2028)
    uint256 internal constant TX_DATA_ZERO_GAS = 4;

    /// @notice Gas cost per non-zero byte of calldata (EIP-2028)
    uint256 internal constant TX_DATA_NON_ZERO_GAS = 16;

    // ═══════════════════════════════════════════════════════
    // STORAGE (fixed slots — do not reorder)
    // ═══════════════════════════════════════════════════════

    /// @notice Current L1 base fee in wei
    uint256 public l1BaseFee; // slot 0

    /// @notice Current L1 blob base fee in wei
    uint256 public l1BlobBaseFee; // slot 1

    /// @notice Dynamic scalar (PID-controlled), stored as X * 1e6
    ///         Example: 1_050_000 = 1.05x multiplier
    uint256 public scalar; // slot 2

    /// @notice Compression ratio, stored as X * 1e6
    ///         Example: 450_000 = 0.45 (55% compression)
    uint256 public compressionRatio; // slot 3

    /// @notice L2 block number when Oracle was last updated
    uint256 public lastUpdateBlock; // slot 4

    /// @notice Sequencer address (only address that can update pricing)
    address public sequencer; // slot 5

    /// @notice Owner address (can change sequencer, emergency controls)
    address public owner; // slot 6

    /// @notice Scalar for L1 calldata pricing (future use)
    uint256 public l1BaseFeeScalar; // slot 7

    /// @notice Scalar for blob pricing (future use)
    uint256 public l1BlobBaseFeeScalar; // slot 8

    /// @notice Whether to use blob pricing (true) or calldata pricing (false)
    bool public useBlobPricing; // slot 9

    // ═══════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════

    event L1GasDataUpdated(uint256 l1BaseFee, uint256 l1BlobBaseFee, uint256 compressionRatio, uint256 updateBlock);

    event ScalarUpdated(uint256 oldScalar, uint256 newScalar);

    event SequencerUpdated(address indexed oldSequencer, address indexed newSequencer);

    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);

    event BlobPricingToggled(bool useBlobPricing);

    // ═══════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════

    error OnlySequencer();
    error OnlyOwner();
    error InvalidScalar();
    error InvalidCompressionRatio();
    error ZeroAddress();
    error StaleUpdate();

    // ═══════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════

    modifier onlySequencer() {
        if (msg.sender != sequencer) revert OnlySequencer();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ═══════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════

    /**
     * @param _sequencer   Address of the sequencer that updates pricing
     * @param _scalar      Initial scalar (recommended: 1_100_000 = 1.10x)
     * @param _compression Initial compression ratio (recommended: 500_000 = 0.50)
     */
    constructor(address _sequencer, uint256 _scalar, uint256 _compression) {
        if (_sequencer == address(0)) revert ZeroAddress();
        if (_scalar < SCALAR_MIN || _scalar > SCALAR_MAX) revert InvalidScalar();
        if (_compression < COMPRESSION_MIN || _compression > COMPRESSION_MAX) revert InvalidCompressionRatio();

        owner = msg.sender;
        sequencer = _sequencer;
        scalar = _scalar;
        compressionRatio = _compression;

        // Defaults
        l1BaseFee = 30 gwei;
        l1BlobBaseFee = 1 gwei;
        l1BaseFeeScalar = PRECISION;
        l1BlobBaseFeeScalar = PRECISION;
        useBlobPricing = false;
    }

    // ═══════════════════════════════════════════════════════
    // SEQUENCER UPDATE FUNCTIONS
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Update L1 gas data. Called by sequencer every L1 block (~12s).
     *         On TeQoin L2, this is a system transaction with zero gas cost.
     *
     * @param _l1BaseFee        Current L1 base fee in wei
     * @param _l1BlobBaseFee    Current L1 blob base fee in wei
     * @param _compressionRatio Current compression ratio (X * 1e6)
     */
    function setL1GasData(uint256 _l1BaseFee, uint256 _l1BlobBaseFee, uint256 _compressionRatio)
        external
        onlySequencer
    {
        if (_compressionRatio < COMPRESSION_MIN || _compressionRatio > COMPRESSION_MAX) {
            revert InvalidCompressionRatio();
        }

        l1BaseFee = _l1BaseFee;
        l1BlobBaseFee = _l1BlobBaseFee;
        compressionRatio = _compressionRatio;
        lastUpdateBlock = block.number;

        emit L1GasDataUpdated(_l1BaseFee, _l1BlobBaseFee, _compressionRatio, block.number);
    }

    /**
     * @notice Update the dynamic scalar. Called by sequencer when PID adjusts.
     * @param _newScalar New scalar value (X * 1e6)
     */
    function setScalar(uint256 _newScalar) external onlySequencer {
        if (_newScalar < SCALAR_MIN || _newScalar > SCALAR_MAX) revert InvalidScalar();

        uint256 oldScalar = scalar;
        scalar = _newScalar;

        emit ScalarUpdated(oldScalar, _newScalar);
    }

    /**
     * @notice Batch update: gas data + scalar in one transaction.
     *         Saves gas when both need updating (most common case).
     */
    function setL1GasDataAndScalar(
        uint256 _l1BaseFee,
        uint256 _l1BlobBaseFee,
        uint256 _compressionRatio,
        uint256 _newScalar
    ) external onlySequencer {
        if (_compressionRatio < COMPRESSION_MIN || _compressionRatio > COMPRESSION_MAX) {
            revert InvalidCompressionRatio();
        }
        if (_newScalar < SCALAR_MIN || _newScalar > SCALAR_MAX) revert InvalidScalar();

        l1BaseFee = _l1BaseFee;
        l1BlobBaseFee = _l1BlobBaseFee;
        compressionRatio = _compressionRatio;
        lastUpdateBlock = block.number;

        uint256 oldScalar = scalar;
        scalar = _newScalar;

        emit L1GasDataUpdated(_l1BaseFee, _l1BlobBaseFee, _compressionRatio, block.number);
        if (oldScalar != _newScalar) {
            emit ScalarUpdated(oldScalar, _newScalar);
        }
    }

    // ═══════════════════════════════════════════════════════
    // FEE CALCULATION (YUL-OPTIMIZED HOT PATH)
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Calculate the L1 data fee for a given transaction.
     *         This is the HOT PATH — called for every transaction estimate.
     *         Yul-optimized to minimize gas overhead.
     *
     * @param _data The transaction data (calldata) to estimate fee for
     * @return fee  The L1 data fee in wei
     *
     * @dev Formula:
     *   dataGas = (zeroBytes * 4 + nonZeroBytes * 16)
     *   compressedGas = dataGas * compressionRatio / PRECISION
     *   baseCost = compressedGas * l1Price
     *   fee = baseCost * scalar / PRECISION
     *
     *   Where l1Price = useBlobPricing ? l1BlobBaseFee : l1BaseFee
     */
    function getL1Fee(bytes calldata _data) external view returns (uint256 fee) {
        assembly {
            let dataLen := _data.length
            let dataOffset := _data.offset
            let zeroCount := 0

            let chunks := div(dataLen, 32)
            let remainder := mod(dataLen, 32)

            for { let i := 0 } lt(i, chunks) { i := add(i, 1) } {
                let word := calldataload(add(dataOffset, mul(i, 32)))
                for { let j := 0 } lt(j, 32) { j := add(j, 1) } {
                    let b := byte(j, word)
                    if iszero(b) { zeroCount := add(zeroCount, 1) }
                }
            }

            if gt(remainder, 0) {
                let word := calldataload(add(dataOffset, mul(chunks, 32)))
                for { let j := 0 } lt(j, remainder) { j := add(j, 1) } {
                    let b := byte(j, word)
                    if iszero(b) { zeroCount := add(zeroCount, 1) }
                }
            }

            let nonZeroCount := sub(dataLen, zeroCount)

            let dataGas := add(mul(zeroCount, 4), mul(nonZeroCount, 16))
            dataGas := add(dataGas, 1088)

            let compRatio := sload(3)
            let compressedGas := div(mul(dataGas, compRatio), 1000000)

            let useBlob := sload(9)
            let l1Price
            switch useBlob
            case 0 { l1Price := sload(0) }
            default { l1Price := sload(1) }

            let baseCost := mul(compressedGas, l1Price)
            let scalarVal := sload(2)
            fee := div(mul(baseCost, scalarVal), 1000000)
        }
    }

    /**
     * @notice Estimate L1 gas units for a transaction (before price multiplication).
     *         Useful for debugging and fee breakdown display.
     *
     * @param _data The transaction data
     * @return gasUsed Estimated L1 gas units (compressed)
     */
    function getL1GasUsed(bytes calldata _data) external view returns (uint256 gasUsed) {
        assembly {
            let dataLen := _data.length
            let dataOffset := _data.offset
            let zeroCount := 0

            let chunks := div(dataLen, 32)
            let remainder := mod(dataLen, 32)

            for { let i := 0 } lt(i, chunks) { i := add(i, 1) } {
                let word := calldataload(add(dataOffset, mul(i, 32)))
                for { let j := 0 } lt(j, 32) { j := add(j, 1) } {
                    let b := byte(j, word)
                    if iszero(b) { zeroCount := add(zeroCount, 1) }
                }
            }

            if gt(remainder, 0) {
                let word := calldataload(add(dataOffset, mul(chunks, 32)))
                for { let j := 0 } lt(j, remainder) { j := add(j, 1) } {
                    let b := byte(j, word)
                    if iszero(b) { zeroCount := add(zeroCount, 1) }
                }
            }

            let nonZeroCount := sub(dataLen, zeroCount)
            let dataGas := add(mul(zeroCount, 4), mul(nonZeroCount, 16))
            dataGas := add(dataGas, 1088)

            let compRatio := sload(3)
            gasUsed := div(mul(dataGas, compRatio), 1000000)
        }
    }

    /**
     * @notice Get complete fee breakdown for a transaction.
     *         Used by frontend to show users exactly how fees are calculated.
     *
     * @param _data The transaction data
     * @return l1Fee         Total L1 fee in wei
     * @return l1GasUsed     L1 gas units (compressed)
     * @return l1Price       L1 gas price used (baseFee or blobBaseFee)
     * @return currentScalar Current scalar value
     * @return currentRatio  Current compression ratio
     */
    function getFeeBreakdown(bytes calldata _data)
        external
        view
        returns (uint256 l1Fee, uint256 l1GasUsed, uint256 l1Price, uint256 currentScalar, uint256 currentRatio)
    {
        uint256 zeroBytes;
        for (uint256 i = 0; i < _data.length; i++) {
            if (_data[i] == 0) zeroBytes++;
        }
        uint256 nonZeroBytes = _data.length - zeroBytes;

        uint256 dataGas = (zeroBytes * TX_DATA_ZERO_GAS) + (nonZeroBytes * TX_DATA_NON_ZERO_GAS) + 1088;

        currentRatio = compressionRatio;
        l1GasUsed = (dataGas * currentRatio) / PRECISION;

        l1Price = useBlobPricing ? l1BlobBaseFee : l1BaseFee;
        currentScalar = scalar;

        l1Fee = (l1GasUsed * l1Price * currentScalar) / PRECISION;
    }

    // ═══════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Get the current effective L1 gas price (including scalar).
     *         Useful for wallets and frontends.
     */
    function getEffectiveL1Price() external view returns (uint256) {
        uint256 basePrice = useBlobPricing ? l1BlobBaseFee : l1BaseFee;
        return (basePrice * scalar) / PRECISION;
    }

    /**
     * @notice Check if Oracle data is stale (not updated recently).
     * @param _maxAge Maximum acceptable age in L2 blocks
     */
    function isStale(uint256 _maxAge) external view returns (bool) {
        return block.number > lastUpdateBlock + _maxAge;
    }

    /**
     * @notice Get all Oracle parameters in one call.
     *         Minimizes RPC calls from frontend/sequencer.
     */
    function getOracleData()
        external
        view
        returns (
            uint256 _l1BaseFee,
            uint256 _l1BlobBaseFee,
            uint256 _scalar,
            uint256 _compressionRatio,
            uint256 _lastUpdateBlock,
            bool _useBlobPricing
        )
    {
        return (l1BaseFee, l1BlobBaseFee, scalar, compressionRatio, lastUpdateBlock, useBlobPricing);
    }

    // ═══════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Update sequencer address. Only owner.
     */
    function setSequencer(address _newSequencer) external onlyOwner {
        if (_newSequencer == address(0)) revert ZeroAddress();
        address old = sequencer;
        sequencer = _newSequencer;
        emit SequencerUpdated(old, _newSequencer);
    }

    /**
     * @notice Transfer ownership. Only owner.
     */
    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        address old = owner;
        owner = _newOwner;
        emit OwnerUpdated(old, _newOwner);
    }

    /**
     * @notice Toggle between blob pricing and calldata pricing.
     *         Used when switching to EIP-4844 blob submissions.
     */
    function setUseBlobPricing(bool _useBlob) external onlyOwner {
        useBlobPricing = _useBlob;
        emit BlobPricingToggled(_useBlob);
    }

    /**
     * @notice Set L1 base fee scalar (for advanced tuning).
     */
    function setL1BaseFeeScalar(uint256 _scalar) external onlyOwner {
        l1BaseFeeScalar = _scalar;
    }

    /**
     * @notice Set L1 blob base fee scalar (for advanced tuning).
     */
    function setL1BlobBaseFeeScalar(uint256 _scalar) external onlyOwner {
        l1BlobBaseFeeScalar = _scalar;
    }

    /**
     * @notice Emergency: force-set scalar outside PID bounds.
     *         Only for emergencies when PID algorithm fails.
     */
    function emergencySetScalar(uint256 _scalar) external onlyOwner {
        uint256 old = scalar;
        scalar = _scalar;
        emit ScalarUpdated(old, _scalar);
    }
}

