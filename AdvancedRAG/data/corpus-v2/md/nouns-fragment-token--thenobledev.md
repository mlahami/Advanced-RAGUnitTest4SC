# nouns-fragment-token--thenobledev

- domain: nft-marketplace (nft)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/TheNobleDev/fractional-nouns @ 2c1acb9608484d286c5005fb187090dd84acac65
- license: MIT
- targets: NounsFragmentToken.sol, IInflator.sol, INounsArt.sol, INounsDescriptorArt.sol, INounsDescriptorMinimal.sol, INounsFragmentDescriptorMinimal.sol, INounsSeeder.sol, INounsToken.sol, Inflate.sol, IProxyRegistry.sol, MockNounsToken.sol
- validation: 17 passing tests, 0 failing; statement coverage NounsFragmentToken.sol 87.5 %, IInflator.sol 100.0 %, INounsArt.sol 100.0 %, INounsDescriptorArt.sol 100.0 %, INounsDescriptorMinimal.sol 100.0 %, INounsFragmentDescriptorMinimal.sol 100.0 %, INounsSeeder.sol 100.0 %, INounsToken.sol 100.0 %, Inflate.sol 0.0 %, IProxyRegistry.sol 100.0 %, MockNounsToken.sol 30.77 %

## Contract: IInflator.sol (dependency)

```solidity
// SPDX-License-Identifier: GPL-3.0

/// @title Interface for Inflator

/*********************************
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░█████████░░█████████░░░ *
 * ░░░░░░██░░░████░░██░░░████░░░ *
 * ░░██████░░░████████░░░████░░░ *
 * ░░██░░██░░░████░░██░░░████░░░ *
 * ░░██░░██░░░████░░██░░░████░░░ *
 * ░░░░░░█████████░░█████████░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 *********************************/

pragma solidity ^0.8.6;

import { Inflate } from './Inflate.sol';

interface IInflator {
    function puff(bytes memory source, uint256 destlen) external pure returns (Inflate.ErrorCode, bytes memory);
}
```

## Contract: Inflate.sol (dependency)

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.0 <0.9.0;

/// @notice Based on https://github.com/madler/zlib/blob/master/contrib/puff
/// @dev Modified the original code for gas optimizations
/// 1. Disable overflow/underflow checks
/// 2. Chunk some loop iterations
library Inflate {
    // Maximum bits in a code
    uint256 constant MAXBITS = 15;
    // Maximum number of literal/length codes
    uint256 constant MAXLCODES = 286;
    // Maximum number of distance codes
    uint256 constant MAXDCODES = 30;
    // Maximum codes lengths to read
    uint256 constant MAXCODES = (MAXLCODES + MAXDCODES);
    // Number of fixed literal/length codes
    uint256 constant FIXLCODES = 288;

    // Error codes
    enum ErrorCode {
        ERR_NONE, // 0 successful inflate
        ERR_NOT_TERMINATED, // 1 available inflate data did not terminate
        ERR_OUTPUT_EXHAUSTED, // 2 output space exhausted before completing inflate
        ERR_INVALID_BLOCK_TYPE, // 3 invalid block type (type == 3)
        ERR_STORED_LENGTH_NO_MATCH, // 4 stored block length did not match one's complement
        ERR_TOO_MANY_LENGTH_OR_DISTANCE_CODES, // 5 dynamic block code description: too many length or distance codes
        ERR_CODE_LENGTHS_CODES_INCOMPLETE, // 6 dynamic block code description: code lengths codes incomplete
        ERR_REPEAT_NO_FIRST_LENGTH, // 7 dynamic block code description: repeat lengths with no first length
        ERR_REPEAT_MORE, // 8 dynamic block code description: repeat more than specified lengths
        ERR_INVALID_LITERAL_LENGTH_CODE_LENGTHS, // 9 dynamic block code description: invalid literal/length code lengths
        ERR_INVALID_DISTANCE_CODE_LENGTHS, // 10 dynamic block code description: invalid distance code lengths
        ERR_MISSING_END_OF_BLOCK, // 11 dynamic block code description: missing end-of-block code
        ERR_INVALID_LENGTH_OR_DISTANCE_CODE, // 12 invalid literal/length or distance code in fixed or dynamic block
        ERR_DISTANCE_TOO_FAR, // 13 distance is too far back in fixed or dynamic block
        ERR_CONSTRUCT // 14 internal: error in construct()
    }

    // Input and output state
    struct State {
        //////////////////
        // Output state //
        //////////////////
        // Output buffer
        bytes output;
        // Bytes written to out so far
        uint256 outcnt;
        /////////////////
        // Input state //
        /////////////////
        // Input buffer
        bytes input;
        // Bytes read so far
        uint256 incnt;
        ////////////////
        // Temp state //
        ////////////////
        // Bit buffer
        uint256 bitbuf;
        // Number of bits in bit buffer
        uint256 bitcnt;
        //////////////////////////
        // Static Huffman codes //
        //////////////////////////
        Huffman lencode;
        Huffman distcode;
    }

    // Huffman code decoding tables
    struct Huffman {
        uint256[] counts;
        uint256[] symbols;
    }

    function bits(State memory s, uint256 need) private pure returns (ErrorCode, uint256) {
        unchecked {
            // Bit accumulator (can use up to 20 bits)
            uint256 val;

            // Load at least need bits into val
            val = s.bitbuf;
            while (s.bitcnt < need) {
                if (s.incnt == s.input.length) {
                    // Out of input
                    return (ErrorCode.ERR_NOT_TERMINATED, 0);
                }

                // Load eight bits
                val |= uint256(uint8(s.input[s.incnt++])) << s.bitcnt;
                s.bitcnt += 8;
            }

            // Drop need bits and update buffer, always zero to seven bits left
            s.bitbuf = val >> need;
            s.bitcnt -= need;

            // Return need bits, zeroing the bits above that
            uint256 ret = (val & ((1 << need) - 1));
            return (ErrorCode.ERR_NONE, ret);
        }
    }

    function _stored(State memory s) private pure returns (ErrorCode) {
        unchecked {
            // Length of stored block
            uint256 len;

            // Discard leftover bits from current byte (assumes s.bitcnt < 8)
            s.bitbuf = 0;
            s.bitcnt = 0;

            // Get length and check against its one's complement
            if (s.incnt + 4 > s.input.length) {
                // Not enough input
                return ErrorCode.ERR_NOT_TERMINATED;
            }
            len = uint256(uint8(s.input[s.incnt++]));
            len |= uint256(uint8(s.input[s.incnt++])) << 8;

            if (uint8(s.input[s.incnt++]) != (~len & 0xFF) || uint8(s.input[s.incnt++]) != ((~len >> 8) & 0xFF)) {
                // Didn't match complement!
                return ErrorCode.ERR_STORED_LENGTH_NO_MATCH;
            }

            // Copy len bytes from in to out
            if (s.incnt + len > s.input.length) {
                // Not enough input
                return ErrorCode.ERR_NOT_TERMINATED;
            }
            if (s.outcnt + len > s.output.length) {
                // Not enough output space
                return ErrorCode.ERR_OUTPUT_EXHAUSTED;
            }
            while (len != 0) {
                // Note: Solidity reverts on underflow, so we decrement here
                len -= 1;
                s.output[s.outcnt++] = s.input[s.incnt++];
            }

            // Done with a valid stored block
            return ErrorCode.ERR_NONE;
        }
    }

    function _decode(State memory s, Huffman memory h) private pure returns (ErrorCode, uint256) {
        unchecked {
            // Current number of bits in code
            uint256 len;
            // Len bits being decoded
            uint256 code = 0;
            // First code of length len
            uint256 first = 0;
            // Number of codes of length len
            uint256 count;
            // Index of first code of length len in symbol table
            uint256 index = 0;
            // Error code
            ErrorCode err;

            uint256 tempCode;
            for (len = 1; len <= MAXBITS; len += 5) {
                // Get next bit
                (err, tempCode) = bits(s, 1);
                if (err != ErrorCode.ERR_NONE) {
                    return (err, 0);
                }
                code |= tempCode;
                count = h.counts[len];

                // If length len, return symbol
                if (code < first + count) {
                    return (ErrorCode.ERR_NONE, h.symbols[index + (code - first)]);
                }
                // Else update for next length
                index += count;
                first += count;
                first <<= 1;
                code <<= 1;

                // Get next bit
                (err, tempCode) = bits(s, 1);
                if (err != ErrorCode.ERR_NONE) {
                    return (err, 0);
                }
                code |= tempCode;
                count = h.counts[len + 1];

                // If length len, return symbol
                if (code < first + count) {
                    return (ErrorCode.ERR_NONE, h.symbols[index + (code - first)]);
                }
                // Else update for next length
                index += count;
                first += count;
                first <<= 1;
                code <<= 1;

                // Get next bit
                (err, tempCode) = bits(s, 1);
                if (err != ErrorCode.ERR_NONE) {
                    return (err, 0);
                }
                code |= tempCode;
                count = h.counts[len + 2];

                // If length len, return symbol
                if (code < first + count) {
                    return (ErrorCode.ERR_NONE, h.symbols[index + (code - first)]);
                }
                // Else update for next length
                index += count;
                first += count;
                first <<= 1;
                code <<= 1;

                // Get next bit
                (err, tempCode) = bits(s, 1);
                if (err != ErrorCode.ERR_NONE) {
                    return (err, 0);
                }
                code |= tempCode;
                count = h.counts[len + 3];

                // If length len, return symbol
                if (code < first + count) {
                    return (ErrorCode.ERR_NONE, h.symbols[index + (code - first)]);
                }
                // Else update for next length
                index += count;
                first += count;
                first <<= 1;
                code <<= 1;

                // Get next bit
                (err, tempCode) = bits(s, 1);
                if (err != ErrorCode.ERR_NONE) {
                    return (err, 0);
                }
                code |= tempCode;
                count = h.counts[len + 4];

                // If length len, return symbol
                if (code < first + count) {
                    return (ErrorCode.ERR_NONE, h.symbols[index + (code - first)]);
                }
                // Else update for next length
                index += count;
                first += count;
                first <<= 1;
                code <<= 1;
            }

            // Ran out of codes
            return (ErrorCode.ERR_INVALID_LENGTH_OR_DISTANCE_CODE, 0);
        }
    }

    function _construct(
        Huffman memory h,
        uint256[] memory lengths,
        uint256 n,
        uint256 start
    ) private pure returns (ErrorCode) {
        unchecked {
            // Current symbol when stepping through lengths[]
            uint256 symbol;
            // Current length when stepping through h.counts[]
            uint256 len;
            // Number of possible codes left of current length
            uint256 left;
            // Offsets in symbol table for each length
            uint256[MAXBITS + 1] memory offs;

            // Count number of codes of each length
            for (len = 0; len <= MAXBITS; ++len) {
                h.counts[len] = 0;
            }
            for (symbol = 0; symbol < n; ++symbol) {
                // Assumes lengths are within bounds
                ++h.counts[lengths[start + symbol]];
            }
            // No codes!
            if (h.counts[0] == n) {
                // Complete, but decode() will fail
                return (ErrorCode.ERR_NONE);
            }

            // Check for an over-subscribed or incomplete set of lengths

            // One possible code of zero length
            left = 1;

            for (len = 1; len <= MAXBITS; len += 5) {
                // One more bit, double codes left
                left <<= 1;
                if (left < h.counts[len]) {
                    // Over-subscribed--return error
                    return ErrorCode.ERR_CONSTRUCT;
                }
                // Deduct count from possible codes
                left -= h.counts[len];

                // One more bit, double codes left
                left <<= 1;
                if (left < h.counts[len + 1]) {
                    // Over-subscribed--return error
                    return ErrorCode.ERR_CONSTRUCT;
                }
                // Deduct count from possible codes
                left -= h.counts[len + 1];

                // One more bit, double codes left
                left <<= 1;
                if (left < h.counts[len + 2]) {
                    // Over-subscribed--return error
                    return ErrorCode.ERR_CONSTRUCT;
                }
                // Deduct count from possible codes
                left -= h.counts[len + 2];

                // One more bit, double codes left
                left <<= 1;
                if (left < h.counts[len + 3]) {
                    // Over-subscribed--return error
                    return ErrorCode.ERR_CONSTRUCT;
                }
                // Deduct count from possible codes
                left -= h.counts[len + 3];

                // One more bit, double codes left
                left <<= 1;
                if (left < h.counts[len + 4]) {
                    // Over-subscribed--return error
                    return ErrorCode.ERR_CONSTRUCT;
                }
                // Deduct count from possible codes
                left -= h.counts[len + 4];
            }

            // Generate offsets into symbol table for each length for sorting
            offs[1] = 0;
            for (len = 1; len < MAXBITS; ++len) {
                offs[len + 1] = offs[len] + h.counts[len];
            }

            // Put symbols in table sorted by length, by symbol order within each length
            for (symbol = 0; symbol < n; ++symbol) {
                if (lengths[start + symbol] != 0) {
                    h.symbols[offs[lengths[start + symbol]]++] = symbol;
                }
            }

            // Left > 0 means incomplete
            return left > 0 ? ErrorCode.ERR_CONSTRUCT : ErrorCode.ERR_NONE;
        }
    }

    function _codes(State memory s, Huffman memory lencode, Huffman memory distcode) private pure returns (ErrorCode) {
        unchecked {
            // Decoded symbol
            uint256 symbol;
            // Length for copy
            uint256 len;
            // Distance for copy
            uint256 dist;
            // TODO Solidity doesn't support constant arrays, but these are fixed at compile-time
            // Size base for length codes 257..285
            uint16[29] memory lens = [
                3,
                4,
                5,
                6,
                7,
                8,
                9,
                10,
                11,
                13,
                15,
                17,
                19,
                23,
                27,
                31,
                35,
                43,
                51,
                59,
                67,
                83,
                99,
                115,
                131,
                163,
                195,
                227,
                258
            ];
            // Extra bits for length codes 257..285
            uint8[29] memory lext = [
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                1,
                1,
                1,
                1,
                2,
                2,
                2,
                2,
                3,
                3,
                3,
                3,
                4,
                4,
                4,
                4,
                5,
                5,
                5,
                5,
                0
            ];
            // Offset base for distance codes 0..29
            uint16[30] memory dists = [
                1,
                2,
                3,
                4,
                5,
                7,
                9,
                13,
                17,
                25,
                33,
                49,
                65,
                97,
                129,
                193,
                257,
                385,
                513,
                769,
                1025,
                1537,
                2049,
                3073,
                4097,
                6145,
                8193,
                12289,
                16385,
                24577
            ];
            // Extra bits for distance codes 0..29
            uint8[30] memory dext = [
                0,
                0,
                0,
                0,
                1,
                1,
                2,
                2,
                3,
                3,
                4,
                4,
                5,
                5,
                6,
                6,
                7,
                7,
                8,
                8,
                9,
                9,
                10,
                10,
                11,
                11,
                12,
                12,
                13,
                13
            ];
            // Error code
            ErrorCode err;

            // Decode literals and length/distance pairs
            while (symbol != 256) {
                (err, symbol) = _decode(s, lencode);
                if (err != ErrorCode.ERR_NONE) {
                    // Invalid symbol
                    return err;
                }

                if (symbol < 256) {
                    // Literal: symbol is the byte
                    // Write out the literal
                    if (s.outcnt == s.output.length) {
                        return ErrorCode.ERR_OUTPUT_EXHAUSTED;
                    }
                    s.output[s.outcnt] = bytes1(uint8(symbol));
                    ++s.outcnt;
                } else if (symbol > 256) {
                    uint256 tempBits;
                    // Length
                    // Get and compute length
                    symbol -= 257;
                    if (symbol >= 29) {
                        // Invalid fixed code
                        return ErrorCode.ERR_INVALID_LENGTH_OR_DISTANCE_CODE;
                    }

                    (err, tempBits) = bits(s, lext[symbol]);
                    if (err != ErrorCode.ERR_NONE) {
                        return err;
                    }
                    len = lens[symbol] + tempBits;

                    // Get and check distance
                    (err, symbol) = _decode(s, distcode);
                    if (err != ErrorCode.ERR_NONE) {
                        // Invalid symbol
                        return err;
                    }
                    (err, tempBits) = bits(s, dext[symbol]);
                    if (err != ErrorCode.ERR_NONE) {
                        return err;
                    }
                    dist = dists[symbol] + tempBits;
                    if (dist > s.outcnt) {
                        // Distance too far back
                        return ErrorCode.ERR_DISTANCE_TOO_FAR;
                    }

                    // Copy length bytes from distance bytes back
                    if (s.outcnt + len > s.output.length) {
                        return ErrorCode.ERR_OUTPUT_EXHAUSTED;
                    }
                    while (len != 0) {
                        // Note: Solidity reverts on underflow, so we decrement here
                        len -= 1;
                        s.output[s.outcnt] = s.output[s.outcnt - dist];
                        ++s.outcnt;
                    }
                } else {
                    s.outcnt += len;
                }
            }

            // Done with a valid fixed or dynamic block
            return ErrorCode.ERR_NONE;
        }
    }

    function _build_fixed(State memory s) private pure returns (ErrorCode) {
        unchecked {
            // Build fixed Huffman tables
            // TODO this is all a compile-time constant
            uint256 symbol;
            uint256[] memory lengths = new uint256[](FIXLCODES);

            // Literal/length table
            for (symbol = 0; symbol < 144; ++symbol) {
                lengths[symbol] = 8;
            }
            for (; symbol < 256; ++symbol) {
                lengths[symbol] = 9;
            }
            for (; symbol < 280; ++symbol) {
                lengths[symbol] = 7;
            }
            for (; symbol < FIXLCODES; ++symbol) {
                lengths[symbol] = 8;
            }

            _construct(s.lencode, lengths, FIXLCODES, 0);

            // Distance table
            for (symbol = 0; symbol < MAXDCODES; ++symbol) {
                lengths[symbol] = 5;
            }

            _construct(s.distcode, lengths, MAXDCODES, 0);

            return ErrorCode.ERR_NONE;
        }
    }

    function _fixed(State memory s) private pure returns (ErrorCode) {
        unchecked {
            // Decode data until end-of-block code
            return _codes(s, s.lencode, s.distcode);
        }
    }

    function _build_dynamic_lengths(State memory s) private pure returns (ErrorCode, uint256[] memory) {
        unchecked {
            uint256 ncode;
            // Index of lengths[]
            uint256 index;
            // Descriptor code lengths
            uint256[] memory lengths = new uint256[](MAXCODES);
            // Error code
            ErrorCode err;
            // Permutation of code length codes
            uint8[19] memory order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

            (err, ncode) = bits(s, 4);
            if (err != ErrorCode.ERR_NONE) {
                return (err, lengths);
            }
            ncode += 4;

            // Read code length code lengths (really), missing lengths are zero
            for (index = 0; index < ncode; ++index) {
                (err, lengths[order[index]]) = bits(s, 3);
                if (err != ErrorCode.ERR_NONE) {
                    return (err, lengths);
                }
            }
            for (; index < 19; ++index) {
                lengths[order[index]] = 0;
            }

            return (ErrorCode.ERR_NONE, lengths);
        }
    }

    function _build_dynamic(State memory s) private pure returns (ErrorCode, Huffman memory, Huffman memory) {
        unchecked {
            // Number of lengths in descriptor
            uint256 nlen;
            uint256 ndist;
            // Index of lengths[]
            uint256 index;
            // Error code
            ErrorCode err;
            // Descriptor code lengths
            uint256[] memory lengths = new uint256[](MAXCODES);
            // Length and distance codes
            Huffman memory lencode = Huffman(new uint256[](MAXBITS + 1), new uint256[](MAXLCODES));
            Huffman memory distcode = Huffman(new uint256[](MAXBITS + 1), new uint256[](MAXDCODES));
            uint256 tempBits;

            // Get number of lengths in each table, check lengths
            (err, nlen) = bits(s, 5);
            if (err != ErrorCode.ERR_NONE) {
                return (err, lencode, distcode);
            }
            nlen += 257;
            (err, ndist) = bits(s, 5);
            if (err != ErrorCode.ERR_NONE) {
                return (err, lencode, distcode);
            }
            ndist += 1;

            if (nlen > MAXLCODES || ndist > MAXDCODES) {
                // Bad counts
                return (ErrorCode.ERR_TOO_MANY_LENGTH_OR_DISTANCE_CODES, lencode, distcode);
            }

            (err, lengths) = _build_dynamic_lengths(s);
            if (err != ErrorCode.ERR_NONE) {
                return (err, lencode, distcode);
            }

            // Build huffman table for code lengths codes (use lencode temporarily)
            err = _construct(lencode, lengths, 19, 0);
            if (err != ErrorCode.ERR_NONE) {
                // Require complete code set here
                return (ErrorCode.ERR_CODE_LENGTHS_CODES_INCOMPLETE, lencode, distcode);
            }

            // Read length/literal and distance code length tables
            index = 0;
            while (index < nlen + ndist) {
                // Decoded value
                uint256 symbol;
                // Last length to repeat
                uint256 len;

                (err, symbol) = _decode(s, lencode);
                if (err != ErrorCode.ERR_NONE) {
                    // Invalid symbol
                    return (err, lencode, distcode);
                }

                if (symbol < 16) {
                    // Length in 0..15
                    lengths[index++] = symbol;
                } else {
                    // Repeat instruction
                    // Assume repeating zeros
                    len = 0;
                    if (symbol == 16) {
                        // Repeat last length 3..6 times
                        if (index == 0) {
                            // No last length!
                            return (ErrorCode.ERR_REPEAT_NO_FIRST_LENGTH, lencode, distcode);
                        }
                        // Last length
                        len = lengths[index - 1];
                        (err, tempBits) = bits(s, 2);
                        if (err != ErrorCode.ERR_NONE) {
                            return (err, lencode, distcode);
                        }
                        symbol = 3 + tempBits;
                    } else if (symbol == 17) {
                        // Repeat zero 3..10 times
                        (err, tempBits) = bits(s, 3);
                        if (err != ErrorCode.ERR_NONE) {
                            return (err, lencode, distcode);
                        }
                        symbol = 3 + tempBits;
                    } else {
                        // == 18, repeat zero 11..138 times
                        (err, tempBits) = bits(s, 7);
                        if (err != ErrorCode.ERR_NONE) {
                            return (err, lencode, distcode);
                        }
                        symbol = 11 + tempBits;
                    }

                    if (index + symbol > nlen + ndist) {
                        // Too many lengths!
                        return (ErrorCode.ERR_REPEAT_MORE, lencode, distcode);
                    }
                    while (symbol != 0) {
                        // Note: Solidity reverts on underflow, so we decrement here
                        symbol -= 1;

                        // Repeat last or zero symbol times
                        lengths[index++] = len;
                    }
                }
            }

            // Check for end-of-block code -- there better be one!
            if (lengths[256] == 0) {
                return (ErrorCode.ERR_MISSING_END_OF_BLOCK, lencode, distcode);
            }

            // Build huffman table for literal/length codes
            err = _construct(lencode, lengths, nlen, 0);
            if (
                err != ErrorCode.ERR_NONE &&
                (err == ErrorCode.ERR_NOT_TERMINATED ||
                    err == ErrorCode.ERR_OUTPUT_EXHAUSTED ||
                    nlen != lencode.counts[0] + lencode.counts[1])
            ) {
                // Incomplete code ok only for single length 1 code
                return (ErrorCode.ERR_INVALID_LITERAL_LENGTH_CODE_LENGTHS, lencode, distcode);
            }

            // Build huffman table for distance codes
            err = _construct(distcode, lengths, ndist, nlen);
            if (
                err != ErrorCode.ERR_NONE &&
                (err == ErrorCode.ERR_NOT_TERMINATED ||
                    err == ErrorCode.ERR_OUTPUT_EXHAUSTED ||
                    ndist != distcode.counts[0] + distcode.counts[1])
            ) {
                // Incomplete code ok only for single length 1 code
                return (ErrorCode.ERR_INVALID_DISTANCE_CODE_LENGTHS, lencode, distcode);
            }

            return (ErrorCode.ERR_NONE, lencode, distcode);
        }
    }

    function _dynamic(State memory s) private pure returns (ErrorCode) {
        unchecked {
            // Length and distance codes
            Huffman memory lencode;
            Huffman memory distcode;
            // Error code
            ErrorCode err;

            (err, lencode, distcode) = _build_dynamic(s);
            if (err != ErrorCode.ERR_NONE) {
                return err;
            }

            // Decode data until end-of-block code
            return _codes(s, lencode, distcode);
        }
    }

    function puff(bytes memory source, uint256 destlen) internal pure returns (ErrorCode, bytes memory) {
        unchecked {
            // Input/output state
            State memory s = State(
                new bytes(destlen),
                0,
                source,
                0,
                0,
                0,
                Huffman(new uint256[](MAXBITS + 1), new uint256[](FIXLCODES)),
                Huffman(new uint256[](MAXBITS + 1), new uint256[](MAXDCODES))
            );
            // Temp: last bit
            uint256 last;
            // Temp: block type bit
            uint256 t;
            // Error code
            ErrorCode err;

            // Build fixed Huffman tables
            err = _build_fixed(s);
            if (err != ErrorCode.ERR_NONE) {
                return (err, s.output);
            }

            // Process blocks until last block or error
            while (last == 0) {
                // One if last block
                (err, last) = bits(s, 1);
                if (err != ErrorCode.ERR_NONE) {
                    return (err, s.output);
                }

                // Block type 0..3
                (err, t) = bits(s, 2);
                if (err != ErrorCode.ERR_NONE) {
                    return (err, s.output);
                }

                err = (
                    t == 0
                        ? _stored(s)
                        : (t == 1 ? _fixed(s) : (t == 2 ? _dynamic(s) : ErrorCode.ERR_INVALID_BLOCK_TYPE))
                );
                // type == 3, invalid

                if (err != ErrorCode.ERR_NONE) {
                    // Return with error
                    break;
                }
            }

            return (err, s.output);
        }
    }
}
```

## Contract: INounsArt.sol (dependency)

```solidity
// SPDX-License-Identifier: GPL-3.0

/// @title Interface for NounsArt

/*********************************
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░█████████░░█████████░░░ *
 * ░░░░░░██░░░████░░██░░░████░░░ *
 * ░░██████░░░████████░░░████░░░ *
 * ░░██░░██░░░████░░██░░░████░░░ *
 * ░░██░░██░░░████░░██░░░████░░░ *
 * ░░░░░░█████████░░█████████░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 *********************************/

pragma solidity ^0.8.6;

import { IInflator } from './IInflator.sol';

interface INounsArt {
    error SenderIsNotDescriptor();

    error EmptyPalette();

    error BadPaletteLength();

    error EmptyBytes();

    error BadDecompressedLength();

    error BadImageCount();

    error ImageNotFound();

    error PaletteNotFound();

    event DescriptorUpdated(address oldDescriptor, address newDescriptor);

    event InflatorUpdated(address oldInflator, address newInflator);

    event BackgroundsAdded(uint256 count);

    event PaletteSet(uint8 paletteIndex);

    event BodiesAdded(uint16 count);

    event AccessoriesAdded(uint16 count);

    event HeadsAdded(uint16 count);

    event GlassesAdded(uint16 count);

    struct NounArtStoragePage {
        uint16 imageCount;
        uint80 decompressedLength;
        address pointer;
    }

    struct Trait {
        NounArtStoragePage[] storagePages;
        uint256 storedImagesCount;
    }

    function descriptor() external view returns (address);

    function inflator() external view returns (IInflator);

    function setDescriptor(address descriptor) external;

    function setInflator(IInflator inflator) external;

    function addManyBackgrounds(string[] calldata _backgrounds) external;

    function addBackground(string calldata _background) external;

    function palettes(uint8 paletteIndex) external view returns (bytes memory);

    function setPalette(uint8 paletteIndex, bytes calldata palette) external;

    function addBodies(bytes calldata encodedCompressed, uint80 decompressedLength, uint16 imageCount) external;

    function addAccessories(bytes calldata encodedCompressed, uint80 decompressedLength, uint16 imageCount) external;

    function addHeads(bytes calldata encodedCompressed, uint80 decompressedLength, uint16 imageCount) external;

    function addGlasses(bytes calldata encodedCompressed, uint80 decompressedLength, uint16 imageCount) external;

    function addBodiesFromPointer(address pointer, uint80 decompressedLength, uint16 imageCount) external;

    function setPalettePointer(uint8 paletteIndex, address pointer) external;

    function addAccessoriesFromPointer(address pointer, uint80 decompressedLength, uint16 imageCount) external;

    function addHeadsFromPointer(address pointer, uint80 decompressedLength, uint16 imageCount) external;

    function addGlassesFromPointer(address pointer, uint80 decompressedLength, uint16 imageCount) external;

    function backgroundCount() external view returns (uint256);

    function bodyCount() external view returns (uint256);

    function accessoryCount() external view returns (uint256);

    function headCount() external view returns (uint256);

    function glassesCount() external view returns (uint256);

    function backgrounds(uint256 index) external view returns (string memory);

    function heads(uint256 index) external view returns (bytes memory);

    function bodies(uint256 index) external view returns (bytes memory);

    function accessories(uint256 index) external view returns (bytes memory);

    function glasses(uint256 index) external view returns (bytes memory);

    function getBodiesTrait() external view returns (Trait memory);

    function getAccessoriesTrait() external view returns (Trait memory);

    function getHeadsTrait() external view returns (Trait memory);

    function getGlassesTrait() external view returns (Trait memory);
}
```

## Contract: INounsDescriptorArt.sol (dependency)

```solidity
// SPDX-License-Identifier: GPL-3.0

/// @title Interface for NounsDescriptorArt

pragma solidity ^0.8.20;

import { INounsArt } from './INounsArt.sol';

interface INounsDescriptorArt {
    function art() external returns (INounsArt);
}
```

## Contract: INounsDescriptorMinimal.sol (dependency)

```solidity
// SPDX-License-Identifier: GPL-3.0

/// @title Common interface for NounsDescriptor versions, as used by NounsToken and NounsSeeder.

/*********************************
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░█████████░░█████████░░░ *
 * ░░░░░░██░░░████░░██░░░████░░░ *
 * ░░██████░░░████████░░░████░░░ *
 * ░░██░░██░░░████░░██░░░████░░░ *
 * ░░██░░██░░░████░░██░░░████░░░ *
 * ░░░░░░█████████░░█████████░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 *********************************/

pragma solidity ^0.8.6;

import { INounsSeeder } from './INounsSeeder.sol';

interface INounsDescriptorMinimal {
    ///
    /// USED BY TOKEN
    ///

    function tokenURI(uint256 tokenId, INounsSeeder.Seed memory seed) external view returns (string memory);

    function dataURI(uint256 tokenId, INounsSeeder.Seed memory seed) external view returns (string memory);

    ///
    /// USED BY SEEDER
    ///

    function backgroundCount() external view returns (uint256);

    function bodyCount() external view returns (uint256);

    function accessoryCount() external view returns (uint256);

    function headCount() external view returns (uint256);

    function glassesCount() external view returns (uint256);
}
```

## Contract: INounsFragmentDescriptorMinimal.sol (dependency)

```solidity
// SPDX-License-Identifier: GPL-3.0

/// @title Minimal interface for NounsFragmentDescriptor versions, as used by NounsFragmentToken.

pragma solidity ^0.8.20;

import { INounsSeeder } from './INounsSeeder.sol';

interface INounsFragmentDescriptorMinimal {
    function tokenURI(
        uint256 tokenId,
        INounsSeeder.Seed memory seed,
        uint256 fragmentCount
    ) external view returns (string memory);

    function dataURI(
        uint256 tokenId,
        INounsSeeder.Seed memory seed,
        uint256 fragmentCount
    ) external view returns (string memory);
}
```

## Contract: INounsSeeder.sol (dependency)

```solidity
// SPDX-License-Identifier: GPL-3.0

/// @title Interface for NounsSeeder

/*********************************
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░█████████░░█████████░░░ *
 * ░░░░░░██░░░████░░██░░░████░░░ *
 * ░░██████░░░████████░░░████░░░ *
 * ░░██░░██░░░████░░██░░░████░░░ *
 * ░░██░░██░░░████░░██░░░████░░░ *
 * ░░░░░░█████████░░█████████░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 *********************************/

pragma solidity ^0.8.6;

import { INounsDescriptorMinimal } from './INounsDescriptorMinimal.sol';

interface INounsSeeder {
    struct Seed {
        uint48 background;
        uint48 body;
        uint48 accessory;
        uint48 head;
        uint48 glasses;
    }

    function generateSeed(uint256 nounId, INounsDescriptorMinimal descriptor) external view returns (Seed memory);
}
```

## Contract: INounsToken.sol (dependency)

```solidity
// SPDX-License-Identifier: GPL-3.0

/// @title Interface for NounsToken

pragma solidity ^0.8.20;

import { INounsDescriptorArt } from './INounsDescriptorArt.sol';
import { INounsSeeder } from './INounsSeeder.sol';

interface INounsToken {
    function descriptor() external returns (INounsDescriptorArt);

    function seeder() external returns (INounsSeeder);

    function transferFrom(address from, address to, uint256 nounId) external;
}
```

## Contract: IProxyRegistry.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.6;

interface IProxyRegistry {
    function proxies(address) external view returns (address);
}
```

## Contract: MockNounsToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';

contract MockNounsToken is ERC721 {
    uint256 private _nextTokenId;
    MockNounsSeeder mockNounsSeeder;

    constructor() ERC721('MockNounsToken', 'MNT') {
        mockNounsSeeder = new MockNounsSeeder();
    }

    function mint(address to) public {
        uint256 tokenId = _nextTokenId++;
        _mint(to, tokenId);
    }

    struct Seed {
        uint48 background;
        uint48 body;
        uint48 accessory;
        uint48 head;
        uint48 glasses;
    }

    function seeder() public view returns (MockNounsSeeder) {
        return mockNounsSeeder;
    }
}

import { INounsSeeder } from './INounsSeeder.sol';
import { INounsDescriptorMinimal } from './INounsDescriptorMinimal.sol';

contract MockNounsSeeder is INounsSeeder {
    function generateSeed(uint256 nounId, INounsDescriptorMinimal) external pure override returns (Seed memory) {
        return
            Seed({
                background: uint48(nounId % 2),
                body: uint48((nounId + 1) % 3),
                accessory: uint48((nounId + 2) % 4),
                head: uint48((nounId + 3) % 5),
                glasses: uint48((nounId + 4) % 6)
            });
    }
}

contract MockNounsDescriptor is INounsDescriptorMinimal {
    function tokenURI(uint256, INounsSeeder.Seed memory) public pure override returns (string memory) {
        return 'https://nouns.com/token/';
    }

    function dataURI(uint256, INounsSeeder.Seed memory) public pure override returns (string memory) {
        return 'https://nouns.com/token/';
    }

    function tokenURI(uint256, INounsSeeder.Seed memory, uint256) external pure returns (string memory) {
        return 'https://nouns.com/token/';
    }

    function dataURI(uint256, INounsSeeder.Seed memory, uint256) external pure returns (string memory) {
        return 'https://nouns.com/token/';
    }

    function backgroundCount() external pure override returns (uint256) {
        return 2;
    }

    function bodyCount() external pure override returns (uint256) {
        return 3;
    }

    function accessoryCount() external pure override returns (uint256) {
        return 4;
    }

    function headCount() external pure override returns (uint256) {
        return 5;
    }

    function glassesCount() external pure override returns (uint256) {
        return 6;
    }
}
```

## Contract: NounsFragmentToken.sol (primary target)

```solidity
// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import { INounsFragmentDescriptorMinimal } from './INounsFragmentDescriptorMinimal.sol';
import { INounsDescriptorMinimal } from './INounsDescriptorMinimal.sol';
import { INounsToken } from './INounsToken.sol';
import { INounsSeeder } from './INounsSeeder.sol';
import { IProxyRegistry } from './IProxyRegistry.sol';

contract NounsFragmentToken is ERC721, Ownable {
    // OpenSea's Proxy Registry
    IProxyRegistry public immutable proxyRegistry;

    // The NounsFT token URI descriptor
    INounsFragmentDescriptorMinimal public descriptor;

    // The Nouns token
    INounsToken public nounsToken;

    // The NounFT seeds
    mapping(uint256 => INounsSeeder.Seed) public seeds;

    // The NounFT fragment counts
    mapping(uint256 => uint256) public fragmentCountOf;

    // The internal token ID tracker
    uint256 private _nextTokenId;

    event NounFTCreated(uint256 tokenId, INounsSeeder.Seed seed, uint256 fragmentCount);
    event NounFTUpdated(uint256 tokenId, uint256 oldFragmentCount, uint256 newFragmentCount);
    event DescriptorUpdated(INounsFragmentDescriptorMinimal descriptor);

    /**
     * @notice Initializes the NounsFragmentToken contract
     * @dev Sets up the ERC721 token with name and symbol, and initializes other contract dependencies
     * @param initialOwner The address that will be granted the owner role
     * @param _descriptor The address of the NounsFragmentDescriptor contract
     * @param _nounsToken The address of the NounsToken contract
     * @param _proxyRegistry The address of OpenSea's proxy registry
     */
    constructor(
        address initialOwner,
        INounsFragmentDescriptorMinimal _descriptor,
        INounsToken _nounsToken,
        IProxyRegistry _proxyRegistry
    ) ERC721('Nouns Fragment Token', 'NOUNFT') Ownable(initialOwner) {
        descriptor = _descriptor;
        nounsToken = _nounsToken;
        proxyRegistry = _proxyRegistry;
    }

    /**
     * @notice Mint a token to the 'to' address, consisting of 'fragmentCount' fragments
     * @dev Only callable by the owner
     * @param to The address that will receive the minted token
     * @param fragmentCount The number of fragments the token represents
     */
    function mint(address to, uint256 fragmentCount) external onlyOwner {
        uint256 tokenId = _nextTokenId++;
        _mintTo(to, tokenId, fragmentCount);
    }

    /**
     * @notice Mint a token to the 'to' address, consisting of 'fragmentCount' fragments,
     * using the seed from the provided 'tokenToUseForSeed'
     * @dev Only callable by the owner
     * @param to The address that will receive the minted token
     * @param fragmentCount The number of fragments the token represents
     * @param tokenToUseForSeed The token ID whose seed should be used for this new token
     */
    function mint(address to, uint256 fragmentCount, uint256 tokenToUseForSeed) external onlyOwner {
        uint256 tokenId = _nextTokenId++;
        _requireOwned(tokenToUseForSeed);
        _mintToUsingSeed(to, tokenId, fragmentCount, seeds[tokenToUseForSeed]);
    }

    /**
     * @notice Burn a NounFT
     * @dev Only callable by the owner
     * @param tokenId The ID of the token to burn
     */
    function burn(uint256 tokenId) external onlyOwner {
        _burn(tokenId);
        delete seeds[tokenId];
        delete fragmentCountOf[tokenId];
    }

    /**
     * @notice Update the fragment count of the provided 'tokenId' to 'newFragmentCount'
     * @dev Only callable by the owner
     * @param tokenId The ID of the token to update
     * @param newFragmentCount The new fragment count for the token
     */
    function updateFragmentCount(uint256 tokenId, uint256 newFragmentCount) external onlyOwner {
        _requireOwned(tokenId);
        uint256 currentFragmentCount = fragmentCountOf[tokenId];
        fragmentCountOf[tokenId] = newFragmentCount;

        emit NounFTUpdated(tokenId, currentFragmentCount, newFragmentCount);
    }

    /**
     * @notice Set the token URI descriptor
     * @dev Only callable by the owner
     * @param _descriptor The new descriptor contract address
     */
    function setDescriptor(INounsFragmentDescriptorMinimal _descriptor) external onlyOwner {
        descriptor = _descriptor;

        emit DescriptorUpdated(_descriptor);
    }

    /**
     * @notice Override isApprovedForAll to whitelist user's OpenSea proxy accounts to enable gas-less listings
     * @param owner The owner of the tokens
     * @param operator The address of the operator to check
     * @return bool Whether the operator is approved for all tokens of the owner
     */
    function isApprovedForAll(address owner, address operator) public view override returns (bool) {
        // Whitelist OpenSea proxy contract for easy trading.
        if (proxyRegistry.proxies(owner) == operator) {
            return true;
        }
        return super.isApprovedForAll(owner, operator);
    }

    /**
     * @notice A distinct Uniform Resource Identifier (URI) for a given asset
     * @dev See {IERC721Metadata-tokenURI}
     * @param tokenId The ID of the token to get the URI for
     * @return string The token URI
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return descriptor.tokenURI(tokenId, seeds[tokenId], fragmentCountOf[tokenId]);
    }

    /**
     * @notice Similar to `tokenURI`, but always serves a base64 encoded data URI
     * with the JSON contents directly inlined
     * @param tokenId The ID of the token to get the data URI for
     * @return string The data URI for the token
     */
    function dataURI(uint256 tokenId) public view returns (string memory) {
        _requireOwned(tokenId);
        return descriptor.dataURI(tokenId, seeds[tokenId], fragmentCountOf[tokenId]);
    }

    /**
     * @notice The next token ID to be minted
     * @return uint256 The next token ID
     */
    function nextTokenId() public view returns (uint256) {
        return _nextTokenId;
    }

    // //////////////////
    // Internal Functions
    // //////////////////

    /**
     * @notice Mint a NounFT with `tokenId`, worth 'fragmentCount' fragments to the provided `to` address
     * @param to The address that will receive the minted token
     * @param tokenId The ID of the token to mint
     * @param fragmentCount The number of fragments the token represents
     */
    function _mintTo(address to, uint256 tokenId, uint256 fragmentCount) internal {
        INounsSeeder.Seed memory seed = seeds[tokenId] = nounsToken.seeder().generateSeed(
            tokenId,
            INounsDescriptorMinimal(address(descriptor))
        );
        fragmentCountOf[tokenId] = fragmentCount;
        _mint(to, tokenId);

        emit NounFTCreated(tokenId, seed, fragmentCount);
    }

    /**
     * @notice Mint a NounFT with `tokenId`, worth 'fragmentCount' fragments, using 'seed' to the provided `to` address
     * @param to The address that will receive the minted token
     * @param tokenId The ID of the token to mint
     * @param fragmentCount The number of fragments the token represents
     * @param seedToUse The seed to use for this token
     */
    function _mintToUsingSeed(
        address to,
        uint256 tokenId,
        uint256 fragmentCount,
        INounsSeeder.Seed memory seedToUse
    ) internal {
        INounsSeeder.Seed memory seed = seeds[tokenId] = seedToUse;
        fragmentCountOf[tokenId] = fragmentCount;
        _mint(to, tokenId);

        emit NounFTCreated(tokenId, seed, fragmentCount);
    }
}
```

## Tests: NounsFragmentToken.js

```javascript
const { expect } = require('chai');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

describe('NounsFragmentToken contract', function () {
  async function deployNounsFragmentTokenFixture() {
    const [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    const MockNounsToken = await ethers.getContractFactory('MockNounsToken');
    const mockNounsToken = await MockNounsToken.deploy();
    await mockNounsToken.waitForDeployment();

    const MockNounsDescriptor = await ethers.getContractFactory('MockNounsDescriptor');
    const mockNounsDescriptor = await MockNounsDescriptor.deploy();
    await mockNounsDescriptor.waitForDeployment();

    const NounsFragmentToken = await ethers.getContractFactory('NounsFragmentToken');
    const proxyRegistryAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'; // Replace with actual address
    const nounsFragmentToken = await NounsFragmentToken.deploy(
      owner.address,
      mockNounsDescriptor.target,
      mockNounsToken.target,
      proxyRegistryAddress,
    );
    await nounsFragmentToken.waitForDeployment();

    return { nounsFragmentToken, mockNounsToken, owner, addr1, addr2, addrs };
  }

  describe('Deployment', function () {
    it('Should set the right owner', async function () {
      const { nounsFragmentToken, owner } = await loadFixture(deployNounsFragmentTokenFixture);
      expect(await nounsFragmentToken.owner()).to.equal(owner.address);
    });

    it('Should have correct name and symbol', async function () {
      const { nounsFragmentToken } = await loadFixture(deployNounsFragmentTokenFixture);
      expect(await nounsFragmentToken.name()).to.equal('Nouns Fragment Token');
      expect(await nounsFragmentToken.symbol()).to.equal('NOUNFT');
    });
  });

  describe('Minting', function () {
    it('Should allow owner to mint tokens', async function () {
      const { nounsFragmentToken, owner, addr1 } = await loadFixture(
        deployNounsFragmentTokenFixture,
      );
      await nounsFragmentToken.mint(addr1.address, 100);
      expect(await nounsFragmentToken.balanceOf(addr1.address)).to.equal(1);
      expect(await nounsFragmentToken.fragmentCountOf(0)).to.equal(100);
    });

    it('Should allow owner to mint tokens with a specific seed', async function () {
      const { nounsFragmentToken, mockNounsToken, owner, addr1, addr2 } = await loadFixture(
        deployNounsFragmentTokenFixture,
      );

      await nounsFragmentToken.mint(addr1.address, 100);
      await nounsFragmentToken.mint(addr2.address, 150, 0, {});

      // Check if the token was minted correctly
      expect(await nounsFragmentToken.balanceOf(addr2.address)).to.equal(1);
      expect(await nounsFragmentToken.fragmentCountOf(1)).to.equal(150);

      // Fetch the seed for token 0
      const seedForToken0 = await nounsFragmentToken.seeds(0);

      // Check if the seed for token 1 matches the seed for token 0
      const seedForToken1 = await nounsFragmentToken.seeds(1);
      expect(seedForToken1.background).to.equal(seedForToken0.background);
      expect(seedForToken1.body).to.equal(seedForToken0.body);
      expect(seedForToken1.accessory).to.equal(seedForToken0.accessory);
      expect(seedForToken1.head).to.equal(seedForToken0.head);
      expect(seedForToken1.glasses).to.equal(seedForToken0.glasses);
    });

    it('Should not allow non-owner to mint tokens', async function () {
      const { nounsFragmentToken, addr1, addr2 } = await loadFixture(
        deployNounsFragmentTokenFixture,
      );
      await expect(nounsFragmentToken.connect(addr1).mint(addr2.address, 100))
        .to.be.revertedWithCustomError(nounsFragmentToken, 'OwnableUnauthorizedAccount')
        .withArgs(addr1.address);
    });
  });

  describe('Burning', function () {
    async function mintTokenFixture() {
      const deployFixture = await loadFixture(deployNounsFragmentTokenFixture);
      await deployFixture.nounsFragmentToken.mint(deployFixture.addr1.address, 100);
      return deployFixture;
    }

    it('Should allow owner to burn tokens', async function () {
      const { nounsFragmentToken, addr1 } = await loadFixture(mintTokenFixture);
      await nounsFragmentToken.burn(0);
      expect(await nounsFragmentToken.balanceOf(addr1.address)).to.equal(0);
      expect(await nounsFragmentToken.fragmentCountOf(0)).to.equal(0);
      await expect(nounsFragmentToken.ownerOf(0))
        .to.be.revertedWithCustomError(nounsFragmentToken, 'ERC721NonexistentToken')
        .withArgs(0);
    });

    it('Should not allow non-owner to burn tokens', async function () {
      const { nounsFragmentToken, addr1 } = await loadFixture(mintTokenFixture);
      await expect(nounsFragmentToken.connect(addr1).burn(0))
        .to.be.revertedWithCustomError(nounsFragmentToken, 'OwnableUnauthorizedAccount')
        .withArgs(addr1.address);
    });

    it('Should not allow owner to burn non-existent tokens', async function () {
      const { nounsFragmentToken } = await loadFixture(mintTokenFixture);
      await expect(nounsFragmentToken.burn(1))
        .to.be.revertedWithCustomError(nounsFragmentToken, 'ERC721NonexistentToken')
        .withArgs(1);
    });
  });

  describe('Updating Fragment Count', function () {
    async function mintTokenFixture() {
      const deployFixture = await loadFixture(deployNounsFragmentTokenFixture);
      await deployFixture.nounsFragmentToken.mint(deployFixture.addr1.address, 100);
      return deployFixture;
    }

    it('Should allow owner to update fragment count', async function () {
      const { nounsFragmentToken } = await loadFixture(mintTokenFixture);
      await nounsFragmentToken.updateFragmentCount(0, 200);
      expect(await nounsFragmentToken.fragmentCountOf(0)).to.equal(200);
    });

    it('Should emit NounFTUpdated event when updating fragment count', async function () {
      const { nounsFragmentToken } = await loadFixture(mintTokenFixture);
      await expect(nounsFragmentToken.updateFragmentCount(0, 200))
        .to.emit(nounsFragmentToken, 'NounFTUpdated')
        .withArgs(0, 100, 200);
    });

    it('Should not allow non-owner to update fragment count', async function () {
      const { nounsFragmentToken, addr1 } = await loadFixture(mintTokenFixture);
      await expect(nounsFragmentToken.connect(addr1).updateFragmentCount(0, 200))
        .to.be.revertedWithCustomError(nounsFragmentToken, 'OwnableUnauthorizedAccount')
        .withArgs(addr1.address);
    });

    it('Should not allow updating fragment count for non-existent token', async function () {
      const { nounsFragmentToken } = await loadFixture(mintTokenFixture);
      await expect(nounsFragmentToken.updateFragmentCount(1, 200))
        .to.be.revertedWithCustomError(nounsFragmentToken, 'ERC721NonexistentToken')
        .withArgs(1);
    });
  });

  describe('Miscellaneous Tests', function () {
    async function deployFixture() {
      return await loadFixture(deployNounsFragmentTokenFixture);
    }

    it('Should return the correct token URI', async function () {
      const { nounsFragmentToken, addr1 } = await deployFixture();
      await nounsFragmentToken.mint(addr1.address, 100);
      const tokenURI = await nounsFragmentToken.tokenURI(0);
      expect(tokenURI).to.be.a('string');
      // Note: The exact content of the tokenURI depends on the descriptor implementation
    });

    it('Should return the correct data URI', async function () {
      const { nounsFragmentToken, addr1 } = await deployFixture();
      await nounsFragmentToken.mint(addr1.address, 100);
      const dataURI = await nounsFragmentToken.dataURI(0);
      expect(dataURI).to.be.a('string');
      // Note: The exact content of the dataURI depends on the descriptor implementation
    });

    it('Should return the correct next token ID', async function () {
      const { nounsFragmentToken, addr1 } = await deployFixture();
      expect(await nounsFragmentToken.nextTokenId()).to.equal(0);
      await nounsFragmentToken.mint(addr1.address, 100);
      expect(await nounsFragmentToken.nextTokenId()).to.equal(1);
    });

    it('Should allow setting a new descriptor', async function () {
      const { nounsFragmentToken, addr1 } = await deployFixture();
      await expect(nounsFragmentToken.setDescriptor(addr1.address))
        .to.emit(nounsFragmentToken, 'DescriptorUpdated')
        .withArgs(addr1.address);
      expect(await nounsFragmentToken.descriptor()).to.equal(addr1.address);
    });

    it('Should not allow non-owner to set a new descriptor', async function () {
      const { nounsFragmentToken, addr1, addr2 } = await deployFixture();
      await expect(nounsFragmentToken.connect(addr2).setDescriptor(addr1.address))
        .to.be.revertedWithCustomError(nounsFragmentToken, 'OwnableUnauthorizedAccount')
        .withArgs(addr2.address);
    });
  });
});
```
